import { Prisma } from '../../generated/prisma/client';
import { OrderStatus as PersistedOrderStatus } from '../../generated/prisma/enums';
import { OrderStatus } from '../../order/order.types';
import type { ChatRequest, ChatResult } from '../chat.types';
import type { RequestContext } from '../../common/request-context';
import type { ConversationReference } from '../../conversation/conversation.types';
import type { OrderConversationEvaluationCase } from './order-conversation-evaluation.types';
import { OrderConversationEvaluationService } from './order-conversation-evaluation.service';

const evaluationCase: OrderConversationEvaluationCase = {
  name: 'single latte',
  category: 'add',
  turns: [{ message: 'Agrega un latte', expectedStatus: OrderStatus.SELECTING_PRODUCTS }],
  expectedOrder: {
    status: OrderStatus.SELECTING_PRODUCTS,
    total: 13,
    items: [{ productName: 'Latte', quantity: 1 }],
  },
  expectedOrderCount: 1,
};

function persistedOrder(status: PersistedOrderStatus = PersistedOrderStatus.SELECTING_PRODUCTS) {
  return {
    id: 'order-1',
    status,
    total: new Prisma.Decimal(13),
    createdAt: new Date('2026-08-12T00:00:00.000Z'),
    items: [{ productName: 'Latte', quantity: 1 }],
  };
}

function createService() {
  const reply = jest
    .fn<Promise<ChatResult>, [ChatRequest]>()
    .mockResolvedValue({ reply: 'Agregué un latte.' });
  const create = jest
    .fn<Promise<ConversationReference>, ['web', RequestContext?]>()
    .mockResolvedValue({ id: 'conversation-1', sessionId: 'session-1' });
  const findFirst = jest.fn().mockResolvedValue(persistedOrder());
  const count = jest.fn().mockResolvedValue(1);
  const service = new OrderConversationEvaluationService(
    { reply },
    { create } as never,
    { order: { findFirst, count } } as never,
  );

  return { service, reply, create, findFirst, count };
}

describe('OrderConversationEvaluationService', () => {
  it('passes a conversation when every turn and the persisted order match', async () => {
    const { service, reply, create, findFirst, count } = createService();

    await expect(service.evaluate([evaluationCase])).resolves.toEqual(
      expect.objectContaining({ total: 1, passed: 1, failed: 0, passRate: 100, totalTurns: 1 }),
    );
    expect(create.mock.calls[0]?.[0]).toBe('web');
    const createContext = create.mock.calls[0]?.[1] as { requestId?: string } | undefined;
    expect(createContext?.requestId).toEqual(expect.stringContaining('order-eval-create-'));
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 'conversation-1',
        channel: 'web',
        message: 'Agrega un latte',
      }),
    );
    expect(findFirst).toHaveBeenCalled();
    expect(count).toHaveBeenCalledWith({ where: { conversationId: 'conversation-1' } });
  });

  it('reports state, response vocabulary, totals, items, and order count failures', async () => {
    const { service, reply, findFirst, count } = createService();
    reply.mockResolvedValue({ reply: 'Estado interno: STARTED' });
    findFirst.mockResolvedValue({
      ...persistedOrder(PersistedOrderStatus.STARTED),
      total: new Prisma.Decimal(0),
      items: [],
    });
    count.mockResolvedValue(2);

    const report = await service.evaluate([
      {
        ...evaluationCase,
        turns: [
          {
            message: 'Agrega un latte',
            expectedStatus: OrderStatus.SELECTING_PRODUCTS,
            expectedReplyTerms: ['latte'],
          },
        ],
      },
    ]);

    expect(report.failed).toBe(1);
    const result = report.results[0];
    expect(result?.passed).toBe(false);
    const failureText = result?.failures.join(' ') ?? '';
    for (const expectedFailure of [
      'Expected status',
      'expected term',
      'internal order status',
      'persisted orders',
      'final status',
      'final total',
      'products or quantities',
    ]) {
      expect(failureText).toContain(expectedFailure);
    }
  });

  it('rejects duplicate case names before executing a conversation', async () => {
    const { service, reply } = createService();
    const duplicatedCases = Array.from({ length: 15 }, () => evaluationCase);

    await expect(service.evaluate(duplicatedCases)).rejects.toThrow(
      'Order evaluation case names must be unique',
    );
    expect(reply).not.toHaveBeenCalled();
  });
});
