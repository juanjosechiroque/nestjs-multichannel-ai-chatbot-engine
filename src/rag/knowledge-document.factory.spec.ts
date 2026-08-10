import type { Faq, Product, Promotion } from '../generated/prisma/client';
import { ProductCategory } from '../generated/prisma/enums';
import { KnowledgeDocumentFactory } from './knowledge-document.factory';

interface ProductOverrides {
  id?: string;
  slug?: string;
  name?: string;
  description?: string;
  price?: string;
}

function createProduct(
  category: ProductCategory,
  {
    id = 'product-id',
    slug = 'test-product',
    name = 'Test Product',
    description = 'Test product description.',
    price = '10.00',
  }: ProductOverrides = {},
): Product {
  return {
    id,
    slug,
    name,
    description,
    price: { toString: () => price },
    currency: 'PEN',
    category,
  } as unknown as Product;
}

const CATEGORY_SCENARIOS: ReadonlyArray<[ProductCategory, string, string]> = [
  [ProductCategory.HOT_DRINK, 'bebida caliente', 'qué bebidas calientes tienen'],
  [ProductCategory.COLD_DRINK, 'bebida fría', 'qué bebidas frías tienen'],
  [ProductCategory.FOOD, 'comida', 'qué opciones de comida tienen'],
];

describe('KnowledgeDocumentFactory', () => {
  it('creates searchable documents without exposing database internals', () => {
    const products = [
      createProduct(ProductCategory.HOT_DRINK, {
        slug: 'espresso-nube',
        name: 'Espresso Nube',
        description: 'Espresso doble con notas de cacao.',
        price: '8.00',
      }),
    ];
    const promotions = [
      {
        id: 'promotion-id',
        slug: 'tarde-de-frappes',
        name: 'Tarde de frappés',
        description: '2x1 de 3:00 p. m. a 5:00 p. m.',
      },
    ] as Promotion[];
    const faqs = [
      {
        id: 'faq-id',
        slug: 'horario',
        question: '¿Cuál es el horario?',
        answer: 'Atendemos todos los días.',
        category: 'HOURS',
      },
    ] as unknown as Faq[];
    const factory = new KnowledgeDocumentFactory();

    const documents = factory.createCatalogDocuments(products, promotions, faqs);

    expect(documents).toHaveLength(4);
    expect(documents[0]).toMatchObject({
      sourceType: 'product',
      sourceId: 'product-id',
      chunkIndex: 0,
      metadata: { slug: 'espresso-nube', category: ProductCategory.HOT_DRINK },
    });
    expect(documents[0]?.content).toContain('Categoría: bebida caliente');
    expect(documents[0]?.content).toContain('Espresso doble con notas de cacao.');
    expect(documents[0]?.content).toContain('Precio: PEN 8.00');
    expect(documents[0]?.content).not.toContain('product-id');
    expect(documents[1]).toMatchObject({
      sourceType: 'product_category',
      sourceId: ProductCategory.HOT_DRINK,
    });
    expect(documents[1]?.content).toContain('Productos y precios disponibles');
    expect(documents[1]?.content).toContain('qué bebidas calientes tienen');
    expect(documents[1]?.content).toContain('Espresso Nube');
    expect(documents[1]?.content).not.toContain('Espresso doble con notas de cacao.');
    expect(documents[2]?.content).toContain('Tipo: promoción');
    expect(documents[3]?.content).toContain('Pregunta: ¿Cuál es el horario?');
  });

  it.each(CATEGORY_SCENARIOS)(
    'creates a searchable category document for %s',
    (category, categoryLabel, searchPhrase) => {
      const product = createProduct(category);
      const factory = new KnowledgeDocumentFactory();

      const documents = factory.createCatalogDocuments([product], [], []);
      const categoryDocument = documents.find(
        (document) => document.sourceType === 'product_category',
      );

      expect(categoryDocument).toMatchObject({
        sourceType: 'product_category',
        sourceId: category,
        chunkIndex: 0,
        metadata: { category },
      });
      expect(categoryDocument?.content).toContain(`Categoría: ${categoryLabel}`);
      expect(categoryDocument?.content).toContain(searchPhrase);
      expect(categoryDocument?.content).toContain('Test Product — PEN 10.00');
    },
  );

  it('groups multiple products by category and omits categories without products', () => {
    const products = [
      createProduct(ProductCategory.HOT_DRINK, {
        id: 'espresso-id',
        slug: 'espresso',
        name: 'Espresso',
        description: 'Concentrated coffee.',
        price: '8.00',
      }),
      createProduct(ProductCategory.HOT_DRINK, {
        id: 'cappuccino-id',
        slug: 'cappuccino',
        name: 'Cappuccino',
        description: 'Coffee with milk foam.',
        price: '12.00',
      }),
      createProduct(ProductCategory.COLD_DRINK, {
        id: 'cold-brew-id',
        slug: 'cold-brew',
        name: 'Cold Brew',
        description: 'Cold extracted coffee.',
        price: '13.00',
      }),
    ];
    const factory = new KnowledgeDocumentFactory();

    const documents = factory.createCatalogDocuments(products, [], []);
    const categoryDocuments = documents.filter(
      (document) => document.sourceType === 'product_category',
    );
    const hotDrinks = categoryDocuments.find(
      (document) => document.sourceId === ProductCategory.HOT_DRINK,
    );

    expect(categoryDocuments.map((document) => document.sourceId)).toEqual([
      ProductCategory.HOT_DRINK,
      ProductCategory.COLD_DRINK,
    ]);
    expect(hotDrinks?.content).toContain('Espresso — PEN 8.00');
    expect(hotDrinks?.content).toContain('Cappuccino — PEN 12.00');
    expect(hotDrinks?.content).not.toContain('Concentrated coffee.');
  });

  it('adds business-owned search phrases to a FAQ document', () => {
    const faqs = [
      {
        id: 'faq-location-id',
        slug: 'ubicacion',
        question: '¿Dónde están ubicados?',
        answer: 'Estamos en Miraflores.',
        category: 'LOCATION',
        metadata: {
          searchPhrases: ['cómo llego al local', 'cuál es la dirección'],
        },
      },
    ] as unknown as Faq[];
    const factory = new KnowledgeDocumentFactory();

    const documents = factory.createCatalogDocuments([], [], faqs);

    expect(documents).toHaveLength(2);
    expect(documents[0]).toMatchObject({
      sourceId: 'faq-location-id',
      chunkIndex: 0,
    });
    expect(documents[0]?.content).not.toContain('Consultas relacionadas');
    expect(documents[1]).toMatchObject({
      sourceId: 'faq-location-id',
      chunkIndex: 1,
      metadata: {
        slug: 'ubicacion',
        category: 'LOCATION',
        purpose: 'search_aliases',
      },
    });
    expect(documents[1]?.content).toContain(
      'Consultas relacionadas: cómo llego al local; cuál es la dirección.',
    );
    expect(documents[1]?.content).toContain('Respuesta: Estamos en Miraflores.');
  });
});
