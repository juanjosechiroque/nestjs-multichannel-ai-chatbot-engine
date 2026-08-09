import type { KnowledgeSourceType } from '../rag.types';

export interface ExpectedRagSource {
  sourceType: KnowledgeSourceType;
  sourceKey: string;
}

interface BaseRagEvaluationCase {
  name: string;
  query: string;
}

export type RagEvaluationCase = BaseRagEvaluationCase &
  (
    | {
        expectedSource: ExpectedRagSource;
        expectNoResults?: never;
      }
    | {
        expectedSource?: never;
        expectNoResults: true;
      }
  );

export interface RetrievedRagSource extends ExpectedRagSource {
  sourceId: string;
  similarity: number;
}

export interface RagEvaluationCaseResult {
  name: string;
  query: string;
  expectedSource: ExpectedRagSource | null;
  expectNoResults: boolean;
  retrievedSources: RetrievedRagSource[];
  passed: boolean;
}

export interface RagEvaluationReport {
  total: number;
  passed: number;
  failed: number;
  positiveCases: number;
  positiveHits: number;
  retrievalHitRate: number;
  negativeCases: number;
  negativePasses: number;
  noResultAccuracy: number;
  results: RagEvaluationCaseResult[];
}
