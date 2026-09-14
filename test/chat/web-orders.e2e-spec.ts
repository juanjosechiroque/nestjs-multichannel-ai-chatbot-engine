import { randomUUID } from 'node:crypto';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { OpenAiRequestFailedException } from '../../src/common/application-error';
import { ProductCategory } from '../../src/generated/prisma/enums';
import { OrderAction, OrderStatus } from '../../src/order/order.types';
import { chatMessage, setupHttpE2E } from '../support/e2e-app';

interface ConversationResponse {
  sessionId: string;
}

describe('Web order workflow HTTP', () => {
  const harness = setupHttpE2E();

  it('creates a multi-product order through the same HTTP chat endpoint', async () => {
    const cappuccinoId = randomUUID();
    const croissantId = randomUUID();
    await harness.prisma.product.createMany({
      data: [
        {
          id: cappuccinoId,
          slug: 'cappuccino-nube',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: croissantId,
          slug: 'croissant-mantequilla',
          name: 'Croissant de mantequilla',
          description: 'Horneado durante la mañana.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
        },
      ],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    harness.generate.mockImplementationOnce(async (input) => {
      toolOutput = await harness.toolBag(input).manageOrder({
        action: OrderAction.ADD_ITEMS,
        items: [
          { productName: 'cappuccino', quantity: 2 },
          { productName: 'croissant', quantity: 1 },
        ],
      });
      return {
        answer: 'Agregué 2 Cappuccino Nube y 1 Croissant de mantequilla. Total: S/ 35.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['manage_order'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega dos cappuccinos y un croissant.'))
      .expect(201, {
        reply: 'Agregué 2 Cappuccino Nube y 1 Croissant de mantequilla. Total: S/ 35.',
      });

    const orderToolResult: unknown = JSON.parse(toolOutput ?? '');
    expect(orderToolResult).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'completed',
        action: 'ADD_ITEMS',
        issues: [],
      }),
    );
    const typedOrderToolResult = orderToolResult as {
      order: { items: unknown[] };
      workflow: {
        allowedActions: string[];
        canConfirm: boolean;
        nextAction: string;
        missingCustomerFields: string[];
      };
    };
    expect(typedOrderToolResult.workflow).toEqual({
      allowedActions: ['ADD_ITEMS', 'REMOVE_ITEMS', 'REVIEW', 'CANCEL'],
      canConfirm: false,
      nextAction: 'REVIEW',
      missingCustomerFields: ['customerName', 'customerPhone'],
    });
    const completedOrder = typedOrderToolResult.order;
    expect(completedOrder).toEqual(expect.objectContaining({ total: 35, currency: 'PEN' }));
    expect(completedOrder.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productName: 'Cappuccino Nube',
          unitPrice: 13,
          quantity: 2,
          lineTotal: 26,
        }),
        expect.objectContaining({
          productName: 'Croissant de mantequilla',
          unitPrice: 9,
          quantity: 1,
          lineTotal: 9,
        }),
      ]),
    );
    const persistedOrder = await harness.prisma.order.findFirstOrThrow({
      include: { items: true },
    });
    expect(persistedOrder.total.toNumber()).toBe(35);
    expect(persistedOrder.items).toHaveLength(2);
  });

  it('uses the persisted order workflow to confirm an explicit approval', async () => {
    await harness.prisma.product.create({
      data: {
        id: randomUUID(),
        slug: 'latte',
        name: 'Latte',
        description: 'Espresso con leche vaporizada.',
        price: '13.00',
        category: ProductCategory.HOT_DRINK,
        active: true,
      },
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let publicOrderNumber: number | undefined;

    harness.generate
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext).toEqual({
          activeOrder: null,
          confirmationReplayAvailable: false,
        });
        await harness.toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 3 }],
        });
        return {
          answer: 'Agregué 3 lattes. ¿Deseas agregar algo más o revisar tu pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.workflow).toEqual({
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
        await harness.toolBag(input).manageOrder({ action: OrderAction.REVIEW, items: [] });
        return {
          answer: 'Llevas 3 lattes por S/ 39. ¿Cuál es tu nombre y número de celular?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('Soy Ana Pérez, mi celular es +51 987 654 321.');
        expect(input.orderContext.activeOrder?.workflow).toEqual({
          allowedActions: [OrderAction.ADD_ITEMS, OrderAction.REMOVE_ITEMS, OrderAction.CANCEL],
          canConfirm: false,
          nextAction: null,
          missingCustomerFields: ['customerName', 'customerPhone'],
        });
        await harness.toolBag(input).setOrderCustomer({
          customerName: 'Ana Pérez',
          customerPhone: '+51 987 654 321',
        });
        return {
          answer: 'Ana, llevas 3 lattes por S/ 39. ¿Deseas confirmar el pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['set_order_customer'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('sí');
        expect(input.orderContext.activeOrder?.workflow).toEqual({
          allowedActions: [
            OrderAction.ADD_ITEMS,
            OrderAction.REMOVE_ITEMS,
            OrderAction.CONFIRM,
            OrderAction.CANCEL,
          ],
          canConfirm: true,
          nextAction: OrderAction.CONFIRM,
          missingCustomerFields: [],
        });
        const result = JSON.parse(
          await harness.toolBag(input).manageOrder({ action: OrderAction.CONFIRM, items: [] }),
        ) as { order: { orderNumber: number } };
        publicOrderNumber = result.order.orderNumber;
        return {
          answer: `Tu pedido #${publicOrderNumber} fue confirmado. Total: S/ 39.`,
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('sí, confirma de nuevo');
        expect(input.orderContext.activeOrder).toBeNull();
        expect(input.orderContext.confirmationReplayAvailable).toBe(true);
        const result = JSON.parse(
          await harness.toolBag(input).manageOrder({ action: OrderAction.CONFIRM, items: [] }),
        ) as { idempotentReplay: boolean };
        expect(result.idempotentReplay).toBe(true);
        return {
          answer: 'Ese mismo pedido ya estaba confirmado; no se creó otro.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero tres lattes.'))
      .expect(201);
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Revisar pedido.'))
      .expect(201);
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Soy Ana Pérez, mi celular es +51 987 654 321.'))
      .expect(201, { reply: 'Ana, llevas 3 lattes por S/ 39. Deseas confirmar el pedido?' });
    await request(harness.server).post('/api/chat').send(chatMessage(sessionId, 'sí')).expect(201);

    const firstConfirmation = await harness.prisma.order.findFirstOrThrow();
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'sí, confirma de nuevo'))
      .expect(201, { reply: 'Ese mismo pedido ya estaba confirmado; no se creó otro.' });

    const confirmedOrder = await harness.prisma.order.findFirstOrThrow();
    expect(confirmedOrder.status).toBe(OrderStatus.CONFIRMED);
    expect(confirmedOrder.total.toNumber()).toBe(39);
    expect(confirmedOrder.orderNumber).toBe(publicOrderNumber);
    expect(confirmedOrder.customerName).toBe('Ana Pérez');
    expect(confirmedOrder.customerPhone).toBe('+51987654321');
    expect(confirmedOrder.id).toBe(firstConfirmation.id);
    expect(confirmedOrder.updatedAt).toEqual(firstConfirmation.updatedAt);
    await expect(harness.prisma.order.count()).resolves.toBe(1);
  });

  it('cancels an active order without deleting its audit trail', async () => {
    await harness.prisma.product.create({
      data: {
        slug: 'cancel-latte',
        name: 'Latte',
        description: 'Espresso con leche vaporizada.',
        price: '13.00',
        category: ProductCategory.HOT_DRINK,
      },
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 1 }],
        });
        return {
          answer: 'Agregué un latte. ¿Deseas algo más o revisar tu pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).manageOrder({ action: OrderAction.CANCEL, items: [] });
        return {
          answer: 'Pedido cancelado.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega un latte'))
      .expect(201);
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Cancela el pedido'))
      .expect(201, { reply: 'Pedido cancelado.' });

    const cancelledOrder = await harness.prisma.order.findFirstOrThrow({
      include: { items: true },
    });
    expect(cancelledOrder.status).toBe(OrderStatus.CANCELLED);
    expect(cancelledOrder.items).toHaveLength(1);
    expect(cancelledOrder.total.toNumber()).toBe(13);
  });

  it('returns to product selection when the customer modifies a reviewed order', async () => {
    await harness.prisma.product.create({
      data: {
        slug: 'modify-cappuccino',
        name: 'Cappuccino',
        description: 'Espresso con leche vaporizada.',
        price: '12.00',
        category: ProductCategory.HOT_DRINK,
      },
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Cappuccino', quantity: 2 }],
        });
        return {
          answer: 'Agregué dos cappuccinos.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).manageOrder({ action: OrderAction.REVIEW, items: [] });
        return {
          answer: 'Tu pedido contiene dos cappuccinos. Total: S/ 24. ¿Deseas cambiar algo?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.workflow.canConfirm).toBe(false);
        expect(input.orderContext.activeOrder?.workflow.missingCustomerFields).toEqual([
          'customerName',
          'customerPhone',
        ]);
        await harness.toolBag(input).manageOrder({
          action: OrderAction.REMOVE_ITEMS,
          items: [{ productName: 'Cappuccino', quantity: 1 }],
        });
        return {
          answer: 'Quité un cappuccino. Ahora el total es S/ 12.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    for (const message of ['Quiero dos cappuccinos', 'Revisa mi pedido', 'Mejor quita uno']) {
      await request(harness.server)
        .post('/api/chat')
        .send(chatMessage(sessionId, message))
        .expect(201);
    }

    const order = await harness.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.status).toBe(OrderStatus.SELECTING_PRODUCTS);
    expect(order.total.toNumber()).toBe(12);
    expect(order.items).toEqual([expect.objectContaining({ quantity: 1 })]);
  });

  it('preserves an existing draft when a later OpenAI request fails', async () => {
    await harness.prisma.product.create({
      data: {
        slug: 'resilient-brownie',
        name: 'Brownie de cacao',
        description: 'Brownie húmedo con cacao peruano.',
        price: '11.00',
        category: ProductCategory.FOOD,
      },
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate.mockImplementationOnce(async (input) => {
      await harness.toolBag(input).manageOrder({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'Brownie de cacao', quantity: 1 }],
      });
      return {
        answer: 'Agregué un brownie.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['manage_order'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega un brownie'))
      .expect(201);
    harness.generate.mockRejectedValueOnce(new OpenAiRequestFailedException());
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega otro'))
      .expect(503);

    const order = await harness.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.status).toBe(OrderStatus.SELECTING_PRODUCTS);
    expect(order.total.toNumber()).toBe(11);
    expect(order.items).toEqual([expect.objectContaining({ quantity: 1 })]);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('keeps the order context while answering an informational message between changes', async () => {
    await harness.prisma.product.createMany({
      data: [
        {
          slug: 'context-latte',
          name: 'Latte',
          description: 'Espresso con leche.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
        },
        {
          slug: 'context-brownie',
          name: 'Brownie de cacao',
          description: 'Brownie de cacao peruano.',
          price: '11.00',
          category: ProductCategory.FOOD,
        },
      ],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 1 }],
        });
        return {
          answer: 'Agregué un latte.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce((input) => {
        expect(input.orderContext.activeOrder?.order.total).toBe(13);
        return Promise.resolve({
          answer: 'Sí, tenemos brownies.',
          usedSources: [],
          llmCalls: 1,
          usedTools: [],
        });
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.order.total).toBe(13);
        await harness.toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Brownie de cacao', quantity: 1 }],
        });
        return {
          answer: 'También agregué un brownie.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    for (const message of ['Agrega un latte', '¿Tienen brownies?', 'Agrega uno']) {
      await request(harness.server)
        .post('/api/chat')
        .send(chatMessage(sessionId, message))
        .expect(201);
    }

    const order = await harness.prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.total.toNumber()).toBe(24);
    expect(order.items).toHaveLength(2);
  });
});
