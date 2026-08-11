import type { CatalogService } from '../../catalog/catalog.service';
import { ProductCategory } from '../../generated/prisma/enums';
import { CatalogSearchTool } from './catalog-search.tool';

describe('CatalogSearchTool', () => {
  const context = {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    channel: 'web' as const,
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

    const output = await tool.execute({
      productName: 'cappuccino',
      category: ProductCategory.HOT_DRINK,
      maxPrice: 15,
      context,
    });

    expect(searchProducts).toHaveBeenCalledWith(
      {
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
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
      tool.execute({ productName: null, category: null, maxPrice: null, context }),
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
      metadata: {},
    };
    const searchProducts = jest.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([product]);
    const tool = new CatalogSearchTool({ searchProducts });

    const output = await tool.execute({
      productName: 'Cappuccino Nube',
      category: null,
      maxPrice: null,
      context,
    });

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
        metadata: {
          allergens: 'MILK',
          dietaryTags: [42],
          containsCoffee: 'false',
        },
      },
    ]);
    const tool = new CatalogSearchTool({ searchProducts });

    const output = JSON.parse(
      await tool.execute({ productName: null, category: null, maxPrice: null, context }),
    ) as { products: unknown[] };

    expect(output.products).toEqual([
      expect.objectContaining({
        allergens: [],
        dietaryTags: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
      }),
    ]);
  });
});
