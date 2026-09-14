import { OrderAction } from '../../order/order.types';
import type { ToolBuildContext, ToolInvocationContext } from './chat-tool';
import type { OrderConversationContext } from './order.tool';
import { SetOrderCustomerTool } from './set-order-customer.tool';

const activeOrderContext: OrderConversationContext = {
  activeOrder: {
    order: {
      orderNumber: null,
      total: 13,
      currency: 'PEN',
      customer: { name: null, maskedPhone: null },
      items: [{ productName: 'Latte', unitPrice: 13, quantity: 1, lineTotal: 13 }],
    },
    workflow: {
      allowedActions: [OrderAction.ADD_ITEMS, OrderAction.REMOVE_ITEMS, OrderAction.CANCEL],
      canConfirm: false,
      nextAction: null,
      missingCustomerFields: ['customerName', 'customerPhone'],
    },
  },
  confirmationReplayAvailable: false,
};

function buildContext(orderContext: OrderConversationContext): ToolBuildContext {
  return { orderContext };
}

function invocation(): ToolInvocationContext {
  return {
    requestContext: { requestId: 'request-1', conversationId: 'conversation-1', channel: 'web' },
    conversationId: 'conversation-1',
    orderContext: activeOrderContext,
    message: 'Soy Ana Pérez',
  };
}

describe('SetOrderCustomerTool', () => {
  describe('buildDefinition', () => {
    it('is unavailable when there is no active order', () => {
      expect(
        new SetOrderCustomerTool({ setCustomerDetails: jest.fn() }).buildDefinition(
          buildContext({ activeOrder: null, confirmationReplayAvailable: false }),
        ),
      ).toBeNull();
    });

    it('lists the still-missing customer fields for an active order', () => {
      const definition = new SetOrderCustomerTool({
        setCustomerDetails: jest.fn(),
      }).buildDefinition(buildContext(activeOrderContext));

      expect(definition).toEqual(
        expect.objectContaining({ type: 'function', name: 'set_order_customer', strict: true }),
      );
      expect(definition?.description).toContain('customerName, customerPhone');
    });
  });

  describe('parseArguments', () => {
    const tool = new SetOrderCustomerTool({ setCustomerDetails: jest.fn() });

    it('trims the provided details', () => {
      expect(
        tool.parseArguments(
          '{"customerName":"  Ana Pérez  ","customerPhone":"  +51 987 654 321  "}',
        ),
      ).toEqual({ customerName: 'Ana Pérez', customerPhone: '+51 987 654 321' });
    });

    it.each([
      { name: 'both fields null', payload: '{"customerName":null,"customerPhone":null}' },
      { name: 'a too-short name', payload: '{"customerName":"A","customerPhone":null}' },
      { name: 'a blank phone', payload: '{"customerName":null,"customerPhone":"   "}' },
      {
        name: 'an extra property',
        payload: '{"customerName":"Ana","customerPhone":null,"orderNumber":9}',
      },
    ])('throws for $name', ({ payload }) => {
      expect(() => tool.parseArguments(payload)).toThrow(
        'OpenAI returned invalid set_order_customer arguments',
      );
    });
  });

  describe('execute', () => {
    it('delegates to OrderTool.setCustomerDetails with the conversation id and context', async () => {
      const setCustomerDetails = jest
        .fn()
        .mockResolvedValue('{"orderOperationStatus":"completed"}');
      const tool = new SetOrderCustomerTool({ setCustomerDetails });

      await tool.execute(
        { customerName: 'Ana Pérez', customerPhone: '+51 987 654 321' },
        invocation(),
      );

      expect(setCustomerDetails).toHaveBeenCalledWith(
        { customerName: 'Ana Pérez', customerPhone: '+51 987 654 321' },
        'conversation-1',
        { requestId: 'request-1', conversationId: 'conversation-1', channel: 'web' },
      );
    });
  });
});
