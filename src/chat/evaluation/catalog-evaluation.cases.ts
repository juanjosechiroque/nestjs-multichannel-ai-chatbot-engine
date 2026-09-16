import type { CatalogEvaluationCase } from './catalog-evaluation.types';

export const CATALOG_EVALUATION_CASES: readonly CatalogEvaluationCase[] = [
  {
    name: 'food category with maximum price',
    category: 'category',
    message: 'Muéstrame las opciones de comida que cuestan hasta S/ 9.',
    expectedFilters: { category: 'food', maxPrice: 9, maxPriceExclusive: false },
    expectedSourceKeys: ['croissant-mantequilla', 'galleta-vegana-avena-cacao'],
  },
  {
    name: 'hot drinks with maximum price',
    category: 'price',
    message: '¿Qué bebidas calientes cuestan máximo S/ 12?',
    expectedFilters: { category: 'hot-drinks', maxPrice: 12, maxPriceExclusive: false },
    expectedSourceKeys: ['americano', 'cafe-filtrado-descafeinado', 'cappuccino', 'espresso-nube'],
  },
  {
    name: 'vegan food preference with maximum price',
    category: 'preference',
    message: 'Quiero una comida vegana por menos de S/ 10. ¿Qué tienen?',
    expectedFilters: {
      category: 'food',
      maxPrice: 10,
      maxPriceExclusive: true,
      attributeFilters: [{ key: 'dietaryTags', operator: 'MATCHES', value: 'VEGAN' }],
    },
    expectedSourceKeys: ['galleta-vegana-avena-cacao'],
    forbiddenSourceKeys: ['croissant-mantequilla'],
  },
  {
    name: 'cold caffeine-free preference',
    category: 'preference',
    message: 'Quiero una bebida fría sin café y sin cafeína por S/ 10 o menos.',
    expectedFilters: {
      category: 'cold-drinks',
      maxPrice: 10,
      maxPriceExclusive: false,
      attributeFilters: [
        { key: 'containsCoffee', operator: 'MATCHES', value: false },
        { key: 'caffeineFree', operator: 'MATCHES', value: true },
      ],
    },
    expectedSourceKeys: ['chicha-morada-especiada'],
  },
  {
    name: 'hot coffee-free preference',
    category: 'preference',
    message: 'Quiero una bebida caliente sin café.',
    expectedFilters: {
      category: 'hot-drinks',
      attributeFilters: [{ key: 'containsCoffee', operator: 'MATCHES', value: false }],
    },
    expectedSourceKeys: ['chocolate-caliente-cacao-peruano'],
    forbiddenSourceKeys: ['cafe-filtrado-descafeinado'],
  },
  {
    name: 'vegetarian food excluding milk allergen',
    category: 'preference',
    message: 'Quiero una comida vegetariana de máximo S/ 11 que no contenga leche.',
    expectedFilters: {
      category: 'food',
      maxPrice: 11,
      maxPriceExclusive: false,
      attributeFilters: [
        { key: 'dietaryTags', operator: 'MATCHES', value: 'VEGETARIAN' },
        { key: 'allergens', operator: 'EXCLUDES', value: 'MILK' },
      ],
    },
    expectedSourceKeys: ['galleta-vegana-avena-cacao'],
    forbiddenSourceKeys: ['brownie-cacao', 'croissant-mantequilla'],
  },
  {
    name: 'decaffeinated coffee preference',
    category: 'preference',
    message: '¿Tienen algún café descafeinado?',
    expectedFilters: {
      attributeFilters: [{ key: 'decaffeinated', operator: 'MATCHES', value: true }],
    },
    expectedSourceKeys: ['cafe-filtrado-descafeinado'],
    forbiddenSourceKeys: ['americano', 'espresso-nube'],
  },
];
