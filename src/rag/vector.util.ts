import { EMBEDDING_DIMENSIONS } from './rag.types';

export function toVectorLiteral(embedding: number[]): string {
  if (
    embedding.length !== EMBEDDING_DIMENSIONS ||
    embedding.some((value) => !Number.isFinite(value))
  ) {
    throw new Error(`Expected an embedding with ${EMBEDDING_DIMENSIONS} finite values`);
  }

  return `[${embedding.join(',')}]`;
}
