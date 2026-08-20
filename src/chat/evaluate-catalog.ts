import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { CATALOG_EVALUATION_CASES } from './evaluation/catalog-evaluation.cases';
import { CatalogEvaluationService } from './evaluation/catalog-evaluation.service';

async function evaluateCatalog(): Promise<void> {
  const application = await NestFactory.createApplicationContext(AppModule);
  const logger = new Logger('CatalogEvaluation');

  try {
    const requestedCaseName = process.env.CHAT_CATALOG_EVALUATION_CASE;
    const evaluationCases = requestedCaseName
      ? CATALOG_EVALUATION_CASES.filter(
          (evaluationCase) => evaluationCase.name === requestedCaseName,
        )
      : CATALOG_EVALUATION_CASES;

    if (evaluationCases.length === 0) {
      throw new Error(`Unknown catalog evaluation case: ${requestedCaseName}`);
    }

    const report = await application.get(CatalogEvaluationService).evaluate(evaluationCases);

    for (const result of report.results) {
      logger.log({
        event: 'chat.catalog_evaluation.case.completed',
        name: result.name,
        category: result.category,
        message: result.message,
        answer: result.answer,
        usedTools: result.usedTools,
        appliedFilters: result.appliedFilters,
        usedSourceKeys: result.usedSourceKeys,
        passed: result.passed,
        reason: result.reason,
      });
    }

    logger.log({
      event: 'chat.catalog_evaluation.completed',
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

evaluateCatalog().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown catalog evaluation error';
  console.error(`Catalog evaluation failed: ${message}`);
  process.exitCode = 1;
});
