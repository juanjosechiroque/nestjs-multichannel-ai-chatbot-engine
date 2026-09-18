import type { Category, Faq, Product } from '../generated/prisma/client';
import { KnowledgeDocumentFactory } from './knowledge-document.factory';

function createProduct(
  category: Pick<Category, 'id' | 'slug' | 'label' | 'searchTerms'>,
  overrides: Partial<Product> = {},
): Product & { category: Category } {
  return {
    id: 'product-id',
    slug: 'test-product',
    name: 'Test Product',
    description: 'Test product description.',
    price: { toString: () => '10.00' },
    currency: 'PEN',
    categoryId: category.id,
    active: true,
    availableForOrdering: true,
    metadata: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
    category: category as Category,
  } as Product & { category: Category };
}

const books = { id: 'category-books', slug: 'books', label: 'Books', searchTerms: ['novels'] };
const flowers = {
  id: 'category-flowers',
  slug: 'flowers',
  label: 'Flowers',
  searchTerms: ['bouquets'],
};

describe('KnowledgeDocumentFactory', () => {
  it('creates product and category documents from configured category data', () => {
    const documents = new KnowledgeDocumentFactory().createCatalogDocuments(
      [createProduct(books, { name: 'Night Library' })],
      [],
    );

    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      sourceType: 'product',
      metadata: { slug: 'test-product', category: 'books' },
    });
    expect(documents[0]?.content).toContain('Categoría: Books');
    expect(documents[1]).toMatchObject({
      sourceType: 'product_category',
      sourceId: 'books',
      metadata: { category: 'books' },
    });
    expect(documents[1]?.content).toContain('Consultas relacionadas: Books; novels.');
  });

  it('groups products by their configured categories', () => {
    const documents = new KnowledgeDocumentFactory().createCatalogDocuments(
      [
        createProduct(books, { id: 'one', name: 'Novel' }),
        createProduct(flowers, { id: 'two', name: 'Rose' }),
      ],
      [],
    );
    expect(documents.filter((document) => document.sourceType === 'product_category')).toHaveLength(
      2,
    );
    expect(documents.map((document) => document.content).join(' ')).toContain('Categoría: Flowers');
  });

  it('keeps FAQ aliases alongside configurable catalog documents', () => {
    const faqs = [
      {
        id: 'faq-id',
        slug: 'hours',
        question: 'When?',
        answer: 'Every day.',
        category: 'HOURS',
        metadata: { searchPhrases: ['opening hours'] },
      },
    ] as unknown as Faq[];
    const documents = new KnowledgeDocumentFactory().createCatalogDocuments([], faqs);
    expect(documents).toHaveLength(2);
    expect(documents[1]?.content).toContain('opening hours');
  });
});
