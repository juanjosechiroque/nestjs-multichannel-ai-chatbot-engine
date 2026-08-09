import { Inject, Injectable } from '@nestjs/common';
import { RagService } from '../rag.service';
import type {
  RagEvaluationCase,
  RagEvaluationCaseResult,
  RagEvaluationReport,
} from './rag-evaluation.types';

@Injectable()
export class RagEvaluationService {
  constructor(
    @Inject(RagService)
    private readonly rag: Pick<RagService, 'search'>,
  ) {}

  async evaluate(
    evaluationCases: readonly RagEvaluationCase[],
    topK: number,
  ): Promise<RagEvaluationReport> {
    if (evaluationCases.length === 0) {
      throw new RangeError('At least one RAG evaluation case is required');
    }

    const results: RagEvaluationCaseResult[] = [];

    for (const evaluationCase of evaluationCases) {
      const retrieved = await this.rag.search(evaluationCase.query, topK);
      const expectedSource = evaluationCase.expectedSource ?? null;
      const expectNoResults = evaluationCase.expectNoResults === true;
      const passed = expectNoResults
        ? retrieved.length === 0
        : retrieved.some(
            (source) =>
              source.sourceType === expectedSource?.sourceType &&
              source.sourceKey === expectedSource.sourceKey,
          );

      results.push({
        name: evaluationCase.name,
        query: evaluationCase.query,
        expectedSource,
        expectNoResults,
        retrievedSources: retrieved.map((source) => ({
          sourceId: source.sourceId,
          sourceKey: source.sourceKey,
          sourceType: source.sourceType,
          similarity: Number(source.similarity.toFixed(4)),
        })),
        passed,
      });
    }

    const positiveResults = results.filter((result) => !result.expectNoResults);
    const negativeResults = results.filter((result) => result.expectNoResults);
    const passed = results.filter((result) => result.passed).length;
    const positiveHits = positiveResults.filter((result) => result.passed).length;
    const negativePasses = negativeResults.filter((result) => result.passed).length;

    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      positiveCases: positiveResults.length,
      positiveHits,
      retrievalHitRate: this.percentage(positiveHits, positiveResults.length),
      negativeCases: negativeResults.length,
      negativePasses,
      noResultAccuracy: this.percentage(negativePasses, negativeResults.length),
      results,
    };
  }

  private percentage(value: number, total: number): number {
    return total === 0 ? 100 : Number(((value / total) * 100).toFixed(2));
  }
}
