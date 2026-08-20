import type { CatalogSearchArguments } from '../tools/catalog-search.tool';

export type CatalogEvaluationCategory = 'category' | 'price' | 'preference';

export interface CatalogEvaluationCase {
  name: string;
  category: CatalogEvaluationCategory;
  message: string;
  expectedFilters: Partial<CatalogSearchArguments>;
  expectedSourceKeys: readonly string[];
  forbiddenSourceKeys?: readonly string[];
}

export interface CatalogEvaluationResult extends CatalogEvaluationCase {
  answer: string;
  usedTools: string[];
  usedSourceKeys: string[];
  appliedFilters: CatalogSearchArguments | null;
  passed: boolean;
  reason: string;
}

export interface CatalogEvaluationReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: CatalogEvaluationResult[];
}
