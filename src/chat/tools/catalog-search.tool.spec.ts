import { CatalogAttributeType } from '../../generated/prisma/enums';
import { CatalogSearchTool, type CatalogSearchArguments } from './catalog-search.tool';

const configuration = {
  categories: [
    { id: 'books-id', slug: 'books', label: 'Books', active: true, searchTerms: ['novels'] },
  ],
  attributes: [
    {
      id: 'format-id',
      key: 'format',
      label: 'Format',
      type: CatalogAttributeType.STRING,
      allowedValues: ['HARDCOVER'],
      filterable: true,
      active: true,
    },
  ],
};
const context = {
  requestContext: {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    channel: 'web' as const,
  },
  conversationId: 'conversation-1',
  orderContext: { activeOrder: null, confirmationReplayAvailable: false },
  message: 'books',
};
const validArguments: CatalogSearchArguments = {
  productName: null,
  category: null,
  maxPrice: null,
  maxPriceExclusive: false,
  attributeFilters: [],
};

describe('CatalogSearchTool', () => {
  function catalog(products: unknown[] = []) {
    return {
      getCatalogConfiguration: jest.fn().mockResolvedValue(configuration),
      searchProducts: jest.fn().mockResolvedValue(products),
    };
  }

  it('filters with configured category and attributes without fixed catalog enums', async () => {
    const collaborator = catalog([
      {
        id: 'product-1',
        slug: 'night-library',
        name: 'Night Library',
        description: 'Novel.',
        price: { toString: () => '18.00' },
        currency: 'USD',
        category: configuration.categories[0],
        availableForOrdering: true,
        metadata: { format: 'HARDCOVER' },
      },
    ]);
    const output = JSON.parse(
      await new CatalogSearchTool(collaborator).execute(
        {
          productName: null,
          category: 'books',
          maxPrice: 20,
          maxPriceExclusive: false,
          attributeFilters: [{ key: 'format', operator: 'MATCHES', value: 'HARDCOVER' }],
        },
        context,
      ),
    ) as { products: Array<Record<string, unknown>> };

    expect(collaborator.searchProducts).toHaveBeenCalledWith(
      {
        category: 'books',
        maxPrice: 20,
        maxPriceExclusive: false,
        attributeFilters: [{ key: 'format', operator: 'MATCHES', value: 'HARDCOVER' }],
        limit: 20,
      },
      context.requestContext,
    );
    expect(output.products[0]).toMatchObject({
      category: { slug: 'books', label: 'Books' },
      attributes: { format: 'HARDCOVER' },
    });
  });

  it('returns a controlled result for unknown categories and attributes', async () => {
    const collaborator = catalog();
    const output = JSON.parse(
      await new CatalogSearchTool(collaborator).execute(
        {
          ...validArguments,
          category: 'unknown',
          attributeFilters: [{ key: 'coffee', operator: 'MATCHES', value: true }],
        },
        context,
      ),
    ) as { catalogStatus: string; products: unknown[] };
    expect(output).toMatchObject({ catalogStatus: 'invalid_filter', products: [] });
    expect(collaborator.searchProducts).not.toHaveBeenCalled();
  });

  it('validates generic arguments but defers configured-value validation to execution', () => {
    const tool = new CatalogSearchTool(catalog());
    expect(
      tool.parseArguments(JSON.stringify({ ...validArguments, category: '  books  ' })),
    ).toEqual({
      ...validArguments,
      category: 'books',
    });
    expect(() =>
      tool.parseArguments(
        JSON.stringify({ ...validArguments, attributeFilters: [{ key: 'x', value: true }] }),
      ),
    ).toThrow();
  });

  it('keeps its function schema free of business category and attribute enums', () => {
    const definition = new CatalogSearchTool(catalog()).buildDefinition();
    expect(definition.parameters).toMatchObject({
      required: ['productName', 'category', 'maxPrice', 'maxPriceExclusive', 'attributeFilters'],
      additionalProperties: false,
    });
  });
});
