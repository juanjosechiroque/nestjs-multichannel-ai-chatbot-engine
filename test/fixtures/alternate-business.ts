import { CatalogAttributeType } from '../../src/generated/prisma/enums';
import type { BusinessProfile, BusinessSeed } from '../../business/contract';

/**
 * A non-gastronomic business proving that the engine does not require food
 * categories or food-specific attributes.
 */
export const alternateBusinessProfile: BusinessProfile = {
  name: 'Panadería Luna',
  timeZone: 'America/Mexico_City',
  menuTitle: 'Carta de Panadería Luna',
};

export const alternateBusinessSeed = {
  categories: [
    { slug: 'books', label: 'Books', active: true, searchTerms: ['books', 'novels', 'reading'] },
    { slug: 'flowers', label: 'Flowers', active: true, searchTerms: ['flowers', 'bouquets'] },
    { slug: 'gift-boxes', label: 'Gift boxes', active: true, searchTerms: ['gifts', 'gift boxes'] },
  ],
  attributes: [
    {
      key: 'format',
      label: 'Format',
      type: CatalogAttributeType.STRING,
      allowedValues: ['HARDCOVER', 'PAPERBACK'],
      filterable: true,
      active: true,
    },
    {
      key: 'occasion',
      label: 'Occasion',
      type: CatalogAttributeType.STRING,
      allowedValues: ['BIRTHDAY', 'THANK_YOU'],
      filterable: true,
      active: true,
    },
  ],
  products: [
    {
      slug: 'the-cloud-atlas',
      name: 'The Cloud Atlas',
      description: 'A hardcover novel for readers who enjoy layered stories.',
      price: '38.00',
      currency: 'MXN',
      category: 'books',
      active: true,
      metadata: { format: 'HARDCOVER' },
    },
    {
      slug: 'seasonal-bouquet',
      name: 'Seasonal bouquet',
      description: 'A fresh selection of seasonal flowers.',
      price: '42.00',
      currency: 'MXN',
      category: 'flowers',
      active: true,
      metadata: { occasion: 'THANK_YOU' },
    },
    {
      slug: 'birthday-gift-box',
      name: 'Birthday gift box',
      description: 'A ready-to-give box with a novel and a small bouquet.',
      price: '22.00',
      currency: 'MXN',
      category: 'gift-boxes',
      active: true,
      metadata: { occasion: 'BIRTHDAY' },
    },
  ],
  promotions: [
    {
      slug: 'birthday-box',
      name: 'Birthday box',
      description:
        'A birthday gift box with a seasonal bouquet at a special price, Monday to Friday from 5:00 p.m. to 7:00 p.m.',
      startsAt: new Date('2026-01-01T06:00:00.000Z'),
      endsAt: null,
      active: true,
      metadata: {
        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        startTime: '17:00',
        endTime: '19:00',
        promotionalPrice: '52.00',
        regularPrice: '60.00',
        productSlugs: ['birthday-gift-box'],
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
