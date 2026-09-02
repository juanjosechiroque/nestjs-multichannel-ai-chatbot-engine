import { ConfigService } from '@nestjs/config';
import type { GenerateResponseInput, GenerateResponseResult } from '../openai.service';
import type { CatalogSearchArguments } from '../tools/catalog-search.tool';
import type { ChatTool } from '../tools/chat-tool';
import { CatalogEvaluationService } from './catalog-evaluation.service';
import type { CatalogEvaluationCase } from './catalog-evaluation.types';

const veganFilters: CatalogSearchArguments = {
  productName: null,
  category: 'FOOD',
  maxPrice: null,
  maxPriceExclusive: false,
  dietaryTags: ['VEGAN'],
  excludedAllergens: [],
  containsCoffee: null,
  decaffeinated: null,
  caffeineFree: null,
};

function chatTools(): ChatTool[] {
  const stub = (name: string): ChatTool => ({
    name,
    buildDefinition: () => ({
      type: 'function',
      name,
      description: '',
      parameters: { type: 'object', properties: {}, required: [], additionalProperties: false },
      strict: true,
    }),
    parseArguments: (json: string): unknown => JSON.parse(json),
    execute: () => Promise.resolve('{"catalogStatus":"results_found"}'),
  });

  return [stub('search_catalog'), stub('search_knowledge'), stub('manage_order')];
}

describe('CatalogEvaluationService', () => {
  const evaluationCase: CatalogEvaluationCase = {
    name: 'vegan preference',
    category: 'preference',
    message: 'Quiero comida vegana.',
    expectedFilters: { category: 'FOOD', dietaryTags: ['VEGAN'] },
    expectedSourceKeys: ['vegan-cookie'],
    forbiddenSourceKeys: ['butter-croissant'],
  };
  const config = new ConfigService({ BUSINESS_NAME: 'Café Nube' });

  it('passes when the catalog tool attributes all expected and no forbidden sources', async () => {
    const generate = jest
      .fn<Promise<GenerateResponseResult>, [GenerateResponseInput]>()
      .mockImplementation((input) => {
        const catalogTool = (input.tools ?? []).find((tool) => tool.name === 'search_catalog');
        catalogTool?.parseArguments(JSON.stringify(veganFilters));

        return Promise.resolve({
          answer: 'Tenemos una galleta vegana.',
          usedTools: ['search_catalog'],
          usedSources: [
            { sourceId: 'product-1', sourceKey: 'vegan-cookie', sourceType: 'product' },
          ],
          llmCalls: 2,
        });
      });
    const service = new CatalogEvaluationService({ generate }, chatTools(), config);

    const report = await service.evaluate([evaluationCase]);

    expect(report).toEqual(
      expect.objectContaining({ total: 1, passed: 1, failed: 0, passRate: 100 }),
    );
    expect(report.results[0]).toEqual(
      expect.objectContaining({
        passed: true,
        usedTools: ['search_catalog'],
        usedSourceKeys: ['vegan-cookie'],
      }),
    );
    expect(report.results[0]?.appliedFilters).toEqual(veganFilters);
    const receivedInput = generate.mock.calls[0]?.[0];
    if (!receivedInput) {
      throw new Error('OpenAI generation input was not captured');
    }
    expect(receivedInput.message).toBe(evaluationCase.message);
    expect(receivedInput.history).toEqual([]);
    expect(receivedInput.instructions).toContain('Café Nube');
    expect((receivedInput.tools ?? []).map((tool) => tool.name)).toEqual([
      'search_catalog',
      'search_knowledge',
      'manage_order',
    ]);
  });

  it('reports the wrong tool, missing sources, and forbidden sources', async () => {
    const generate = jest
      .fn<Promise<GenerateResponseResult>, [GenerateResponseInput]>()
      .mockResolvedValue({
        answer: 'Incorrect answer.',
        usedTools: ['search_knowledge'],
        usedSources: [
          { sourceId: 'product-2', sourceKey: 'butter-croissant', sourceType: 'product' },
        ],
        llmCalls: 2,
      });
    const service = new CatalogEvaluationService({ generate }, chatTools(), config);

    const report = await service.evaluate([evaluationCase]);

    expect(report).toEqual(
      expect.objectContaining({ total: 1, passed: 0, failed: 1, passRate: 0 }),
    );
    expect(report.results[0]?.reason).toContain('Expected search_catalog');
    expect(report.results[0]?.reason).toContain(
      'Expected filter category="FOOD" but received undefined',
    );
    expect(report.results[0]?.reason).toContain('Missing expected sources: vegan-cookie');
    expect(report.results[0]?.reason).toContain('Used forbidden sources: butter-croissant');
  });

  it('rejects empty, duplicate, or source-less evaluation cases', async () => {
    const service = new CatalogEvaluationService(
      { generate: jest.fn<Promise<GenerateResponseResult>, [GenerateResponseInput]>() },
      chatTools(),
      config,
    );

    await expect(service.evaluate([])).rejects.toThrow(
      'At least one catalog evaluation case is required',
    );
    await expect(service.evaluate([evaluationCase, evaluationCase])).rejects.toThrow(
      'Catalog evaluation case names must be unique',
    );
    await expect(service.evaluate([{ ...evaluationCase, expectedSourceKeys: [] }])).rejects.toThrow(
      'Every catalog evaluation case requires an expected source',
    );
  });
});
