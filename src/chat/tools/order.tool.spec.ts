import { DatabaseUnavailableException } from '../../common/application-error';
import { Prisma } from '../../generated/prisma/client';
import {
  ActiveOrderNotFoundError,
  CustomerDetailsRequiredError,
  CustomerNameValidationError,
  CustomerPhoneFormatError,
  CustomerPhoneLengthError,
  OrderProductNotAvailableError,
} from '../../order/order.errors';
import { InvalidOrderTransitionError, OrderStateMachine } from '../../order/order-state-machine';
import type { OrderService } from '../../order/order.service';
import { OrderAction, OrderStatus, type OrderResult } from '../../order/order.types';
import { OrderTool } from './order.tool';

const context = {
  requestId: 'request-1',
  conversationId: 'conversation-1',
  channel: 'web',
};

function product(id: string, name: string, slug: string) {
  return {
    id,
    slug,
    name,
    description: `${name} description`,
    price: new Prisma.Decimal(13),
    currency: 'PEN',
    category: 'HOT_DRINK' as const,
    active: true,
    availableForOrdering: true,
    metadata: null,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  };
}

function order(overrides: Partial<OrderResult> = {}): OrderResult {
  return {
    id: 'order-1',
    orderNumber: null,
    conversationId: 'conversation-1',
    status: OrderStatus.SELECTING_PRODUCTS,
    total: 35,
    currency: 'PEN',
    customerName: null,
    customerPhone: null,
    items: [
      {
        productId: 'product-cappuccino',
        productName: 'Cappuccino Nube',
        unitPrice: 13,
        quantity: 2,
        lineTotal: 26,
      },
      {
        productId: 'product-croissant',
        productName: 'Croissant de mantequilla',
        unitPrice: 9,
        quantity: 1,
        lineTotal: 9,
      },
    ],
    ...overrides,
  };
}

function createTool() {
  const searchProducts = jest.fn();
  const orders = {
    addItems: jest.fn(),
    removeItems: jest.fn(),
    review: jest.fn(),
    confirm: jest.fn(),
    cancel: jest.fn(),
    setCustomerDetails: jest.fn(),
    getActiveOrder: jest.fn(),
    getLatestOrder: jest.fn(),
  } satisfies Record<
    keyof Pick<
      OrderService,
      | 'addItems'
      | 'removeItems'
      | 'review'
      | 'confirm'
      | 'cancel'
      | 'setCustomerDetails'
      | 'getActiveOrder'
      | 'getLatestOrder'
    >,
    jest.Mock
  >;
  const tool = new OrderTool({ searchProducts }, orders, new OrderStateMachine());

  return { tool, searchProducts, orders };
}

describe('OrderTool', () => {
  it('exposes the active order and only its valid customer actions as trusted context', async () => {
    const { tool, orders } = createTool();
    orders.getLatestOrder.mockResolvedValue(
      order({
        status: OrderStatus.CONFIRMING_ORDER,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
      }),
    );

    await expect(tool.getContext('conversation-1', context)).resolves.toEqual({
      activeOrder: {
        order: {
          orderNumber: null,
          total: 35,
          currency: 'PEN',
          customer: { name: 'Ana Pérez', maskedPhone: '*********321' },
          items: [
            {
              productName: 'Cappuccino Nube',
              unitPrice: 13,
              quantity: 2,
              lineTotal: 26,
            },
            {
              productName: 'Croissant de mantequilla',
              unitPrice: 9,
              quantity: 1,
              lineTotal: 9,
            },
          ],
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
    });
  });

  it('exposes the latest confirmation only when there is no active order', async () => {
    const { tool, orders } = createTool();
    orders.getLatestOrder.mockResolvedValue(order({ status: OrderStatus.CONFIRMED, total: 35 }));

    const result = await tool.getContext('conversation-1', context);

    expect(result.activeOrder).toBeNull();
    expect(result.confirmationReplayAvailable).toBe(true);
    expect(orders.getLatestOrder).toHaveBeenCalledWith('conversation-1', context);
  });

  it('resolves every product before adding multiple items in one operation', async () => {
    const { tool, searchProducts, orders } = createTool();
    searchProducts
      .mockResolvedValueOnce([product('product-cappuccino', 'Cappuccino Nube', 'cappuccino-nube')])
      .mockResolvedValueOnce([
        product('product-croissant', 'Croissant de mantequilla', 'croissant-mantequilla'),
      ]);
    orders.addItems.mockResolvedValue(order());

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.ADD_ITEMS,
        items: [
          { productName: 'cappuccino', quantity: 2 },
          { productName: 'croissant', quantity: 1 },
        ],
        conversationId: 'conversation-1',
        context,
      }),
    ) as {
      orderOperationStatus: string;
      order: { total: number };
      workflow: { canConfirm: boolean; nextAction: string };
    };

    expect(orders.addItems).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        items: [
          { productId: 'product-cappuccino', quantity: 2 },
          { productId: 'product-croissant', quantity: 1 },
        ],
      },
      context,
    );
    expect(result.orderOperationStatus).toBe('completed');
    expect(result.order.total).toBe(35);
    expect(result.workflow).toEqual(
      expect.objectContaining({ canConfirm: false, nextAction: OrderAction.REVIEW }),
    );
  });

  it('asks for clarification and leaves the order unchanged when a product is ambiguous', async () => {
    const { tool, searchProducts, orders } = createTool();
    searchProducts.mockResolvedValue([
      product('product-1', 'Té chai latte', 'te-chai-latte'),
      product('product-2', 'Té verde jazmín', 'te-verde-jazmin'),
    ]);

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'té', quantity: 1 }],
        conversationId: 'conversation-1',
        context,
      }),
    ) as {
      orderOperationStatus: string;
      issues: Array<{ reason: string; candidates: string[] }>;
    };

    expect(result).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'clarification_required',
        issues: [
          expect.objectContaining({
            reason: 'ambiguous',
            candidates: ['Té chai latte', 'Té verde jazmín'],
          }),
        ],
      }),
    );
    expect(orders.addItems).not.toHaveBeenCalled();
  });

  it('reports a missing catalog product without creating a draft', async () => {
    const { tool, searchProducts, orders } = createTool();
    searchProducts.mockResolvedValue([]);

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'producto inventado', quantity: 1 }],
        conversationId: 'conversation-1',
        context,
      }),
    ) as { orderOperationStatus: string; issues: Array<{ reason: string }> };

    expect(result.orderOperationStatus).toBe('clarification_required');
    expect(result.issues).toEqual([
      expect.objectContaining({ productName: 'producto inventado', reason: 'not_found' }),
    ]);
    expect(orders.addItems).not.toHaveBeenCalled();
  });

  it('returns a controlled rejection when a catalog product cannot currently be ordered', async () => {
    const { tool, searchProducts, orders } = createTool();
    searchProducts.mockResolvedValue([
      product('product-cappuccino', 'Cappuccino Nube', 'cappuccino-nube'),
    ]);
    orders.addItems.mockRejectedValue(new OrderProductNotAvailableError('product-cappuccino'));

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'Cappuccino Nube', quantity: 1 }],
        conversationId: 'conversation-1',
        context,
      }),
    ) as { orderOperationStatus: string; issues: Array<{ reason: string }> };

    expect(result).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'rejected',
        order: null,
        issues: [{ reason: 'product_not_available' }],
      }),
    );
  });

  it('resolves removals against the current order snapshot instead of catalog prices', async () => {
    const { tool, searchProducts, orders } = createTool();
    orders.getActiveOrder.mockResolvedValue(order());
    orders.removeItems.mockResolvedValue(
      order({
        total: 22,
        items: [
          {
            productId: 'product-cappuccino',
            productName: 'Cappuccino Nube',
            unitPrice: 13,
            quantity: 1,
            lineTotal: 13,
          },
          {
            productId: 'product-croissant',
            productName: 'Croissant de mantequilla',
            unitPrice: 9,
            quantity: 1,
            lineTotal: 9,
          },
        ],
      }),
    );

    await tool.execute({
      action: OrderAction.REMOVE_ITEMS,
      items: [{ productName: 'Cappuccino Nube', quantity: 1 }],
      conversationId: 'conversation-1',
      context,
    });

    expect(searchProducts).not.toHaveBeenCalled();
    expect(orders.removeItems).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        items: [{ productId: 'product-cappuccino', quantity: 1 }],
      },
      context,
    );
  });

  it('returns a controlled rejection when removing without an active order', async () => {
    const { tool, orders } = createTool();
    orders.getActiveOrder.mockResolvedValue(null);

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.REMOVE_ITEMS,
        items: [{ productName: 'Latte', quantity: 1 }],
        conversationId: 'conversation-1',
        context,
      }),
    ) as { orderOperationStatus: string; issues: Array<{ reason: string }> };

    expect(result).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'rejected',
        order: null,
        issues: [{ reason: 'no_active_order' }],
      }),
    );
    expect(orders.removeItems).not.toHaveBeenCalled();
  });

  it('asks which current item to remove when the reference is ambiguous', async () => {
    const { tool, orders } = createTool();
    orders.getActiveOrder.mockResolvedValue(
      order({
        items: [
          {
            productId: 'product-latte',
            productName: 'Latte',
            unitPrice: 13,
            quantity: 1,
            lineTotal: 13,
          },
          {
            productId: 'product-iced-latte',
            productName: 'Iced latte',
            unitPrice: 15,
            quantity: 1,
            lineTotal: 15,
          },
        ],
        total: 28,
      }),
    );

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.REMOVE_ITEMS,
        items: [{ productName: 'lat', quantity: 1 }],
        conversationId: 'conversation-1',
        context,
      }),
    ) as { orderOperationStatus: string; issues: Array<{ candidates: string[] }> };

    expect(result.orderOperationStatus).toBe('clarification_required');
    expect(result.issues[0]?.candidates).toEqual(['Latte', 'Iced latte']);
    expect(orders.removeItems).not.toHaveBeenCalled();
  });

  it('delegates review without allowing the model to supply prices or totals', async () => {
    const { tool, orders } = createTool();
    orders.review.mockResolvedValue(order({ status: OrderStatus.COLLECTING_CUSTOMER_DATA }));

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.REVIEW,
        items: [],
        conversationId: 'conversation-1',
        context,
      }),
    ) as {
      orderOperationStatus: string;
      action: string;
      order: { total: number; currency: string };
      workflow: { allowedActions: string[]; canConfirm: boolean; nextAction: string };
    };

    expect(orders.review).toHaveBeenCalledWith('conversation-1', context);
    expect(result).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'completed',
        action: OrderAction.REVIEW,
      }),
    );
    expect(result.order).toEqual(expect.objectContaining({ total: 35, currency: 'PEN' }));
    expect(result.workflow).toEqual({
      allowedActions: [OrderAction.ADD_ITEMS, OrderAction.REMOVE_ITEMS, OrderAction.CANCEL],
      canConfirm: false,
      nextAction: null,
      missingCustomerFields: ['customerName', 'customerPhone'],
    });
  });

  it('stores supplied customer details and exposes only a masked phone to the model', async () => {
    const { tool, orders } = createTool();
    orders.setCustomerDetails.mockResolvedValue(
      order({
        status: OrderStatus.CONFIRMING_ORDER,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
      }),
    );

    const result = JSON.parse(
      await tool.setCustomerDetails(
        { customerName: 'Ana Pérez', customerPhone: '+51 987 654 321' },
        'conversation-1',
        context,
      ),
    ) as {
      orderOperationStatus: string;
      order: { customer: { name: string; maskedPhone: string } };
      workflow: { canConfirm: boolean; missingCustomerFields: string[] };
    };

    expect(orders.setCustomerDetails).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        customerName: 'Ana Pérez',
        customerPhone: '+51 987 654 321',
      },
      context,
    );
    expect(result.orderOperationStatus).toBe('completed');
    expect(result.order.customer).toEqual({
      name: 'Ana Pérez',
      maskedPhone: '*********321',
    });
    expect(result.workflow).toEqual(
      expect.objectContaining({ canConfirm: true, missingCustomerFields: [] }),
    );
  });

  it.each([
    {
      error: new CustomerPhoneLengthError(),
      expectedIssue: {
        reason: 'invalid_customer_phone_length',
        minimumDigits: 8,
        maximumDigits: 15,
      },
    },
    {
      error: new CustomerPhoneFormatError(),
      expectedIssue: { reason: 'invalid_customer_phone_format' },
    },
    {
      error: new CustomerNameValidationError(),
      expectedIssue: {
        reason: 'invalid_customer_name',
        minimumCharacters: 2,
        maximumCharacters: 100,
      },
    },
    {
      error: new CustomerDetailsRequiredError(),
      expectedIssue: { reason: 'customer_details_required' },
    },
  ])('returns a specific customer validation issue for $expectedIssue.reason', async (testCase) => {
    const { tool, orders } = createTool();
    orders.setCustomerDetails.mockRejectedValue(testCase.error);

    await expect(
      tool.setCustomerDetails(
        { customerName: 'Ana', customerPhone: '1234' },
        'conversation-1',
        context,
      ),
    ).resolves.toBe(
      JSON.stringify({
        orderOperationStatus: 'rejected',
        action: OrderAction.SET_CUSTOMER_DETAILS,
        order: null,
        workflow: null,
        issues: [testCase.expectedIssue],
      }),
    );
  });

  it('returns the unchanged order so the assistant can request every missing customer field', async () => {
    const { tool, orders } = createTool();
    orders.setCustomerDetails.mockRejectedValue(new CustomerPhoneLengthError());
    orders.getActiveOrder.mockResolvedValue(
      order({
        status: OrderStatus.COLLECTING_CUSTOMER_DATA,
        customerName: null,
        customerPhone: null,
      }),
    );

    const result = JSON.parse(
      await tool.setCustomerDetails(
        { customerName: 'Juan José', customerPhone: '998877' },
        'conversation-1',
        context,
      ),
    ) as {
      order: { customer: { name: string | null; maskedPhone: string | null } };
      workflow: { missingCustomerFields: string[] };
      issues: Array<{ reason: string; minimumDigits: number; maximumDigits: number }>;
    };

    expect(orders.getActiveOrder).toHaveBeenCalledWith('conversation-1', context);
    expect(result.order.customer).toEqual({ name: null, maskedPhone: null });
    expect(result.workflow.missingCustomerFields).toEqual(['customerName', 'customerPhone']);
    expect(result.issues).toEqual([
      { reason: 'invalid_customer_phone_length', minimumDigits: 8, maximumDigits: 15 },
    ]);
  });

  it('keeps a valid name when the supplied phone is rejected', async () => {
    const { tool, orders } = createTool();
    const orderWithName = order({
      status: OrderStatus.COLLECTING_CUSTOMER_DATA,
      customerName: 'Juan José',
      customerPhone: null,
    });
    orders.setCustomerDetails
      .mockRejectedValueOnce(new CustomerPhoneLengthError())
      .mockResolvedValueOnce(orderWithName);
    orders.getActiveOrder.mockResolvedValue(orderWithName);

    const result = JSON.parse(
      await tool.setCustomerDetails(
        { customerName: 'Juan José', customerPhone: '998877' },
        'conversation-1',
        context,
      ),
    ) as {
      order: { customer: { name: string | null; maskedPhone: string | null } };
      workflow: { missingCustomerFields: string[] };
      issues: Array<{ reason: string }>;
    };

    expect(orders.setCustomerDetails).toHaveBeenNthCalledWith(
      2,
      { conversationId: 'conversation-1', customerName: 'Juan José' },
      context,
    );
    expect(result.order.customer).toEqual({ name: 'Juan José', maskedPhone: null });
    expect(result.workflow.missingCustomerFields).toEqual(['customerPhone']);
    expect(result.issues).toEqual([
      expect.objectContaining({ reason: 'invalid_customer_phone_length' }),
    ]);
  });

  it('turns a domain rejection into data the assistant can explain', async () => {
    const { tool, orders } = createTool();
    orders.confirm.mockRejectedValue(new ActiveOrderNotFoundError());

    await expect(
      tool.execute({
        action: OrderAction.CONFIRM,
        items: [],
        conversationId: 'conversation-1',
        context,
      }),
    ).resolves.toBe(
      JSON.stringify({
        orderOperationStatus: 'rejected',
        action: OrderAction.CONFIRM,
        order: null,
        workflow: null,
        issues: [{ reason: 'no_active_order' }],
      }),
    );
  });

  it('marks a repeated confirmation as an idempotent replay', async () => {
    const { tool, orders } = createTool();
    orders.confirm.mockResolvedValue({
      ...order({ status: OrderStatus.CONFIRMED }),
      idempotentReplay: true,
    });

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.CONFIRM,
        items: [],
        conversationId: 'conversation-1',
        context,
      }),
    ) as { orderOperationStatus: string; idempotentReplay: boolean };

    expect(result).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'completed',
        action: OrderAction.CONFIRM,
        idempotentReplay: true,
      }),
    );
  });

  it('returns the valid next step when confirmation is attempted before review', async () => {
    const { tool, orders } = createTool();
    orders.confirm.mockRejectedValue(
      new InvalidOrderTransitionError(OrderStatus.SELECTING_PRODUCTS, OrderAction.CONFIRM),
    );
    orders.getActiveOrder.mockResolvedValue(order());

    const result = JSON.parse(
      await tool.execute({
        action: OrderAction.CONFIRM,
        items: [],
        conversationId: 'conversation-1',
        context,
      }),
    ) as {
      orderOperationStatus: string;
      action: string;
      order: { total: number; currency: string };
      workflow: {
        allowedActions: string[];
        canConfirm: boolean;
        nextAction: string;
      };
      issues: Array<{ reason: string }>;
    };

    expect(result.orderOperationStatus).toBe('rejected');
    expect(result.action).toBe(OrderAction.CONFIRM);
    expect(result.order).toEqual(expect.objectContaining({ total: 35, currency: 'PEN' }));
    expect(result.workflow).toEqual({
      allowedActions: [
        OrderAction.ADD_ITEMS,
        OrderAction.REMOVE_ITEMS,
        OrderAction.REVIEW,
        OrderAction.CANCEL,
      ],
      canConfirm: false,
      nextAction: OrderAction.REVIEW,
      missingCustomerFields: ['customerName', 'customerPhone'],
    });
    expect(result.issues).toEqual([{ reason: 'invalid_transition' }]);
  });

  it('propagates infrastructure failures instead of presenting them as business rejections', async () => {
    const { tool, orders } = createTool();
    orders.cancel.mockRejectedValue(new DatabaseUnavailableException());

    await expect(
      tool.execute({
        action: OrderAction.CANCEL,
        items: [],
        conversationId: 'conversation-1',
        context,
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableException);
  });
});
