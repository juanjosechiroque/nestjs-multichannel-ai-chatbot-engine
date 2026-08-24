import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { OrderConversationEvaluationReport } from './order-conversation-evaluation.types';
import { writeOrderEvaluationReport } from './order-evaluation-report';

const evaluation: OrderConversationEvaluationReport = {
  total: 1,
  passed: 1,
  failed: 0,
  passRate: 100,
  totalTurns: 1,
  totalDurationMs: 500,
  tokenUsage: {
    inputTokens: 1_000,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 100,
    reasoningTokens: 20,
    totalTokens: 1_100,
  },
  results: [],
};

describe('writeOrderEvaluationReport', () => {
  let outputDirectory: string;

  beforeEach(async () => {
    outputDirectory = await mkdtemp(join(tmpdir(), 'order-evaluation-report-'));
  });

  afterEach(async () => {
    await rm(outputDirectory, { recursive: true, force: true });
  });

  it('writes a versioned JSON artifact with summary, usage, and estimated cost', async () => {
    const generatedAt = new Date('2026-08-12T15:30:45.123Z');
    const written = await writeOrderEvaluationReport(evaluation, 'gpt-5.6-luna', {
      outputDirectory,
      generatedAt,
    });

    expect(written.path).toBe(join(outputDirectory, '2026-08-12T15-30-45-123Z.json'));
    const file = await readFile(written.path, 'utf8');
    expect(file).toBe(`${JSON.stringify(written.report, null, 2)}\n`);
    expect(written.report.schemaVersion).toBe(1);
    expect(written.report.generatedAt).toBe('2026-08-12T15:30:45.123Z');
    expect(written.report.model).toBe('gpt-5.6-luna');
    expect(written.report.summary.tokenUsage).toEqual(evaluation.tokenUsage);
    expect(written.report.summary.estimatedCost.status).toBe('estimated');
    expect(written.report.summary.estimatedCost.amount).toBe(0.00032);
    expect(written.report.results).toEqual([]);
  });
});
