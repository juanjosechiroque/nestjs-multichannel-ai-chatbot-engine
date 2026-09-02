import { OrderAction } from '../../order/order.types';
import type { ToolBuildContext, ToolInvocationContext } from './chat-tool';
import { ManageOrderTool } from './manage-order.tool';
import type { OrderConversationContext } from './order.tool';

const noActiveOrder: OrderConversationContext = {
  activeOrder: null,
  confirmationReplayAvailable: false,
};

function buildContext(orderContext: OrderConversationContext): ToolBuildContext {
  return { orderContext };
}

function invocation(): ToolInvocationContext {
  return {
    requestContext: { requestId: 'request-1', conversationId: 'conversation-1', channel: 'web' },
    conversationId: 'conversation-1',
    orderContext: noActiveOrder,
    message: 'Agrega un latte',
  };
}

describe('ManageOrderTool', () => {
  describe('buildDefinition', () => {
    it('exposes only ADD_ITEMS when there is no active order or replay', () => {
      const definition = new ManageOrderTool({ execute: jest.fn() }).buildDefinition(
        buildContext(noActiveOrder),
      );
      const parameters = definition.parameters as unknown as {
        properties: { action: { enum: string[] } };
      };

      expect(parameters.properties.action.enum).toEqual([OrderAction.ADD_ITEMS]);
    });

    it('exposes ADD_ITEMS and CONFIRM for an idempotent confirmation replay', () => {
      const definition = new ManageOrderTool({ execute: jest.fn() }).buildDefinition(
        buildContext({ activeOrder: null, confirmationReplayAvailable: true }),
      );
      const parameters = definition.parameters as unknown as {
        properties: { action: { enum: string[] } };
      };

      expect(parameters.properties.action.enum).toEqual([
        OrderAction.ADD_ITEMS,
        OrderAction.CONFIRM,
      ]);
    });

    it('mirrors the trusted workflow allowed actions of an active order', () => {
      const definition = new ManageOrderTool({ execute: jest.fn() }).buildDefinition(
        buildContext({
          activeOrder: {
            order: {
              orderNumber: null,
              total: 13,
              currency: 'PEN',
              customer: { name: 'Ana Pérez', maskedPhone: '*******789' },
              items: [{ productName: 'Latte', unitPrice: 13, quantity: 1, lineTotal: 13 }],
            },
            workflow: {
              allowedActions: [
                OrderAction.ADD_ITEMS,
                OrderAction.REMOVE_ITEMS,
                OrderAction.CONFIRM,
                OrderAction.CANCEL,
              ],
              canConfirm: true,
              nextAction: OrderAction.CONFIRM,
              missingCustomerFields: [],
            },
          },
          confirmationReplayAvailable: false,
        }),
      );
      const parameters = definition.parameters as unknown as {
        properties: { action: { enum: string[] } };
      };

      expect(parameters.properties.action.enum).toEqual([
        OrderAction.ADD_ITEMS,
        OrderAction.REMOVE_ITEMS,
        OrderAction.CONFIRM,
        OrderAction.CANCEL,
      ]);
    });
  });

  describe('parseArguments', () => {
    const tool = new ManageOrderTool({ execute: jest.fn() });

    it('trims product names and keeps only the action and items', () => {
      expect(
        tool.parseArguments(
          JSON.stringify({
            action: 'ADD_ITEMS',
            items: [{ productName: '  Cappuccino Nube  ', quantity: 2 }],
          }),
        ),
      ).toEqual({
        action: 'ADD_ITEMS',
        items: [{ productName: 'Cappuccino Nube', quantity: 2 }],
      });
    });

    it.each([
      {
        name: 'an application-controlled total',
        payload: { action: 'CONFIRM', items: [], total: 1 },
      },
      { name: 'an unknown action', payload: { action: 'DISCOUNT', items: [] } },
      { name: 'ADD_ITEMS without items', payload: { action: 'ADD_ITEMS', items: [] } },
      {
        name: 'CONFIRM with items',
        payload: { action: 'CONFIRM', items: [{ productName: 'Latte', quantity: 1 }] },
      },
      {
        name: 'a fractional quantity',
        payload: { action: 'ADD_ITEMS', items: [{ productName: 'Latte', quantity: 1.5 }] },
      },
    ])('throws for $name', ({ payload }) => {
      expect(() => tool.parseArguments(JSON.stringify(payload))).toThrow(
        'OpenAI returned invalid manage_order arguments',
      );
    });
  });

  describe('execute', () => {
    it('delegates to OrderTool with the conversation id and request context', async () => {
      const execute = jest.fn().mockResolvedValue('{"orderOperationStatus":"completed"}');
      const tool = new ManageOrderTool({ execute });

      await tool.execute(
        { action: OrderAction.ADD_ITEMS, items: [{ productName: 'Latte', quantity: 1 }] },
        invocation(),
      );

      expect(execute).toHaveBeenCalledWith({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'Latte', quantity: 1 }],
        conversationId: 'conversation-1',
        context: { requestId: 'request-1', conversationId: 'conversation-1', channel: 'web' },
      });
    });
  });
});
