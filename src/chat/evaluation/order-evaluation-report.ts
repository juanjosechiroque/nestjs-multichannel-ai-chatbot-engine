import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { OrderConversationEvaluationReport } from './order-conversation-evaluation.types';
import { estimateTokenCost, type TokenCostEstimate } from './order-evaluation-cost';

export interface OrderEvaluationJsonReport {
  schemaVersion: 1;
  generatedAt: string;
  model: string;
  summary: Omit<OrderConversationEvaluationReport, 'results'> & {
    estimatedCost: TokenCostEstimate;
  };
  results: OrderConversationEvaluationReport['results'];
}

export interface WrittenOrderEvaluationReport {
  path: string;
  report: OrderEvaluationJsonReport;
}

export async function writeOrderEvaluationReport(
  evaluation: OrderConversationEvaluationReport,
  model: string,
  options: { outputDirectory?: string; generatedAt?: Date } = {},
): Promise<WrittenOrderEvaluationReport> {
  const generatedAt = options.generatedAt ?? new Date();
  const outputDirectory = options.outputDirectory
    ? resolve(options.outputDirectory)
    : resolve(process.cwd(), 'output', 'evaluations', 'orders');
  const { results, ...summary } = evaluation;
  const report: OrderEvaluationJsonReport = {
    schemaVersion: 1,
    generatedAt: generatedAt.toISOString(),
    model,
    summary: {
      ...summary,
      estimatedCost: estimateTokenCost(model, evaluation.tokenUsage),
    },
    results,
  };
  const filename = `${generatedAt.toISOString().replace(/[:.]/g, '-')}.json`;
  const path = resolve(outputDirectory, filename);

  await mkdir(outputDirectory, { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  return { path, report };
}
