import { EMBEDDING_DIMENSIONS } from './rag.types';
import { toVectorLiteral } from './vector.util';

describe('toVectorLiteral', () => {
  it('serializes an embedding with the configured dimensions', () => {
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.25);

    expect(toVectorLiteral(embedding)).toBe(`[${embedding.join(',')}]`);
  });

  it.each([EMBEDDING_DIMENSIONS - 1, EMBEDDING_DIMENSIONS + 1])(
    'rejects an embedding with %i dimensions',
    (dimensions) => {
      const embedding = Array<number>(dimensions).fill(0.25);

      expect(() => toVectorLiteral(embedding)).toThrow(
        `Expected an embedding with ${EMBEDDING_DIMENSIONS} finite values`,
      );
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a non-finite embedding value: %s',
    (invalidValue) => {
      const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.25);
      embedding[0] = invalidValue;

      expect(() => toVectorLiteral(embedding)).toThrow(
        `Expected an embedding with ${EMBEDDING_DIMENSIONS} finite values`,
      );
    },
  );
});
