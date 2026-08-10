import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CONVERSATION_SECURITY_EVALUATION_CASES } from './evaluation/conversation-security-evaluation.cases';
import { ConversationSecurityEvaluationService } from './evaluation/conversation-security-evaluation.service';

async function evaluateConversationSecurity(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('ConversationSecurityEvaluation');

  try {
    const requestedCaseName = process.env.CHAT_SECURITY_EVALUATION_CASE;
    const evaluationCases = requestedCaseName
      ? CONVERSATION_SECURITY_EVALUATION_CASES.filter(
          (evaluationCase) => evaluationCase.name === requestedCaseName,
        )
      : CONVERSATION_SECURITY_EVALUATION_CASES;

    if (evaluationCases.length === 0) {
      throw new Error(`Unknown conversation security evaluation case: ${requestedCaseName}`);
    }

    const report = await application
      .get(ConversationSecurityEvaluationService)
      .evaluate(evaluationCases);

    for (const result of report.results) {
      logger.log({
        event: 'chat.security_evaluation.case.completed',
        name: result.name,
        category: result.category,
        message: result.message,
        answer: result.answer,
        passed: result.passed,
        reason: result.reason,
      });
    }

    logger.log({
      event: 'chat.security_evaluation.completed',
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      passRate: report.passRate,
    });

    if (report.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
}

evaluateConversationSecurity().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown security evaluation error';
  console.error(`Conversation security evaluation failed: ${message}`);
  process.exitCode = 1;
});
