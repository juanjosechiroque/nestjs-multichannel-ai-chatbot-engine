import { Inject, Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import type { ChatTool, ToolBuildContext, ToolInvocationContext } from './chat-tool';
import { OrderTool, type OrderCustomerDetailsArguments } from './order.tool';

const ORDER_CUSTOMER_TOOL_NAME = 'set_order_customer';

@Injectable()
export class SetOrderCustomerTool implements ChatTool<OrderCustomerDetailsArguments> {
  readonly name = ORDER_CUSTOMER_TOOL_NAME;

  constructor(
    @Inject(OrderTool)
    private readonly orders: Pick<OrderTool, 'setCustomerDetails'>,
  ) {}

  buildDefinition({ orderContext }: ToolBuildContext): OpenAI.Responses.FunctionTool | null {
    const activeOrder = orderContext.activeOrder;
    if (!activeOrder) {
      return null;
    }

    return {
      type: 'function',
      name: ORDER_CUSTOMER_TOOL_NAME,
      description: [
        "Save the current order's required customer name or phone number.",
        `The application still requires: ${activeOrder.workflow.missingCustomerFields.join(', ') || 'no fields'}.`,
        'Use only details explicitly provided by the customer or supplied as trusted channel identity.',
        'Use null for a field that the customer did not provide in the current message.',
        'Never invent, infer, or reuse a phone number from unrelated conversation content.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          customerName: {
            type: ['string', 'null'],
            description: 'Customer name explicitly provided for the order, or null.',
            maxLength: 100,
          },
          customerPhone: {
            type: ['string', 'null'],
            description: 'Customer phone explicitly provided for the order, or null.',
            maxLength: 30,
          },
        },
        required: ['customerName', 'customerPhone'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): OrderCustomerDetailsArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('customerName' in parsed) ||
      !('customerPhone' in parsed) ||
      Object.keys(parsed).some((key) => key !== 'customerName' && key !== 'customerPhone')
    ) {
      throw new Error('OpenAI returned invalid set_order_customer arguments');
    }

    const customerName = parsed.customerName;
    const customerPhone = parsed.customerPhone;
    const validName =
      customerName === null ||
      (typeof customerName === 'string' &&
        customerName.trim().length >= 2 &&
        customerName.length <= 100);
    const validPhone =
      customerPhone === null ||
      (typeof customerPhone === 'string' &&
        customerPhone.trim().length > 0 &&
        customerPhone.length <= 30);

    if (!validName || !validPhone || (customerName === null && customerPhone === null)) {
      throw new Error('OpenAI returned invalid set_order_customer arguments');
    }

    return {
      customerName: customerName === null ? null : customerName.trim(),
      customerPhone: customerPhone === null ? null : customerPhone.trim(),
    };
  }

  execute(args: OrderCustomerDetailsArguments, context: ToolInvocationContext): Promise<string> {
    return this.orders.setCustomerDetails(args, context.conversationId, context.requestContext);
  }
}
