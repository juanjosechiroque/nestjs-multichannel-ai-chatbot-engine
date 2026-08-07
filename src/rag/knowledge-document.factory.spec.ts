import type { Faq, Product, Promotion } from '../generated/prisma/client';
import { ProductCategory } from '../generated/prisma/enums';
import { KnowledgeDocumentFactory } from './knowledge-document.factory';

describe('KnowledgeDocumentFactory', () => {
  it('creates searchable documents without exposing database internals', () => {
    const products = [
      {
        id: 'product-id',
        slug: 'espresso-nube',
        name: 'Espresso Nube',
        description: 'Espresso doble con notas de cacao.',
        price: { toString: () => '8.00' },
        currency: 'PEN',
        category: ProductCategory.HOT_DRINK,
      },
    ] as unknown as Product[];
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
    ] as Faq[];
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
});
