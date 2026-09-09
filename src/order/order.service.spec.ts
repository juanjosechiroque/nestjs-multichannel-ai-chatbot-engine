import { Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../common/application-error';
import { Prisma } from '../generated/prisma/client';
import { OrderStatus as PrismaOrderStatus } from '../generated/prisma/enums';
import type { PrismaService } from '../database/prisma.service';
import {
  ActiveOrderNotFoundError,
  CustomerDetailsRequiredError,
  CustomerNameValidationError,
  CustomerPhoneFormatError,
  CustomerPhoneLengthError,
  OrderCurrencyMismatchError,
  OrderItemNotFoundError,
  OrderItemQuantityExceededError,
  OrderProductNotAvailableError,
} from './order.errors';
import { InvalidOrderTransitionError, OrderStateMachine } from './order-state-machine';
import { OrderService } from './order.service';
import { OrderStatus } from './order.types';

const CONVERSATION_ID = '11111111-1111-4111-8111-111111111111';
const ORDER_ID = '22222222-2222-4222-8222-222222222222';
const PRODUCT_ID = '33333333-3333-4333-8333-333333333333';
const ITEM_ID = '44444444-4444-4444-8444-444444444444';

interface CreateOrderItemArguments {
  data: {
    productName: string;
    quantity: number;
    lineTotal: Prisma.Decimal;
  };
}

interface UpdateOrderItemArguments {
  data: {
    quantity: number;
    lineTotal: Prisma.Decimal;
  };
}

function persistedOrder(
  status: PrismaOrderStatus,
  total = 0,
  overrides: Partial<{
    orderNumber: number | null;
    customerName: string | null;
    customerPhone: string | null;
  }> = {},
) {
  return {
    id: ORDER_ID,
    orderNumber: null,
    conversationId: CONVERSATION_ID,
    status,
    total: new Prisma.Decimal(total),
    currency: 'PEN',
    customerName: null,
    customerPhone: null,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
    ...overrides,
  };
}

function persistedItem({
  quantity = 1,
  unitPrice = 13,
}: {
  quantity?: number;
  unitPrice?: number;
} = {}) {
  return {
    id: ITEM_ID,
    orderId: ORDER_ID,
    productId: PRODUCT_ID,
    productName: 'Cappuccino Nube',
    unitPrice: new Prisma.Decimal(unitPrice),
    quantity,
    lineTotal: new Prisma.Decimal(unitPrice).mul(quantity),
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  };
}

function activeProduct(price = 13, currency = 'PEN') {
  return {
    id: PRODUCT_ID,
    slug: 'cappuccino-nube',
    name: 'Cappuccino Nube',
    description: 'Café con leche.',
    price: new Prisma.Decimal(price),
    currency,
    category: 'HOT_DRINK' as const,
    active: true,
    availableForOrdering: true,
    metadata: null,
    createdAt: new Date('2026-08-11T00:00:00.000Z'),
    updatedAt: new Date('2026-08-11T00:00:00.000Z'),
  };
}

function createService() {
  const productFindFirst = jest.fn();
  const productFindMany = jest.fn().mockResolvedValue([{ id: PRODUCT_ID }]);
  const orderFindFirst = jest.fn();
  const orderCreate = jest.fn();
  const orderUpdate = jest.fn();
  const orderItemFindUnique = jest.fn();
  const orderItemFindMany = jest.fn();
  const orderItemCreate = jest.fn<Promise<unknown>, [CreateOrderItemArguments]>();
  const orderItemUpdate = jest.fn<Promise<unknown>, [UpdateOrderItemArguments]>();
  const orderItemDelete = jest.fn();
  const conversationLock = jest.fn().mockResolvedValue([{ locked: 1 }]);
  const transactionClient = {
    $queryRaw: conversationLock,
    product: { findFirst: productFindFirst, findMany: productFindMany },
    order: { findFirst: orderFindFirst, create: orderCreate, update: orderUpdate },
    orderItem: {
      findUnique: orderItemFindUnique,
      findMany: orderItemFindMany,
      create: orderItemCreate,
      update: orderItemUpdate,
      delete: orderItemDelete,
    },
  };
  const transaction = jest.fn((execute: (client: typeof transactionClient) => Promise<unknown>) =>
    execute(transactionClient),
  );
  const prisma = {
    order: { findFirst: orderFindFirst },
    $transaction: transaction,
  } as unknown as PrismaService;
  const service = new OrderService(prisma, new OrderStateMachine());

  return {
    service,
    productFindFirst,
    productFindMany,
    orderFindFirst,
    orderCreate,
    orderUpdate,
    orderItemFindUnique,
    orderItemFindMany,
    orderItemCreate,
    orderItemUpdate,
    orderItemDelete,
    conversationLock,
    transaction,
  };
}

describe('OrderService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the active order with its persisted price snapshots', async () => {
    const { service, orderFindFirst } = createService();
    orderFindFirst.mockResolvedValue({
      ...persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 13),
      items: [persistedItem()],
    });

    await expect(service.getActiveOrder(CONVERSATION_ID)).resolves.toEqual({
      id: ORDER_ID,
      orderNumber: null,
      conversationId: CONVERSATION_ID,
      status: OrderStatus.SELECTING_PRODUCTS,
      total: 13,
      currency: 'PEN',
      customerName: null,
      customerPhone: null,
      items: [
        {
          productId: PRODUCT_ID,
          productName: 'Cappuccino Nube',
          unitPrice: 13,
          quantity: 1,
          lineTotal: 13,
        },
      ],
    });
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: {
        conversationId: CONVERSATION_ID,
        status: {
          in: [
            PrismaOrderStatus.STARTED,
            PrismaOrderStatus.SELECTING_PRODUCTS,
            PrismaOrderStatus.COLLECTING_CUSTOMER_DATA,
            PrismaOrderStatus.CONFIRMING_ORDER,
          ],
        },
      },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: { updatedAt: 'desc' },
    });
  });

  it('returns null when the conversation has no active order', async () => {
    const { service, orderFindFirst } = createService();
    orderFindFirst.mockResolvedValue(null);

    await expect(service.getActiveOrder(CONVERSATION_ID)).resolves.toBeNull();
  });

  it('returns the latest terminal order for trusted conversation context', async () => {
    const { service, orderFindFirst } = createService();
    orderFindFirst.mockResolvedValue({
      ...persistedOrder(PrismaOrderStatus.CONFIRMED, 13),
      items: [persistedItem()],
    });

    await expect(service.getLatestOrder(CONVERSATION_ID)).resolves.toEqual(
      expect.objectContaining({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
        total: 13,
      }),
    );
    expect(orderFindFirst).toHaveBeenCalledWith({
      where: { conversationId: CONVERSATION_ID },
      include: { items: { orderBy: { createdAt: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
    });
  });

  it('creates a draft and snapshots an active product when adding its first item', async () => {
    const {
      service,
      productFindFirst,
      orderFindFirst,
      orderCreate,
      orderUpdate,
      orderItemFindUnique,
      orderItemFindMany,
      orderItemCreate,
      conversationLock,
    } = createService();
    const item = persistedItem({ quantity: 2 });
    productFindFirst.mockResolvedValue(activeProduct());
    orderFindFirst.mockResolvedValue(null);
    orderCreate.mockResolvedValue(persistedOrder(PrismaOrderStatus.STARTED));
    orderItemFindUnique.mockResolvedValue(null);
    orderItemCreate.mockResolvedValue(item);
    orderItemFindMany.mockResolvedValue([item]);
    orderUpdate.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 26));

    await expect(
      service.addItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 2,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.SELECTING_PRODUCTS,
        total: 26,
        items: [expect.objectContaining({ quantity: 2, lineTotal: 26 })],
      }),
    );
    expect(orderCreate).toHaveBeenCalledWith({
      data: {
        conversationId: CONVERSATION_ID,
        status: PrismaOrderStatus.STARTED,
        currency: 'PEN',
      },
    });
    expect(productFindFirst).toHaveBeenCalledWith({
      where: { id: PRODUCT_ID, active: true, availableForOrdering: true },
    });
    expect(conversationLock).toHaveBeenCalledTimes(1);
    const createData = orderItemCreate.mock.calls[0]?.[0].data;
    expect(createData).toMatchObject({ productName: 'Cappuccino Nube', quantity: 2 });
    expect(createData?.lineTotal.toNumber()).toBe(26);
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        status: PrismaOrderStatus.SELECTING_PRODUCTS,
        total: new Prisma.Decimal(26),
      },
    });
  });

  it('increments an existing item using its original price snapshot', async () => {
    const {
      service,
      productFindFirst,
      orderFindFirst,
      orderUpdate,
      orderItemFindUnique,
      orderItemFindMany,
      orderItemUpdate,
    } = createService();
    const originalItem = persistedItem({ quantity: 1, unitPrice: 13 });
    const updatedItem = persistedItem({ quantity: 3, unitPrice: 13 });
    productFindFirst.mockResolvedValue(activeProduct(15));
    orderFindFirst.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 13));
    orderItemFindUnique.mockResolvedValue(originalItem);
    orderItemUpdate.mockResolvedValue(updatedItem);
    orderItemFindMany.mockResolvedValue([updatedItem]);
    orderUpdate.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 39));

    const result = await service.addItem({
      conversationId: CONVERSATION_ID,
      productId: PRODUCT_ID,
      quantity: 2,
    });

    const updateData = orderItemUpdate.mock.calls[0]?.[0].data;
    expect(updateData?.quantity).toBe(3);
    expect(updateData?.lineTotal.toNumber()).toBe(39);
    expect(result.items[0]).toEqual(expect.objectContaining({ unitPrice: 13, lineTotal: 39 }));
  });

  it('rejects unavailable products without creating an order', async () => {
    const { service, productFindFirst, orderCreate } = createService();
    productFindFirst.mockResolvedValue(null);

    await expect(
      service.addItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 1,
      }),
    ).rejects.toEqual(new OrderProductNotAvailableError(PRODUCT_ID));
    expect(orderCreate).not.toHaveBeenCalled();
  });

  it('rejects a product with a different currency from the active order', async () => {
    const { service, productFindFirst, orderFindFirst } = createService();
    productFindFirst.mockResolvedValue(activeProduct(13, 'USD'));
    orderFindFirst.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS));

    await expect(
      service.addItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(OrderCurrencyMismatchError);
  });

  it('removes part of an item and recalculates the order', async () => {
    const {
      service,
      orderFindFirst,
      orderUpdate,
      orderItemFindUnique,
      orderItemFindMany,
      orderItemUpdate,
    } = createService();
    const originalItem = persistedItem({ quantity: 3 });
    const remainingItem = persistedItem({ quantity: 2 });
    orderFindFirst.mockResolvedValue(persistedOrder(PrismaOrderStatus.CONFIRMING_ORDER, 39));
    orderItemFindUnique.mockResolvedValue(originalItem);
    orderItemUpdate.mockResolvedValue(remainingItem);
    orderItemFindMany.mockResolvedValue([remainingItem]);
    orderUpdate.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 26));

    const result = await service.removeItem({
      conversationId: CONVERSATION_ID,
      productId: PRODUCT_ID,
      quantity: 1,
    });

    expect(result).toEqual(
      expect.objectContaining({ status: OrderStatus.SELECTING_PRODUCTS, total: 26 }),
    );
    const updateData = orderItemUpdate.mock.calls[0]?.[0].data;
    expect(updateData?.quantity).toBe(2);
    expect(updateData?.lineTotal.toNumber()).toBe(26);
  });

  it('deletes the last item and returns the order to STARTED', async () => {
    const {
      service,
      orderFindFirst,
      orderUpdate,
      orderItemFindUnique,
      orderItemFindMany,
      orderItemDelete,
    } = createService();
    orderFindFirst.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 13));
    orderItemFindUnique.mockResolvedValue(persistedItem());
    orderItemDelete.mockResolvedValue(persistedItem());
    orderItemFindMany.mockResolvedValue([]);
    orderUpdate.mockResolvedValue(persistedOrder(PrismaOrderStatus.STARTED));

    const result = await service.removeItem({
      conversationId: CONVERSATION_ID,
      productId: PRODUCT_ID,
      quantity: 1,
    });

    expect(orderItemDelete).toHaveBeenCalledWith({ where: { id: ITEM_ID } });
    expect(result).toEqual(
      expect.objectContaining({ status: OrderStatus.STARTED, total: 0, items: [] }),
    );
  });

  it('rejects removing an unknown item or more units than the order contains', async () => {
    const unknownItem = createService();
    unknownItem.orderFindFirst.mockResolvedValue(
      persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS),
    );
    unknownItem.orderItemFindUnique.mockResolvedValue(null);

    await expect(
      unknownItem.service.removeItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 1,
      }),
    ).rejects.toEqual(new OrderItemNotFoundError(PRODUCT_ID));

    const excessiveQuantity = createService();
    excessiveQuantity.orderFindFirst.mockResolvedValue(
      persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS),
    );
    excessiveQuantity.orderItemFindUnique.mockResolvedValue(persistedItem({ quantity: 1 }));

    await expect(
      excessiveQuantity.service.removeItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 2,
      }),
    ).rejects.toEqual(new OrderItemQuantityExceededError(PRODUCT_ID, 2, 1));
  });

  it.each([
    {
      method: 'review' as const,
      currentStatus: PrismaOrderStatus.SELECTING_PRODUCTS,
      expectedStatus: PrismaOrderStatus.COLLECTING_CUSTOMER_DATA,
      items: [persistedItem()],
    },
    {
      method: 'cancel' as const,
      currentStatus: PrismaOrderStatus.SELECTING_PRODUCTS,
      expectedStatus: PrismaOrderStatus.CANCELLED,
      items: [persistedItem()],
    },
    {
      method: 'expire' as const,
      currentStatus: PrismaOrderStatus.STARTED,
      expectedStatus: PrismaOrderStatus.EXPIRED,
      items: [],
    },
  ])(
    'persists $expectedStatus when $method is applied from $currentStatus',
    async ({ method, currentStatus, expectedStatus, items }) => {
      const { service, orderFindFirst, orderItemFindMany, orderUpdate } = createService();
      orderFindFirst.mockResolvedValue(persistedOrder(currentStatus, items.length > 0 ? 13 : 0));
      orderItemFindMany.mockResolvedValue(items);
      orderUpdate.mockResolvedValue(persistedOrder(expectedStatus, items.length > 0 ? 13 : 0));

      const result = await service[method](CONVERSATION_ID);

      expect(result.status).toBe(expectedStatus);
      expect(orderUpdate).toHaveBeenCalledWith({
        where: { id: ORDER_ID },
        data: {
          status: expectedStatus,
          total: new Prisma.Decimal(items.length > 0 ? 13 : 0),
        },
      });
    },
  );

  it('normalizes customer details and moves a reviewed order to confirmation', async () => {
    const { service, orderFindFirst, orderItemFindMany, orderUpdate } = createService();
    const collectingOrder = persistedOrder(PrismaOrderStatus.COLLECTING_CUSTOMER_DATA, 13);
    const orderWithCustomer = persistedOrder(PrismaOrderStatus.COLLECTING_CUSTOMER_DATA, 13, {
      customerName: 'Ana Pérez',
      customerPhone: '+51987654321',
    });
    orderFindFirst.mockResolvedValue(collectingOrder);
    orderItemFindMany.mockResolvedValue([persistedItem()]);
    orderUpdate
      .mockResolvedValueOnce(orderWithCustomer)
      .mockResolvedValueOnce({ ...orderWithCustomer, status: PrismaOrderStatus.CONFIRMING_ORDER });

    await expect(
      service.setCustomerDetails({
        conversationId: CONVERSATION_ID,
        customerName: '  Ana   Pérez ',
        customerPhone: '+51 987-654-321',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.CONFIRMING_ORDER,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
      }),
    );
    expect(orderUpdate).toHaveBeenNthCalledWith(1, {
      where: { id: ORDER_ID },
      data: { customerName: 'Ana Pérez', customerPhone: '+51987654321' },
    });
  });

  it('keeps collecting customer data when only the name is available', async () => {
    const { service, orderFindFirst, orderItemFindMany, orderUpdate } = createService();
    const collectingOrder = persistedOrder(PrismaOrderStatus.COLLECTING_CUSTOMER_DATA, 13);
    const orderWithName = { ...collectingOrder, customerName: 'Ana Pérez' };
    orderFindFirst.mockResolvedValue(collectingOrder);
    orderItemFindMany.mockResolvedValue([persistedItem()]);
    orderUpdate.mockResolvedValueOnce(orderWithName).mockResolvedValueOnce(orderWithName);

    await expect(
      service.setCustomerDetails({
        conversationId: CONVERSATION_ID,
        customerName: 'Ana Pérez',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.COLLECTING_CUSTOMER_DATA,
        customerName: 'Ana Pérez',
        customerPhone: null,
      }),
    );
  });

  it.each([
    { details: { customerName: 'A' }, errorType: CustomerNameValidationError },
    { details: { customerName: '12345678' }, errorType: CustomerNameValidationError },
    { details: { customerPhone: '1234' }, errorType: CustomerPhoneLengthError },
    { details: { customerPhone: 'call987654321' }, errorType: CustomerPhoneFormatError },
    { details: {}, errorType: CustomerDetailsRequiredError },
  ])('rejects invalid customer details before opening a transaction: $details', (testCase) => {
    const { service, transaction } = createService();

    expect(() =>
      service.setCustomerDetails({ conversationId: CONVERSATION_ID, ...testCase.details }),
    ).toThrow(testCase.errorType);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('confirms a complete order and assigns its public number once', async () => {
    const {
      service,
      productFindMany,
      orderFindFirst,
      orderItemFindMany,
      orderUpdate,
      conversationLock,
    } = createService();
    const completeOrder = persistedOrder(PrismaOrderStatus.CONFIRMING_ORDER, 13, {
      customerName: 'Ana Pérez',
      customerPhone: '+51987654321',
    });
    orderFindFirst.mockResolvedValue(completeOrder);
    orderItemFindMany.mockResolvedValue([persistedItem()]);
    conversationLock
      .mockResolvedValueOnce([{ locked: 1 }])
      .mockResolvedValueOnce([{ value: 1000n }]);
    orderUpdate.mockResolvedValue({
      ...completeOrder,
      status: PrismaOrderStatus.CONFIRMED,
      orderNumber: 1000,
    });

    await expect(service.confirm(CONVERSATION_ID)).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.CONFIRMED,
        orderNumber: 1000,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
        idempotentReplay: false,
      }),
    );
    expect(orderUpdate).toHaveBeenCalledWith({
      where: { id: ORDER_ID },
      data: {
        status: PrismaOrderStatus.CONFIRMED,
        total: new Prisma.Decimal(13),
        orderNumber: 1000,
      },
    });
    expect(productFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: [PRODUCT_ID] },
        active: true,
        availableForOrdering: true,
      },
      select: { id: true },
    });
  });

  it('rejects confirmation when a selected product became unavailable', async () => {
    const { service, productFindMany, orderFindFirst, orderItemFindMany, orderUpdate } =
      createService();
    orderFindFirst.mockResolvedValue(
      persistedOrder(PrismaOrderStatus.CONFIRMING_ORDER, 13, {
        customerName: 'Ana Pérez',
        customerPhone: '987654321',
      }),
    );
    orderItemFindMany.mockResolvedValue([persistedItem()]);
    productFindMany.mockResolvedValue([]);

    await expect(service.confirm(CONVERSATION_ID)).rejects.toEqual(
      new OrderProductNotAvailableError(PRODUCT_ID),
    );
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it('rejects status actions without an active order or from an invalid state', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const missingOrder = createService();
    missingOrder.orderFindFirst.mockResolvedValue(null);
    await expect(missingOrder.service.review(CONVERSATION_ID)).rejects.toBeInstanceOf(
      ActiveOrderNotFoundError,
    );

    const invalidTransition = createService();
    invalidTransition.orderFindFirst.mockResolvedValue(
      persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 13),
    );
    invalidTransition.orderItemFindMany.mockResolvedValue([persistedItem()]);
    await expect(invalidTransition.service.confirm(CONVERSATION_ID)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'order.action.rejected',
        operation: 'order.confirm',
        action: 'CONFIRM',
        failureCode: 'InvalidOrderTransitionError',
      }),
    );
  });

  it('replays the latest confirmation without updating the order again', async () => {
    const { service, orderFindFirst, orderItemFindMany, orderUpdate } = createService();
    orderFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(
      persistedOrder(PrismaOrderStatus.CONFIRMED, 13, {
        orderNumber: 1000,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
      }),
    );
    orderItemFindMany.mockResolvedValue([persistedItem()]);

    await expect(service.confirm(CONVERSATION_ID)).resolves.toEqual(
      expect.objectContaining({
        id: ORDER_ID,
        status: OrderStatus.CONFIRMED,
        total: 13,
        idempotentReplay: true,
      }),
    );
    expect(orderUpdate).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5])(
    'rejects the invalid item quantity %s before using PostgreSQL',
    async (quantity) => {
      const { service, transaction } = createService();

      await expect(
        service.addItem({ conversationId: CONVERSATION_ID, productId: PRODUCT_ID, quantity }),
      ).rejects.toThrow('Order item quantity must be a positive integer');
      expect(transaction).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'addItems',
      (service: OrderService) => service.addItems({ conversationId: CONVERSATION_ID, items: [] }),
    ],
    [
      'removeItems',
      (service: OrderService) =>
        service.removeItems({ conversationId: CONVERSATION_ID, items: [] }),
    ],
  ])('rejects an empty %s operation before opening a transaction', async (_name, execute) => {
    const { service, transaction } = createService();

    await expect(execute(service)).rejects.toThrow(
      'An order item operation requires at least one item',
    );
    expect(transaction).not.toHaveBeenCalled();
  });

  it('merges duplicate products in one request before changing the draft', async () => {
    const {
      service,
      productFindFirst,
      orderFindFirst,
      orderCreate,
      orderUpdate,
      orderItemFindUnique,
      orderItemFindMany,
      orderItemCreate,
    } = createService();
    const item = persistedItem({ quantity: 3 });
    productFindFirst.mockResolvedValue(activeProduct());
    orderFindFirst.mockResolvedValue(null);
    orderCreate.mockResolvedValue(persistedOrder(PrismaOrderStatus.STARTED));
    orderItemFindUnique.mockResolvedValue(null);
    orderItemCreate.mockResolvedValue(item);
    orderItemFindMany.mockResolvedValue([item]);
    orderUpdate.mockResolvedValue(persistedOrder(PrismaOrderStatus.SELECTING_PRODUCTS, 39));

    await service.addItems({
      conversationId: CONVERSATION_ID,
      items: [
        { productId: PRODUCT_ID, quantity: 1 },
        { productId: PRODUCT_ID, quantity: 2 },
      ],
    });

    expect(productFindFirst).toHaveBeenCalledTimes(1);
    expect(orderItemCreate.mock.calls[0]?.[0].data.quantity).toBe(3);
  });

  it('turns unexpected PostgreSQL errors into a controlled application error', async () => {
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { service, productFindFirst } = createService();
    productFindFirst.mockRejectedValue(new Error('connection failed'));

    await expect(
      service.addItem({
        conversationId: CONVERSATION_ID,
        productId: PRODUCT_ID,
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(DatabaseUnavailableException);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database.operation.failed',
        operation: 'order.item.add',
        failureCode: 'DATABASE_UNAVAILABLE',
        message: 'connection failed',
      }),
    );
  });
});
