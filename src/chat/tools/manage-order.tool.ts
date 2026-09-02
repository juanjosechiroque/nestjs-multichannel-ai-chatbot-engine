import { Inject, Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { OrderAction } from '../../order/order.types';
import type { ChatTool, ToolBuildContext, ToolInvocationContext } from './chat-tool';
import { OrderTool, type CustomerOrderAction, type OrderToolArguments } from './order.tool';

const ORDER_TOOL_NAME = 'manage_order';
const NO_ACTIVE_ORDER_ACTIONS: CustomerOrderAction[] = [OrderAction.ADD_ITEMS];
const CONFIRMATION_REPLAY_ACTIONS: CustomerOrderAction[] = [
  OrderAction.ADD_ITEMS,
  OrderAction.CONFIRM,
];

function isOrderToolItemArgument(value: unknown): value is OrderToolArguments['items'][number] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.productName === 'string' &&
    item.productName.trim().length > 0 &&
    item.productName.length <= 100 &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= 99 &&
    Object.keys(item).every((key) => key === 'productName' || key === 'quantity')
  );
}

@Injectable()
export class ManageOrderTool implements ChatTool<OrderToolArguments> {
  readonly name = ORDER_TOOL_NAME;

  constructor(
    @Inject(OrderTool)
    private readonly orders: Pick<OrderTool, 'execute'>,
  ) {}

  buildDefinition({ orderContext }: ToolBuildContext): OpenAI.Responses.FunctionTool {
    const allowedActions =
      orderContext.activeOrder?.workflow.allowedActions ??
      (orderContext.confirmationReplayAvailable
        ? CONFIRMATION_REPLAY_ACTIONS
        : NO_ACTIVE_ORDER_ACTIONS);

    return {
      type: 'function',
      name: ORDER_TOOL_NAME,
      description: [
        "Modify or inspect the current conversation's order using application-controlled business rules.",
        `The actions currently allowed by the application are: ${allowedActions.join(', ')}. Never request another action.`,
        'Use ADD_ITEMS only when the customer explicitly asks to add or order products; do not use it when they are only browsing or asking what is available.',
        'Use REMOVE_ITEMS to remove quantities. Use REVIEW when the customer asks to see the current order or total, says the selected/current/listed items are the ones they want, or wants to proceed to confirmation.',
        'Use CONFIRM when the trusted current order context has canConfirm=true and the customer explicitly agrees to the preceding confirmation question.',
        'When confirmationReplayAvailable=true, CONFIRM is allowed only if the customer explicitly repeats the confirmation of the order that the assistant just confirmed. This is an idempotent replay, not a new order.',
        'Use CANCEL when explicitly requested.',
        'Provide product names and positive integer quantities exactly as expressed or identified in the conversation.',
        'The application resolves products, uses database prices, calculates totals, and validates every state transition.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: allowedActions,
            description: 'The single currently allowed order action requested by the customer.',
          },
          items: {
            type: 'array',
            description:
              'Products affected by ADD_ITEMS or REMOVE_ITEMS. Use an empty array for REVIEW, CONFIRM, and CANCEL.',
            items: {
              type: 'object',
              properties: {
                productName: {
                  type: 'string',
                  description:
                    'Product name or unambiguous product reference from the conversation.',
                  minLength: 1,
                  maxLength: 100,
                },
                quantity: {
                  type: 'integer',
                  description: 'Positive quantity to add or remove.',
                  minimum: 1,
                  maximum: 99,
                },
              },
              required: ['productName', 'quantity'],
              additionalProperties: false,
            },
            maxItems: 10,
          },
        },
        required: ['action', 'items'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): OrderToolArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('action' in parsed) ||
      !('items' in parsed) ||
      Object.keys(parsed).some((key) => key !== 'action' && key !== 'items') ||
      !Array.isArray(parsed.items) ||
      parsed.items.length > 10
    ) {
      throw new Error('OpenAI returned invalid manage_order arguments');
    }

    const actions = ['ADD_ITEMS', 'REMOVE_ITEMS', 'REVIEW', 'CONFIRM', 'CANCEL'] as const;
    const action = parsed.action;
    const rawItems: unknown[] = parsed.items;
    const validItems = rawItems.every(isOrderToolItemArgument);
    const itemAction = action === 'ADD_ITEMS' || action === 'REMOVE_ITEMS';

    if (
      typeof action !== 'string' ||
      !actions.some((allowedAction) => allowedAction === action) ||
      !validItems ||
      (itemAction ? rawItems.length === 0 : rawItems.length !== 0)
    ) {
      throw new Error('OpenAI returned invalid manage_order arguments');
    }

    return {
      action: action as OrderToolArguments['action'],
      items: rawItems.map((item) => ({
        productName: item.productName.trim(),
        quantity: item.quantity,
      })),
    };
  }

  execute(args: OrderToolArguments, context: ToolInvocationContext): Promise<string> {
    return this.orders.execute({
      ...args,
      conversationId: context.conversationId,
      context: context.requestContext,
    });
  }
}
