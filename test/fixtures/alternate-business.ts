import { ProductCategory } from '../../src/generated/prisma/enums';
import type { BusinessProfile, BusinessSeed } from '../../business/contract';
import { productMetadata } from '../../business/product-metadata';

/**
 * A second gastronomic business, used only by tests to prove the engine runs an
 * unrelated business through the same `BusinessProfile` / `BusinessSeed` pipeline
 * with no core change. It is not wired into any deployment.
 */
export const alternateBusinessProfile: BusinessProfile = {
  name: 'Panadería Luna',
  timeZone: 'America/Mexico_City',
  menuTitle: 'Carta de Panadería Luna',
};

export const alternateBusinessSeed = {
  products: [
    {
      slug: 'cafe-de-olla',
      name: 'Café de olla',
      description: 'Café de olla preparado con piloncillo y canela, servido caliente.',
      price: '38.00',
      currency: 'MXN',
      category: ProductCategory.HOT_DRINK,
      active: true,
      metadata: productMetadata({
        allergens: [],
        dietaryTags: ['VEGAN', 'VEGETARIAN'],
        containsCoffee: true,
        decaffeinated: false,
        caffeineFree: false,
      }),
    },
    {
      slug: 'limonada-de-temporada',
      name: 'Limonada de temporada',
      description: 'Limonada natural con fruta de temporada, servida bien fría.',
      price: '42.00',
      currency: 'MXN',
      category: ProductCategory.COLD_DRINK,
      active: true,
      metadata: productMetadata({
        allergens: [],
        dietaryTags: ['VEGAN', 'VEGETARIAN'],
        containsCoffee: false,
        decaffeinated: false,
        caffeineFree: true,
      }),
    },
    {
      slug: 'concha-vainilla',
      name: 'Concha de vainilla',
      description: 'Pan dulce tradicional con costra de vainilla, horneado por la mañana.',
      price: '22.00',
      currency: 'MXN',
      category: ProductCategory.FOOD,
      active: true,
      metadata: productMetadata({
        allergens: ['GLUTEN', 'MILK', 'EGG'],
        dietaryTags: ['VEGETARIAN'],
        containsCoffee: false,
        decaffeinated: false,
        caffeineFree: true,
      }),
    },
  ],
  promotions: [
    {
      slug: 'merienda-luna',
      name: 'Merienda Luna',
      description:
        'Un café de olla y una concha de vainilla por $52, de lunes a viernes entre las 5:00 p. m. y las 7:00 p. m.',
      startsAt: new Date('2026-01-01T06:00:00.000Z'),
      endsAt: null,
      active: true,
      metadata: {
        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        startTime: '17:00',
        endTime: '19:00',
        promotionalPrice: '52.00',
        regularPrice: '60.00',
        productSlugs: ['cafe-de-olla', 'concha-vainilla'],
        stackable: false,
      },
    },
  ],
  faqs: [
    {
      slug: 'horario-atencion',
      category: 'HOURS',
      question: '¿Cuál es el horario de atención?',
      answer: 'Abrimos todos los días de 7:00 a. m. a 9:00 p. m.',
      active: true,
      metadata: { searchPhrases: ['a qué hora abren', 'a qué hora cierran'] },
    },
    {
      slug: 'metodos-pago',
      category: 'PAYMENTS',
      question: '¿Qué métodos de pago aceptan?',
      answer: 'Aceptamos efectivo, tarjetas Visa y Mastercard, y transferencia por CoDi o SPEI.',
      active: true,
      metadata: {},
    },
  ],
  obsoleteFaqSlugs: [],
} satisfies BusinessSeed;
