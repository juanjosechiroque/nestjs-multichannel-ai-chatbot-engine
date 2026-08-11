import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConversationService } from '../../conversation/conversation.service';
import { PrismaService } from '../../database/prisma.service';
import { ChatService } from '../chat.service';
import { ConversationSecurityJudgeService } from './conversation-security-judge.service';
import type {
  ConversationSecurityEvaluationCase,
  ConversationSecurityEvaluationReport,
  ConversationSecurityEvaluationResult,
  ConversationSecurityEvaluationSample,
} from './conversation-security-evaluation.types';

@Injectable()
export class ConversationSecurityEvaluationService {
  constructor(
    @Inject(ChatService)
    private readonly chat: Pick<ChatService, 'reply'>,
    @Inject(ConversationService)
    private readonly conversations: Pick<ConversationService, 'create'>,
    @Inject(ConversationSecurityJudgeService)
    private readonly judge: Pick<ConversationSecurityJudgeService, 'evaluate'>,
    private readonly prisma: PrismaService,
  ) {}

  async evaluate(
    evaluationCases: readonly ConversationSecurityEvaluationCase[],
  ): Promise<ConversationSecurityEvaluationReport> {
    if (evaluationCases.length === 0) {
      throw new RangeError('At least one conversation security evaluation case is required');
    }

    const caseNames = new Set(evaluationCases.map((evaluationCase) => evaluationCase.name));
    if (caseNames.size !== evaluationCases.length) {
      throw new RangeError('Conversation security evaluation case names must be unique');
    }

    const samples: ConversationSecurityEvaluationSample[] = [];

    for (const evaluationCase of evaluationCases) {
      const conversation = await this.conversations.create('web');

      try {
        const result = await this.chat.reply({
          requestId: `security-eval-${randomUUID()}`,
          conversationId: conversation.id,
          channel: 'web',
          message: evaluationCase.message,
        });

        samples.push({ ...evaluationCase, answer: result.reply });
      } finally {
        await this.prisma.conversation.delete({ where: { id: conversation.id } });
      }
    }

    const decisions = await this.judge.evaluate(samples);
    const decisionsByName = new Map(decisions.map((decision) => [decision.name, decision]));
    const results: ConversationSecurityEvaluationResult[] = samples.map((sample) => {
      const decision = decisionsByName.get(sample.name);
      if (!decision) {
        throw new Error(`Missing security evaluation decision for: ${sample.name}`);
      }

      const forbiddenMarker = sample.forbiddenAnswerMarkers?.find((marker) =>
        sample.answer.toLocaleLowerCase().includes(marker.toLocaleLowerCase()),
      );

      return {
        ...sample,
        passed: decision.passed && forbiddenMarker === undefined,
        reason: forbiddenMarker
          ? `The answer contained the forbidden marker: ${forbiddenMarker}`
          : decision.reason,
      };
    });
    const passed = results.filter((result) => result.passed).length;

    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: Number(((passed / results.length) * 100).toFixed(2)),
      results,
    };
  }
}
