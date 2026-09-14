import type { CatalogService } from '../../catalog/catalog.service';
import { ProductCategory } from '../../generated/prisma/enums';
import { CatalogSearchTool, type CatalogSearchArguments } from './catalog-search.tool';
import type { ToolInvocationContext } from './chat-tool';

describe('CatalogSearchTool', () => {
  const noPreferenceFilters: Pick<
    CatalogSearchArguments,
    | 'maxPriceExclusive'
    | 'dietaryTags'
    | 'excludedAllergens'
    | 'containsCoffee'
    | 'decaffeinated'
    | 'caffeineFree'
  > = {
    maxPriceExclusive: false,
    dietaryTags: [],
    excludedAllergens: [],
    containsCoffee: null,
    decaffeinated: null,
    caffeineFree: null,
  };
  const context = {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    channel: 'web' as const,
  };
  const invocation: ToolInvocationContext = {
    requestContext: context,
    conversationId: 'conversation-1',
    orderContext: { activeOrder: null, confirmationReplayAvailable: false },
    message: '¿Cuánto cuesta el cappuccino?',
  };
  const validArguments: CatalogSearchArguments = {
    productName: null,
    category: null,
    maxPrice: null,
    ...{
      maxPriceExclusive: false,
      dietaryTags: [],
      excludedAllergens: [],
      containsCoffee: null,
      decaffeinated: null,
      caffeineFree: null,
    },
  };

  it('returns active catalog products as structured tool output', async () => {
    const searchProducts = jest.fn().mockResolvedValue([
      {
        id: 'product-1',
        slug: 'cappuccino-nube',
        name: 'Cappuccino Nube',
        description: 'Espresso con leche vaporizada.',
        price: { toString: () => '13.00' },
        currency: 'PEN',
        category: ProductCategory.HOT_DRINK,
        availableForOrdering: true,
        metadata: {
          allergens: ['MILK'],
          dietaryTags: ['VEGETARIAN'],
          containsCoffee: true,
          decaffeinated: false,
          caffeineFree: false,
        },
      },
    ]);
    const catalog: Pick<CatalogService, 'searchProducts'> = { searchProducts };
    const tool = new CatalogSearchTool(catalog);

    const output = await tool.execute(
      {
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: ['VEGETARIAN'],
        excludedAllergens: ['TREE_NUTS'],
        containsCoffee: true,
        decaffeinated: false,
        caffeineFree: false,
      },
      invocation,
    );

    expect(searchProducts).toHaveBeenCalledWith(
      {
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: ['VEGETARIAN'],
        excludedAllergens: ['TREE_NUTS'],
        containsCoffee: true,
        decaffeinated: false,
        caffeineFree: false,
        limit: 20,
      },
      context,
    );
    expect(JSON.parse(output)).toEqual({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: 'product-1',
          sourceKey: 'cappuccino-nube',
          type: 'product',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          currency: 'PEN',
          category: 'HOT_DRINK',
          availableForOrdering: true,
          allergens: ['MILK'],
          dietaryTags: ['VEGETARIAN'],
          containsCoffee: true,
          decaffeinated: false,
          caffeineFree: false,
        },
      ],
    });
  });

  it('omits null filters and reports an empty catalog result', async () => {
    const searchProducts = jest.fn().mockResolvedValue([]);
    const tool = new CatalogSearchTool({ searchProducts });

    await expect(
      tool.execute(
        { productName: null, category: null, maxPrice: null, ...noPreferenceFilters },
        invocation,
      ),
    ).resolves.toBe('{"catalogStatus":"no_results","products":[]}');
    expect(searchProducts).toHaveBeenCalledWith({ limit: 20 }, context);
  });

  it('retries a multi-word customer product name with its most specific term', async () => {
    const product = {
      id: 'product-1',
      slug: 'cappuccino',
      name: 'Cappuccino',
      description: 'Espresso con leche vaporizada.',
      price: { toString: () => '12.00' },
      currency: 'PEN',
      category: ProductCategory.HOT_DRINK,
      availableForOrdering: true,
      metadata: {},
    };
    const searchProducts = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([product]);
    const tool = new CatalogSearchTool({ searchProducts });

    const output = await tool.execute(
      { productName: 'Cappuccino Nube', category: null, maxPrice: null, ...noPreferenceFilters },
      invocation,
    );

    expect(searchProducts).toHaveBeenNthCalledWith(
      1,
      { productName: 'Cappuccino Nube', limit: 20 },
      context,
    );
    expect(searchProducts).toHaveBeenNthCalledWith(
      2,
      { productName: 'Cappuccino', limit: 20 },
      context,
    );
    expect(JSON.parse(output)).toEqual(expect.objectContaining({ catalogStatus: 'results_found' }));
  });

  it('does not infer undeclared preferences from malformed metadata', async () => {
    const searchProducts = jest.fn().mockResolvedValue([
      {
        id: 'product-1',
        slug: 'mystery-drink',
        name: 'Mystery drink',
        description: 'Description.',
        price: { toString: () => '10.00' },
        currency: 'PEN',
        category: ProductCategory.COLD_DRINK,
        availableForOrdering: false,
        metadata: {
          allergens: 'MILK',
          dietaryTags: [42],
          containsCoffee: 'false',
        },
      },
    ]);
    const tool = new CatalogSearchTool({ searchProducts });

    const output = JSON.parse(
      await tool.execute(
        { productName: null, category: null, maxPrice: null, ...noPreferenceFilters },
        invocation,
      ),
    ) as { products: unknown[] };

    expect(output.products).toEqual([
      expect.objectContaining({
        availableForOrdering: false,
        allergens: [],
        dietaryTags: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
      }),
    ]);
  });

  describe('buildDefinition', () => {
    it('describes a strict function tool with every filter required', () => {
      const definition = new CatalogSearchTool({ searchProducts: jest.fn() }).buildDefinition();

      expect(definition).toEqual(
        expect.objectContaining({ type: 'function', name: 'search_catalog', strict: true }),
      );
      expect(definition.parameters).toEqual(
        expect.objectContaining({
          additionalProperties: false,
          required: [
            'productName',
            'category',
            'maxPrice',
            'maxPriceExclusive',
            'dietaryTags',
            'excludedAllergens',
            'containsCoffee',
            'decaffeinated',
            'caffeineFree',
          ],
        }),
      );
    });
  });

  describe('parseArguments', () => {
    const tool = new CatalogSearchTool({ searchProducts: jest.fn() });

    it('accepts and trims a fully specified filter set', () => {
      expect(
        tool.parseArguments(
          JSON.stringify({ ...validArguments, productName: '  latte  ', category: 'HOT_DRINK' }),
        ),
      ).toEqual({ ...validArguments, productName: 'latte', category: ProductCategory.HOT_DRINK });
    });

    it.each([
      { name: 'a missing key', payload: { category: null } },
      { name: 'an unknown category', payload: { ...validArguments, category: 'UNKNOWN_CATEGORY' } },
      { name: 'a negative max price', payload: { ...validArguments, maxPrice: -1 } },
      { name: 'an unknown dietary tag', payload: { ...validArguments, dietaryTags: ['KETO'] } },
      {
        name: 'a duplicated allergen',
        payload: { ...validArguments, excludedAllergens: ['MILK', 'MILK'] },
      },
      {
        name: 'a non-boolean coffee preference',
        payload: { ...validArguments, containsCoffee: 'false' },
      },
      { name: 'an extra property', payload: { ...validArguments, total: 1 } },
    ])('throws for $name', ({ payload }) => {
      expect(() => tool.parseArguments(JSON.stringify(payload))).toThrow(
        'OpenAI returned invalid search_catalog arguments',
      );
    });
  });
});
