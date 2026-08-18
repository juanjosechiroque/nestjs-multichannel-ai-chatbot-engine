import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConversationService } from '../../conversation/conversation.service';
import { PrismaService } from '../../database/prisma.service';
import { OrderStatus as PersistedOrderStatus } from '../../generated/prisma/enums';
import { OrderStatus } from '../../order/order.types';
import { ChatService } from '../chat.service';
import { addTokenUsage, emptyTokenUsage } from '../token-usage';
import type {
  ExpectedOrderSnapshot,
  OrderConversationEvaluationCase,
  OrderConversationEvaluationReport,
  OrderConversationEvaluationResult,
  OrderConversationEvaluationTurnResult,
} from './order-conversation-evaluation.types';

const DOMAIN_STATUS: Record<PersistedOrderStatus, OrderStatus> = {
  [PersistedOrderStatus.STARTED]: OrderStatus.STARTED,
  [PersistedOrderStatus.SELECTING_PRODUCTS]: OrderStatus.SELECTING_PRODUCTS,
  [PersistedOrderStatus.COLLECTING_CUSTOMER_DATA]: OrderStatus.COLLECTING_CUSTOMER_DATA,
  [PersistedOrderStatus.CONFIRMING_ORDER]: OrderStatus.CONFIRMING_ORDER,
  [PersistedOrderStatus.CONFIRMED]: OrderStatus.CONFIRMED,
  [PersistedOrderStatus.CANCELLED]: OrderStatus.CANCELLED,
  [PersistedOrderStatus.EXPIRED]: OrderStatus.EXPIRED,
};

const INTERNAL_STATUS_PATTERN =
  /\b(?:STARTED|SELECTING_PRODUCTS|COLLECTING_CUSTOMER_DATA|CONFIRMING_ORDER|CONFIRMED|CANCELLED|EXPIRED)\b/;

@Injectable()
export class OrderConversationEvaluationService {
  constructor(
    @Inject(ChatService)
    private readonly chat: Pick<ChatService, 'reply'>,
    private readonly conversations: ConversationService,
    private readonly prisma: PrismaService,
  ) {}

  async evaluate(
    evaluationCases: readonly OrderConversationEvaluationCase[],
  ): Promise<OrderConversationEvaluationReport> {
    this.validateCases(evaluationCases);
    const startedAt = Date.now();
    const results: OrderConversationEvaluationResult[] = [];

    for (const evaluationCase of evaluationCases) {
      results.push(await this.evaluateCase(evaluationCase));
    }

    const passed = results.filter((result) => result.passed).length;
    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: Number(((passed / results.length) * 100).toFixed(2)),
      totalTurns: results.reduce((total, result) => total + result.turns.length, 0),
      totalDurationMs: Date.now() - startedAt,
      tokenUsage: addTokenUsage(results.map((result) => result.tokenUsage)),
      results,
    };
  }

  private async evaluateCase(
    evaluationCase: OrderConversationEvaluationCase,
  ): Promise<OrderConversationEvaluationResult> {
    const conversation = await this.conversations.create('web', {
      requestId: `order-eval-create-${randomUUID()}`,
      channel: 'web',
    });
    const turnResults: OrderConversationEvaluationTurnResult[] = [];
    const caseFailures: string[] = [];

    for (const turn of evaluationCase.turns) {
      const turnStartedAt = Date.now();
      try {
        const response = await this.chat.reply({
          requestId: `order-eval-${randomUUID()}`,
          messageId: randomUUID(),
          conversationId: conversation.id,
          channel: 'web',
          message: turn.message,
        });
        const actualOrder = await this.findLatestOrder(conversation.id);
        const failures = this.getTurnFailures(
          turn.expectedStatus,
          turn.expectedReplyTerms ?? [],
          actualOrder?.status ?? null,
          response.reply,
        );
        turnResults.push({
          message: turn.message,
          answer: response.reply,
          expectedStatus: turn.expectedStatus,
          actualStatus: actualOrder?.status ?? null,
          durationMs: Date.now() - turnStartedAt,
          tokenUsage: response.tokenUsage ?? emptyTokenUsage(),
          passed: failures.length === 0,
          failures,
        });
        caseFailures.push(...failures.map((failure) => `${turn.message}: ${failure}`));
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown evaluation error';
        const failure = `Conversation turn failed: ${message}`;
        turnResults.push({
          message: turn.message,
          answer: '',
          expectedStatus: turn.expectedStatus,
          actualStatus: (await this.findLatestOrder(conversation.id))?.status ?? null,
          durationMs: Date.now() - turnStartedAt,
          tokenUsage: emptyTokenUsage(),
          passed: false,
          failures: [failure],
        });
        caseFailures.push(`${turn.message}: ${failure}`);
        break;
      }
    }

    const actualOrder = await this.findLatestOrder(conversation.id);
    const actualOrderCount = await this.prisma.order.count({
      where: { conversationId: conversation.id },
    });
    caseFailures.push(
      ...this.getFinalFailures(
        evaluationCase.expectedOrder,
        actualOrder,
        evaluationCase.expectedOrderCount,
        actualOrderCount,
      ),
    );

    return {
      name: evaluationCase.name,
      category: evaluationCase.category,
      conversationId: conversation.id,
      turns: turnResults,
      expectedOrder: evaluationCase.expectedOrder,
      actualOrder,
      expectedOrderCount: evaluationCase.expectedOrderCount,
      actualOrderCount,
      tokenUsage: addTokenUsage(turnResults.map((turn) => turn.tokenUsage)),
      passed: caseFailures.length === 0,
      failures: caseFailures,
    };
  }

  private async findLatestOrder(conversationId: string): Promise<ExpectedOrderSnapshot | null> {
    const order = await this.prisma.order.findFirst({
      where: { conversationId },
      include: { items: { orderBy: { productName: 'asc' } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });

    return order
      ? {
          status: DOMAIN_STATUS[order.status],
          total: order.total.toNumber(),
          orderNumberAssigned: order.orderNumber !== null,
          customerName: order.customerName,
          customerPhone: order.customerPhone,
          items: order.items.map((item) => ({
            productName: item.productName,
            quantity: item.quantity,
          })),
        }
      : null;
  }

  private getTurnFailures(
    expectedStatus: OrderStatus | null,
    expectedReplyTerms: readonly string[],
    actualStatus: OrderStatus | null,
    answer: string,
  ): string[] {
    const failures: string[] = [];
    if (actualStatus !== expectedStatus) {
      failures.push(
        `Expected status ${String(expectedStatus)} but received ${String(actualStatus)}.`,
      );
    }
    const normalizedAnswer = this.normalize(answer);
    for (const term of expectedReplyTerms) {
      if (!normalizedAnswer.includes(this.normalize(term))) {
        failures.push(`Answer did not include the expected term "${term}".`);
      }
    }
    if (INTERNAL_STATUS_PATTERN.test(answer)) {
      failures.push('Answer exposed an internal order status.');
    }
    return failures;
  }

  private getFinalFailures(
    expected: ExpectedOrderSnapshot | null,
    actual: ExpectedOrderSnapshot | null,
    expectedOrderCount: number,
    actualOrderCount: number,
  ): string[] {
    const failures: string[] = [];
    if (actualOrderCount !== expectedOrderCount) {
      failures.push(
        `Expected ${expectedOrderCount} persisted orders but found ${actualOrderCount}.`,
      );
    }
    if (!expected || !actual) {
      if (expected !== actual)
        failures.push('Final persisted order did not match the expectation.');
      return failures;
    }
    if (actual.status !== expected.status) {
      failures.push(`Expected final status ${expected.status} but received ${actual.status}.`);
    }
    if (actual.total !== expected.total) {
      failures.push(`Expected final total ${expected.total} but received ${actual.total}.`);
    }
    if (
      expected.orderNumberAssigned !== undefined &&
      actual.orderNumberAssigned !== expected.orderNumberAssigned
    ) {
      failures.push('Final public order number assignment did not match the expectation.');
    }
    if (expected.customerName !== undefined && actual.customerName !== expected.customerName) {
      failures.push('Final customer name did not match the expectation.');
    }
    if (expected.customerPhone !== undefined && actual.customerPhone !== expected.customerPhone) {
      failures.push('Final customer phone did not match the expectation.');
    }
    if (
      JSON.stringify(this.sortItems(actual.items)) !==
      JSON.stringify(this.sortItems(expected.items))
    ) {
      failures.push('Final products or quantities did not match the expectation.');
    }
    return failures;
  }

  private sortItems(items: ExpectedOrderSnapshot['items']): ExpectedOrderSnapshot['items'] {
    return [...items].sort((left, right) => left.productName.localeCompare(right.productName));
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }

  private validateCases(evaluationCases: readonly OrderConversationEvaluationCase[]): void {
    if (
      evaluationCases.length !== 1 &&
      (evaluationCases.length < 15 || evaluationCases.length > 20)
    ) {
      throw new RangeError(
        'Order evaluation requires one selected case or between 15 and 20 cases',
      );
    }
    const names = new Set(evaluationCases.map((evaluationCase) => evaluationCase.name));
    if (names.size !== evaluationCases.length) {
      throw new RangeError('Order evaluation case names must be unique');
    }
    if (evaluationCases.some((evaluationCase) => evaluationCase.turns.length === 0)) {
      throw new RangeError('Every order evaluation case requires at least one turn');
    }
  }
}
