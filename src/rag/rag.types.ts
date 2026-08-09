export const EMBEDDING_DIMENSIONS = 1_536;

export type KnowledgeSourceType = 'product' | 'product_category' | 'promotion' | 'faq';

export type KnowledgeMetadata = Record<string, string | number | boolean | null>;

export interface KnowledgeDocument {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  chunkIndex: number;
  content: string;
  metadata: KnowledgeMetadata;
}

export interface RagSearchResult {
  sourceId: string;
  sourceType: string;
  content: string;
  similarity: number;
}

export interface IngestionResult {
  total: number;
  embedded: number;
  unchanged: number;
  deleted: number;
}
