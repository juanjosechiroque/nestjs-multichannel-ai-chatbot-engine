import { randomUUID } from 'node:crypto';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { ProductCategory } from '../../src/generated/prisma/enums';
import { chatMessage, setupHttpE2E } from '../support/e2e-app';

interface ConversationResponse {
  sessionId: string;
}

interface CatalogItemResponse {
  slug: string;
  active: boolean;
  availableForOrdering?: boolean;
}

describe('Web catalog and promotions HTTP', () => {
  const harness = setupHttpE2E();

  it('returns only active products ordered by name', async () => {
    await harness.prisma.product.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-activo',
          name: 'Zeta Latte',
          description: 'Producto activo que debe aparecer segundo.',
          price: '12.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-activo',
          name: 'Alpha Espresso',
          description: 'Producto activo que debe aparecer primero.',
          price: '8.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
          availableForOrdering: false,
        },
        {
          id: randomUUID(),
          slug: 'producto-inactivo',
          name: 'Producto oculto',
          description: 'Este producto no debe exponerse.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: false,
        },
      ],
    });

    const response = await request(harness.server).get('/api/products').expect(200);
    const products = response.body as CatalogItemResponse[];

    expect(products.map((product) => product.slug)).toEqual(['alpha-activo', 'zeta-activo']);
    expect(products.every((product) => product.active)).toBe(true);
    expect(products.map((product) => product.availableForOrdering)).toEqual([false, true]);
  });

  it('returns only active promotions ordered by name', async () => {
    await harness.prisma.promotion.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-promocion',
          name: 'Zeta promoción',
          description: 'Promoción activa que debe aparecer segunda.',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-promocion',
          name: 'Alpha promoción',
          description: 'Promoción activa que debe aparecer primera.',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'promocion-inactiva',
          name: 'Promoción oculta',
          description: 'Esta promoción no debe exponerse.',
          active: false,
        },
      ],
    });

    const response = await request(harness.server).get('/api/promotions').expect(200);
    const promotions = response.body as CatalogItemResponse[];

    expect(promotions.map((promotion) => promotion.slug)).toEqual([
      'alpha-promocion',
      'zeta-promocion',
    ]);
    expect(promotions.every((promotion) => promotion.active)).toBe(true);
  });

  it('returns only active FAQs ordered by question', async () => {
    await harness.prisma.faq.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-faq',
          question: '¿Zonas de delivery?',
          answer: 'Atendemos todo Miraflores.',
          category: 'DELIVERY',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-faq',
          question: '¿Aceptan tarjetas?',
          answer: 'Sí, aceptamos tarjetas.',
          category: 'PAYMENTS',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'faq-inactiva',
          question: '¿Pregunta oculta?',
          answer: 'Esta respuesta no debe exponerse.',
          category: 'INACTIVE',
          active: false,
        },
      ],
    });

    const response = await request(harness.server).get('/api/faqs').expect(200);
    const faqs = response.body as CatalogItemResponse[];

    expect(faqs.map((faq) => faq.slug)).toEqual(['alpha-faq', 'zeta-faq']);
    expect(faqs.every((faq) => faq.active)).toBe(true);
  });

  it('resolves current promotions through the structured PostgreSQL tool', async () => {
    const promotionId = randomUUID();
    await harness.prisma.promotion.create({
      data: {
        id: promotionId,
        slug: 'promocion-siempre-vigente',
        name: 'Promoción siempre vigente',
        description: 'Promoción de prueba disponible todos los días y durante todo el día.',
        startsAt: new Date('2020-01-01T00:00:00.000Z'),
        endsAt: null,
        active: true,
        metadata: {},
      },
    });
    harness.generate.mockImplementationOnce(async (input) => {
      const promotionOutput = JSON.parse(
        await harness.toolBag(input).searchPromotions({ scope: 'CURRENT', promotionName: null }),
      ) as {
        currentPromotions: Array<{ sourceId: string; sourceKey: string; currentlyValid: boolean }>;
      };

      expect(promotionOutput.currentPromotions).toEqual([
        expect.objectContaining({
          sourceId: promotionId,
          sourceKey: 'promocion-siempre-vigente',
          currentlyValid: true,
        }),
      ]);
      return {
        answer: 'Ahora está vigente la promoción siempre vigente.',
        usedSources: [
          {
            sourceId: promotionId,
            sourceKey: 'promocion-siempre-vigente',
            sourceType: 'promotion',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_promotions'],
      };
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué promociones están vigentes ahora?'))
      .expect(201, { reply: 'Ahora está vigente la promoción siempre vigente.' });
  });

  it('queries the active product catalog without running embeddings', async () => {
    const productId = randomUUID();
    await harness.prisma.product.createMany({
      data: [
        {
          id: productId,
          slug: 'cappuccino-nube',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'cappuccino-inactivo',
          name: 'Cappuccino Inactivo',
          description: 'No debe devolverse.',
          price: '10.00',
          category: ProductCategory.HOT_DRINK,
          active: false,
        },
      ],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    harness.generate.mockImplementationOnce(async (input) => {
      toolOutput = await harness.toolBag(input).searchCatalog({
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: [],
        excludedAllergens: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
      });
      return {
        answer: 'El Cappuccino Nube cuesta S/ 13.00.',
        usedSources: [
          {
            sourceId: productId,
            sourceKey: 'cappuccino-nube',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Cuánto cuesta el cappuccino?'))
      .expect(201, { reply: 'El Cappuccino Nube cuesta S/ 13.00.' });

    expect(JSON.parse(toolOutput ?? '')).toEqual({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: productId,
          sourceKey: 'cappuccino-nube',
          type: 'product',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13',
          currency: 'PEN',
          category: 'HOT_DRINK',
          availableForOrdering: true,
          allergens: [],
          dietaryTags: [],
          containsCoffee: null,
          decaffeinated: null,
          caffeineFree: null,
        },
      ],
    });
    expect(harness.embed).not.toHaveBeenCalled();
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('keeps less-than price searches exclusive in PostgreSQL', async () => {
    const underLimitId = randomUUID();
    await harness.prisma.product.createMany({
      data: [
        {
          id: underLimitId,
          slug: 'producto-catorce',
          name: 'Producto de catorce soles',
          description: 'Debe aparecer.',
          price: '14.00',
          category: ProductCategory.FOOD,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'producto-quince',
          name: 'Producto de quince soles',
          description: 'No debe aparecer en una búsqueda menor que quince.',
          price: '15.00',
          category: ProductCategory.FOOD,
          active: true,
        },
      ],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    harness.generate.mockImplementationOnce(async (input) => {
      toolOutput = await harness.toolBag(input).searchCatalog({
        productName: null,
        category: ProductCategory.FOOD,
        maxPrice: 15,
        maxPriceExclusive: true,
        dietaryTags: [],
        excludedAllergens: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
      });
      return {
        answer: 'Tenemos una opción por menos de S/ 15.',
        usedSources: [
          {
            sourceId: underLimitId,
            sourceKey: 'producto-catorce',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué tienen por menos de S/ 15?'))
      .expect(201, { reply: 'Tenemos una opción por menos de S/ 15.' });

    const parsedOutput = JSON.parse(toolOutput ?? '') as {
      products: Array<{ sourceKey: string }>;
    };
    expect(parsedOutput.products.map((product) => product.sourceKey)).toEqual(['producto-catorce']);
  });

  it('applies dietary, allergen, and coffee preferences in PostgreSQL', async () => {
    const veganCookieId = randomUUID();
    await harness.prisma.product.createMany({
      data: [
        {
          id: veganCookieId,
          slug: 'galleta-vegana',
          name: 'Galleta vegana',
          description: 'Galleta de avena y cacao.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN'],
            dietaryTags: ['VEGAN', 'VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: false,
          },
        },
        {
          id: randomUUID(),
          slug: 'croissant-vegetariano',
          name: 'Croissant vegetariano',
          description: 'Croissant con mantequilla.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN', 'MILK'],
            dietaryTags: ['VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: true,
          },
        },
        {
          id: randomUUID(),
          slug: 'brownie-con-leche',
          name: 'Brownie con leche',
          description: 'Brownie de cacao y leche.',
          price: '8.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN', 'MILK'],
            dietaryTags: ['VEGAN', 'VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: false,
          },
        },
      ],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    harness.generate.mockImplementationOnce(async (input) => {
      toolOutput = await harness.toolBag(input).searchCatalog({
        productName: null,
        category: ProductCategory.FOOD,
        maxPrice: 10,
        maxPriceExclusive: false,
        dietaryTags: ['VEGAN'],
        excludedAllergens: ['MILK'],
        containsCoffee: false,
        decaffeinated: null,
        caffeineFree: null,
      });
      return {
        answer: 'La Galleta vegana cuesta S/ 9.00.',
        usedSources: [
          {
            sourceId: veganCookieId,
            sourceKey: 'galleta-vegana',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero comida vegana sin leche por máximo S/ 10.'))
      .expect(201, { reply: 'La Galleta vegana cuesta S/ 9.00.' });

    expect(JSON.parse(toolOutput ?? '')).toEqual({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: veganCookieId,
          sourceKey: 'galleta-vegana',
          type: 'product',
          name: 'Galleta vegana',
          description: 'Galleta de avena y cacao.',
          price: '9',
          currency: 'PEN',
          category: 'FOOD',
          availableForOrdering: true,
          allergens: ['GLUTEN'],
          dietaryTags: ['VEGAN', 'VEGETARIAN'],
          containsCoffee: false,
          decaffeinated: false,
          caffeineFree: false,
        },
      ],
    });
    expect(harness.embed).not.toHaveBeenCalled();
  });
});
