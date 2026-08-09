import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { RAG_EVALUATION_CASES } from './evaluation/rag-evaluation.cases';
import { RagEvaluationService } from './evaluation/rag-evaluation.service';

const TOP_K = 5;

async function evaluateRag(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('RagEvaluation');

  try {
    const report = await application
      .get(RagEvaluationService)
      .evaluate(RAG_EVALUATION_CASES, TOP_K);

    for (const result of report.results) {
      logger.log({
        event: 'rag.evaluation.case.completed',
        name: result.name,
        query: result.query,
        passed: result.passed,
        expectedSource: result.expectedSource,
        expectNoResults: result.expectNoResults,
        retrievedSources: result.retrievedSources,
      });
    }

    logger.log({
      event: 'rag.evaluation.completed',
      total: report.total,
      passed: report.passed,
      failed: report.failed,
      retrievalHitRate: report.retrievalHitRate,
      noResultAccuracy: report.noResultAccuracy,
    });

    if (report.failed > 0) {
      process.exitCode = 1;
    }
  } finally {
    await application.close();
  }
}

evaluateRag().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown RAG evaluation error';
  console.error(`RAG evaluation failed: ${message}`);
  process.exitCode = 1;
});
