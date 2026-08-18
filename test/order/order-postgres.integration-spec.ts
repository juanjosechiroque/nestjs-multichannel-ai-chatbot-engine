import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '../../src/database/prisma.service';
import { Prisma } from '../../src/generated/prisma/client';
import {
  ProductCategory,
  OrderStatus as PrismaOrderStatus,
} from '../../src/generated/prisma/enums';
import {
  ActiveOrderNotFoundError,
  OrderCurrencyMismatchError,
  OrderItemQuantityExceededError,
  OrderProductNotAvailableError,
} from '../../src/order/order.errors';
import {
  InvalidOrderTransitionError,
  OrderStateMachine,
} from '../../src/order/order-state-machine';
import { OrderService } from '../../src/order/order.service';
import { OrderStatus } from '../../src/order/order.types';
import { applyMigrations, assertDisposableTestDatabase } from '../support/test-database';

describe('OrderService with PostgreSQL', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let orders: OrderService;
  let conversationId: string;
  let cappuccinoId: string;
  let croissantId: string;
  const previousNodeEnvironment = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const databaseName = `chatbot_engine_order_integration_test_${randomUUID()
      .replaceAll('-', '')
      .slice(0, 16)}`;
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase(databaseName)
      .withUsername('chatbot')
      .withPassword('chatbot')
      .start();

    await applyMigrations(container.getConnectionUri());
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: container.getConnectionUri() }));
    await prisma.$connect();
    await assertDisposableTestDatabase(prisma, databaseName);
    orders = new OrderService(prisma, new OrderStateMachine());
  });

  beforeEach(async () => {
    await prisma.orderItem.deleteMany();
    await prisma.order.deleteMany();
    await prisma.product.deleteMany();
    await prisma.conversation.deleteMany();

    const conversation = await prisma.conversation.create({
      data: { sessionId: randomUUID(), channel: 'web' },
    });
    const [cappuccino, croissant] = await Promise.all([
      prisma.product.create({
        data: {
          slug: 'integration-cappuccino',
          name: 'Cappuccino Nube',
          description: 'Café con leche.',
          price: 13,
          category: ProductCategory.HOT_DRINK,
        },
      }),
      prisma.product.create({
        data: {
          slug: 'integration-croissant',
          name: 'Croissant de mantequilla',
          description: 'Horneado durante la mañana.',
          price: 9,
          category: ProductCategory.FOOD,
        },
      }),
    ]);
    conversationId = conversation.id;
    cappuccinoId = cappuccino.id;
    croissantId = croissant.id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();

    if (previousNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnvironment;
    }
  });

  it('persists a complete order flow with exact totals and state transitions', async () => {
    const firstResult = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 2,
    });
    expect(firstResult).toEqual(
      expect.objectContaining({ status: OrderStatus.SELECTING_PRODUCTS, total: 26 }),
    );

    const secondResult = await orders.addItem({
      conversationId,
      productId: croissantId,
      quantity: 1,
    });
    expect(secondResult.total).toBe(35);
    await expect(orders.review(conversationId)).resolves.toEqual(
      expect.objectContaining({ status: OrderStatus.COLLECTING_CUSTOMER_DATA, total: 35 }),
    );
    await expect(
      orders.setCustomerDetails({
        conversationId,
        customerName: 'Ana Pérez',
        customerPhone: '+51 987-654-321',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.CONFIRMING_ORDER,
        customerName: 'Ana Pérez',
        customerPhone: '+51987654321',
      }),
    );

    const modifiedResult = await orders.removeItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });
    expect(modifiedResult).toEqual(
      expect.objectContaining({ status: OrderStatus.SELECTING_PRODUCTS, total: 22 }),
    );

    await orders.review(conversationId);
    const confirmedResult = await orders.confirm(conversationId);
    expect(confirmedResult).toEqual(
      expect.objectContaining({ status: OrderStatus.CONFIRMED, total: 22 }),
    );
    expect(typeof confirmedResult.orderNumber).toBe('number');
    await expect(orders.getActiveOrder(conversationId)).resolves.toBeNull();

    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: confirmedResult.id },
      include: { items: { orderBy: { productName: 'asc' } } },
    });
    expect(persisted.status).toBe(PrismaOrderStatus.CONFIRMED);
    expect(persisted.orderNumber).toBe(confirmedResult.orderNumber);
    expect(persisted.customerName).toBe('Ana Pérez');
    expect(persisted.customerPhone).toBe('+51987654321');
    expect(persisted.total.toNumber()).toBe(22);
    expect(
      persisted.items.map((item) => [item.productName, item.quantity, item.unitPrice.toNumber()]),
    ).toEqual([
      ['Cappuccino Nube', 1, 13],
      ['Croissant de mantequilla', 1, 9],
    ]);
  });

  it('rejects products that are unavailable when adding or confirming an order', async () => {
    await prisma.product.update({
      where: { id: croissantId },
      data: { availableForOrdering: false },
    });
    await expect(
      orders.addItem({ conversationId, productId: croissantId, quantity: 1 }),
    ).rejects.toBeInstanceOf(OrderProductNotAvailableError);
    await expect(prisma.order.count({ where: { conversationId } })).resolves.toBe(0);

    const draft = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });
    await orders.setCustomerDetails({
      conversationId,
      customerName: 'Ana Pérez',
      customerPhone: '987654321',
    });
    await orders.review(conversationId);
    await prisma.product.update({
      where: { id: cappuccinoId },
      data: { availableForOrdering: false },
    });

    await expect(orders.confirm(conversationId)).rejects.toBeInstanceOf(
      OrderProductNotAvailableError,
    );
    await expect(prisma.order.findUniqueOrThrow({ where: { id: draft.id } })).resolves.toEqual(
      expect.objectContaining({
        status: PrismaOrderStatus.CONFIRMING_ORDER,
        orderNumber: null,
      }),
    );
  });

  it('returns the same confirmed order when confirmation is repeated concurrently', async () => {
    const draft = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });
    await orders.setCustomerDetails({
      conversationId,
      customerName: 'Ana Pérez',
      customerPhone: '987654321',
    });
    await orders.review(conversationId);

    const confirmations = await Promise.all([
      orders.confirm(conversationId),
      orders.confirm(conversationId),
    ]);

    expect(confirmations.map(({ id }) => id)).toEqual([draft.id, draft.id]);
    expect(new Set(confirmations.map(({ orderNumber }) => orderNumber)).size).toBe(1);
    expect(confirmations.map(({ idempotentReplay }) => idempotentReplay).sort()).toEqual([
      false,
      true,
    ]);
    await expect(orders.confirm(conversationId)).resolves.toEqual(
      expect.objectContaining({
        id: draft.id,
        status: OrderStatus.CONFIRMED,
        idempotentReplay: true,
      }),
    );
    await expect(prisma.order.count({ where: { conversationId } })).resolves.toBe(1);
  });

  it('does not replay an older confirmation after a newer order is cancelled', async () => {
    await orders.addItem({ conversationId, productId: cappuccinoId, quantity: 1 });
    await orders.setCustomerDetails({
      conversationId,
      customerName: 'Ana Pérez',
      customerPhone: '987654321',
    });
    await orders.review(conversationId);
    const confirmed = await orders.confirm(conversationId);
    await orders.addItem({ conversationId, productId: croissantId, quantity: 1 });
    await orders.cancel(conversationId);

    await expect(orders.confirm(conversationId)).rejects.toBeInstanceOf(ActiveOrderNotFoundError);
    await expect(orders.getLatestOrder(conversationId)).resolves.toEqual(
      expect.objectContaining({ status: OrderStatus.CANCELLED }),
    );
    await expect(prisma.order.findUniqueOrThrow({ where: { id: confirmed.id } })).resolves.toEqual(
      expect.objectContaining({ status: PrismaOrderStatus.CONFIRMED }),
    );
  });

  it('prevents confirmation after review until name and phone are complete', async () => {
    const draft = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });
    await expect(orders.review(conversationId)).resolves.toEqual(
      expect.objectContaining({ status: OrderStatus.COLLECTING_CUSTOMER_DATA }),
    );
    await orders.setCustomerDetails({ conversationId, customerName: 'Ana Pérez' });

    await expect(orders.confirm(conversationId)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    await expect(orders.getActiveOrder(conversationId)).resolves.toEqual(
      expect.objectContaining({
        id: draft.id,
        status: OrderStatus.COLLECTING_CUSTOMER_DATA,
        customerName: 'Ana Pérez',
        customerPhone: null,
      }),
    );

    await expect(
      orders.setCustomerDetails({ conversationId, customerPhone: '987 654 321' }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: OrderStatus.CONFIRMING_ORDER,
        customerPhone: '987654321',
      }),
    );
  });

  it('merges repeated products in one operation and uses one persisted item', async () => {
    const result = await orders.addItems({
      conversationId,
      items: [
        { productId: cappuccinoId, quantity: 1 },
        { productId: cappuccinoId, quantity: 2 },
      ],
    });

    expect(result).toEqual(
      expect.objectContaining({
        total: 39,
        items: [expect.objectContaining({ quantity: 3, lineTotal: 39 })],
      }),
    );
    await expect(prisma.orderItem.count({ where: { orderId: result.id } })).resolves.toBe(1);
  });

  it.each([0, -1, 1.5])(
    'rejects invalid quantity %s without creating an order',
    async (quantity) => {
      await expect(
        orders.addItem({ conversationId, productId: cappuccinoId, quantity }),
      ).rejects.toBeInstanceOf(RangeError);
      await expect(prisma.order.count({ where: { conversationId } })).resolves.toBe(0);
    },
  );

  it('keeps terminal orders and starts a new draft for the next purchase', async () => {
    const firstOrder = await orders.addItem({
      conversationId,
      productId: croissantId,
      quantity: 1,
    });
    await orders.cancel(conversationId);

    const secondOrder = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });

    expect(secondOrder.id).not.toBe(firstOrder.id);
    expect(secondOrder.status).toBe(OrderStatus.SELECTING_PRODUCTS);
    await expect(prisma.order.count({ where: { conversationId } })).resolves.toBe(2);
  });

  it('keeps the original product snapshot when the catalog changes during a draft', async () => {
    await orders.addItem({ conversationId, productId: cappuccinoId, quantity: 1 });
    await prisma.product.update({
      where: { id: cappuccinoId },
      data: { name: 'Cappuccino actualizado', price: 15 },
    });

    const result = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 2,
    });

    expect(result).toEqual(
      expect.objectContaining({
        total: 39,
        items: [
          expect.objectContaining({
            productName: 'Cappuccino Nube',
            unitPrice: 13,
            quantity: 3,
            lineTotal: 39,
          }),
        ],
      }),
    );
  });

  it('rolls back an excessive removal without changing the persisted draft', async () => {
    const initialOrder = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });

    await expect(
      orders.removeItem({ conversationId, productId: cappuccinoId, quantity: 2 }),
    ).rejects.toBeInstanceOf(OrderItemQuantityExceededError);

    const persisted = await prisma.order.findUniqueOrThrow({
      where: { id: initialOrder.id },
      include: { items: true },
    });
    expect(persisted.status).toBe(PrismaOrderStatus.SELECTING_PRODUCTS);
    expect(persisted.total.toNumber()).toBe(13);
    expect(persisted.items).toEqual([
      expect.objectContaining({ quantity: 1, lineTotal: new Prisma.Decimal(13) }),
    ]);
  });

  it('rejects an invalid batch change atomically', async () => {
    const draft = await orders.addItems({
      conversationId,
      items: [
        { productId: cappuccinoId, quantity: 2 },
        { productId: croissantId, quantity: 1 },
      ],
    });

    await expect(
      orders.removeItems({
        conversationId,
        items: [
          { productId: cappuccinoId, quantity: 1 },
          { productId: croissantId, quantity: 2 },
        ],
      }),
    ).rejects.toBeInstanceOf(OrderItemQuantityExceededError);

    const activeOrder = await orders.getActiveOrder(conversationId);
    expect(activeOrder?.id).toBe(draft.id);
    expect(activeOrder?.total).toBe(35);
    expect(activeOrder?.items.map(({ productId, quantity }) => ({ productId, quantity }))).toEqual([
      { productId: cappuccinoId, quantity: 2 },
      { productId: croissantId, quantity: 1 },
    ]);
  });

  it('cancels a reviewed order without deleting its items', async () => {
    const draft = await orders.addItem({
      conversationId,
      productId: croissantId,
      quantity: 2,
    });
    await orders.review(conversationId);

    const cancelled = await orders.cancel(conversationId);

    expect(cancelled).toEqual(
      expect.objectContaining({
        id: draft.id,
        status: OrderStatus.CANCELLED,
        total: 18,
        items: [expect.objectContaining({ quantity: 2 })],
      }),
    );
    await expect(orders.getActiveOrder(conversationId)).resolves.toBeNull();
  });

  it('keeps an empty draft in STARTED and prevents review until it has items', async () => {
    const initialOrder = await orders.addItem({
      conversationId,
      productId: croissantId,
      quantity: 1,
    });
    const emptyOrder = await orders.removeItem({
      conversationId,
      productId: croissantId,
      quantity: 1,
    });

    expect(emptyOrder).toEqual(
      expect.objectContaining({ status: OrderStatus.STARTED, total: 0, items: [] }),
    );
    await expect(orders.review(conversationId)).rejects.toBeInstanceOf(InvalidOrderTransitionError);
    await expect(
      prisma.order.findUniqueOrThrow({ where: { id: initialOrder.id } }),
    ).resolves.toEqual(expect.objectContaining({ status: PrismaOrderStatus.STARTED }));
  });

  it('does not create a draft for an inactive product', async () => {
    await prisma.product.update({ where: { id: cappuccinoId }, data: { active: false } });

    await expect(
      orders.addItem({ conversationId, productId: cappuccinoId, quantity: 1 }),
    ).rejects.toBeInstanceOf(OrderProductNotAvailableError);
    await expect(prisma.order.count({ where: { conversationId } })).resolves.toBe(0);
  });

  it('rejects confirmation before review without changing the order state', async () => {
    const draft = await orders.addItem({
      conversationId,
      productId: cappuccinoId,
      quantity: 1,
    });

    await expect(orders.confirm(conversationId)).rejects.toBeInstanceOf(
      InvalidOrderTransitionError,
    );
    await expect(prisma.order.findUniqueOrThrow({ where: { id: draft.id } })).resolves.toEqual(
      expect.objectContaining({ status: PrismaOrderStatus.SELECTING_PRODUCTS }),
    );
  });

  it('rejects mixed currencies and preserves the existing PEN order', async () => {
    const usdProduct = await prisma.product.create({
      data: {
        slug: 'integration-usd-product',
        name: 'Producto USD',
        description: 'Producto para validar moneda.',
        price: 5,
        currency: 'USD',
        category: ProductCategory.FOOD,
      },
    });
    const draft = await orders.addItem({
      conversationId,
      productId: croissantId,
      quantity: 1,
    });

    await expect(
      orders.addItem({ conversationId, productId: usdProduct.id, quantity: 1 }),
    ).rejects.toBeInstanceOf(OrderCurrencyMismatchError);
    await expect(orders.getActiveOrder(conversationId)).resolves.toEqual(
      expect.objectContaining({ id: draft.id, currency: 'PEN', total: 9 }),
    );
  });

  it('isolates active orders belonging to different conversations', async () => {
    const secondConversation = await prisma.conversation.create({
      data: { sessionId: randomUUID(), channel: 'web' },
    });

    await Promise.all([
      orders.addItem({ conversationId, productId: cappuccinoId, quantity: 1 }),
      orders.addItem({
        conversationId: secondConversation.id,
        productId: croissantId,
        quantity: 2,
      }),
    ]);

    await expect(orders.getActiveOrder(conversationId)).resolves.toEqual(
      expect.objectContaining({ total: 13 }),
    );
    await expect(orders.getActiveOrder(secondConversation.id)).resolves.toEqual(
      expect.objectContaining({ total: 18 }),
    );
  });

  it('merges simultaneous additions into one active order', async () => {
    await Promise.all([
      orders.addItem({ conversationId, productId: cappuccinoId, quantity: 1 }),
      orders.addItem({ conversationId, productId: croissantId, quantity: 1 }),
    ]);

    const activeOrders = await prisma.order.findMany({
      where: {
        conversationId,
        status: {
          in: [
            PrismaOrderStatus.STARTED,
            PrismaOrderStatus.SELECTING_PRODUCTS,
            PrismaOrderStatus.COLLECTING_CUSTOMER_DATA,
            PrismaOrderStatus.CONFIRMING_ORDER,
          ],
        },
      },
      include: { items: true },
    });
    expect(activeOrders).toHaveLength(1);
    expect(activeOrders[0]?.total.toNumber()).toBe(22);
    expect(activeOrders[0]?.items).toHaveLength(2);
  });
});
