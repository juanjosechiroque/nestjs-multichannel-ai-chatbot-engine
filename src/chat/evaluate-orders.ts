import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { cafeNubeProducts } from '../../prisma/seed-data/cafe-nube';
import { PrismaService } from '../database/prisma.service';
import { ORDER_CONVERSATION_EVALUATION_CASES } from './evaluation/order-conversation-evaluation.cases';
import { OrderConversationEvaluationService } from './evaluation/order-conversation-evaluation.service';
import { startOrderEvaluationDatabase } from './evaluation/order-evaluation-database';

async function evaluateOrders(): Promise<void> {
  const logger = new Logger('OrderConversationEvaluation');
  const previousNodeEnvironment = process.env.NODE_ENV;
  const previousDatabaseUrl = process.env.DATABASE_URL;
  const database = await startOrderEvaluationDatabase();
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = database.connectionString;
  let application: Awaited<ReturnType<typeof NestFactory.createApplicationContext>> | undefined;

  try {
    const { AppModule } = await import('../app.module');
    application = await NestFactory.createApplicationContext(AppModule);
    const prisma = application.get(PrismaService);
    await seedProducts(prisma);

    const requestedCaseName = process.env.CHAT_ORDER_EVALUATION_CASE;
    const evaluationCases = requestedCaseName
      ? ORDER_CONVERSATION_EVALUATION_CASES.filter(
          (evaluationCase) => evaluationCase.name === requestedCaseName,
        )
      : ORDER_CONVERSATION_EVALUATION_CASES;
    if (evaluationCases.length === 0) {
      throw new Error(`Unknown order evaluation case: ${requestedCaseName}`);
    }

    const report = await application
      .get(OrderConversationEvaluationService)
      .evaluate(evaluationCases);
    const model = application.get(ConfigService).getOrThrow<string>('OPENAI_MODEL');

    for (const result of report.results) {
      logger.log({
        event: 'chat.order_evaluation.case.completed',
        name: result.name,
        category: result.category,
        conversationId: result.conversationId,
        turns: result.turns,
        expectedOrder: result.expectedOrder,
        actualOrder: result.actualOrder,
        expectedOrderCount: result.expectedOrderCount,
        actualOrderCount: result.actualOrderCount,
        passed: result.passed,
        failures: result.failures,
      });
    }
    logger.log({
      event: 'chat.order_evaluation.completed',
      model,
      databaseName: database.databaseName,
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      passRate: report.passRate,
      totalTurns: report.totalTurns,
      totalDurationMs: report.totalDurationMs,
    });
    if (report.failed > 0) process.exitCode = 1;
  } finally {
    await application?.close();
    await database.stop();
    restoreEnvironment('NODE_ENV', previousNodeEnvironment);
    restoreEnvironment('DATABASE_URL', previousDatabaseUrl);
  }
}

async function seedProducts(prisma: PrismaService): Promise<void> {
  for (const product of cafeNubeProducts) {
    await prisma.product.create({ data: product });
  }
}

function restoreEnvironment(name: 'NODE_ENV' | 'DATABASE_URL', value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

evaluateOrders().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown order evaluation error';
  console.error(`Order conversation evaluation failed: ${message}`);
  process.exitCode = 1;
});
