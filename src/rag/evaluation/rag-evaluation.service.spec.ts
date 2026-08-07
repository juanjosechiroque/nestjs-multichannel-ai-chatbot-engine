import { RagEvaluationService } from './rag-evaluation.service';
import type { RagEvaluationCase } from './rag-evaluation.types';

describe('RagEvaluationService', () => {
  it('measures expected source hits and unrelated-query rejections', async () => {
    const search = jest
      .fn()
      .mockResolvedValueOnce([
        {
          sourceId: 'database-faq-id',
          sourceKey: 'ubicacion',
          sourceType: 'faq',
          content: 'Dirección: Av. José Larco 880.',
          similarity: 0.89,
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          sourceId: 'database-product-id',
          sourceKey: 'espresso-nube',
          sourceType: 'product',
          content: 'Producto: Espresso Nube.',
          similarity: 0.52,
        },
      ]);
    const service = new RagEvaluationService({ search });
    const cases: RagEvaluationCase[] = [
      {
        name: 'location',
        query: '¿Dónde están?',
        expectedSource: { sourceType: 'faq', sourceKey: 'ubicacion' },
      },
      {
        name: 'unrelated question without results',
        query: '¿Cuál es la capital de Francia?',
        expectNoResults: true,
      },
      {
        name: 'unrelated question with a false positive',
        query: 'Escribe código TypeScript',
        expectNoResults: true,
      },
    ];

    const report = await service.evaluate(cases, 5);

    expect(search).toHaveBeenCalledTimes(3);
    expect(report).toMatchObject({
      total: 3,
      passed: 2,
      failed: 1,
      positiveCases: 1,
      positiveHits: 1,
      retrievalHitRate: 100,
      negativeCases: 2,
      negativePasses: 1,
      noResultAccuracy: 50,
    });
    expect(report.results[0]?.retrievedSources[0]).toEqual({
      sourceId: 'database-faq-id',
      sourceKey: 'ubicacion',
      sourceType: 'faq',
      similarity: 0.89,
    });
  });
});
