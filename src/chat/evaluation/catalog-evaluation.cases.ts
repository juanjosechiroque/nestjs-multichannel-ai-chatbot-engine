import type { CatalogEvaluationCase } from './catalog-evaluation.types';

export const CATALOG_EVALUATION_CASES: readonly CatalogEvaluationCase[] = [
  {
    name: 'food category with maximum price',
    category: 'category',
    message: 'Muéstrame las opciones de comida que cuestan hasta S/ 9.',
    expectedFilters: { category: 'FOOD', maxPrice: 9, maxPriceExclusive: false },
    expectedSourceKeys: ['croissant-mantequilla', 'galleta-vegana-avena-cacao'],
  },
  {
    name: 'hot drinks with maximum price',
    category: 'price',
    message: '¿Qué bebidas calientes cuestan máximo S/ 12?',
    expectedFilters: { category: 'HOT_DRINK', maxPrice: 12, maxPriceExclusive: false },
    expectedSourceKeys: ['americano', 'cafe-filtrado-descafeinado', 'cappuccino', 'espresso-nube'],
  },
  {
    name: 'vegan food preference with maximum price',
    category: 'preference',
    message: 'Quiero una comida vegana por menos de S/ 10. ¿Qué tienen?',
    expectedFilters: {
      category: 'FOOD',
      maxPrice: 10,
      maxPriceExclusive: true,
      dietaryTags: ['VEGAN'],
    },
    expectedSourceKeys: ['galleta-vegana-avena-cacao'],
    forbiddenSourceKeys: ['croissant-mantequilla'],
  },
  {
    name: 'cold caffeine-free preference',
    category: 'preference',
    message: 'Quiero una bebida fría sin café y sin cafeína por S/ 10 o menos.',
    expectedFilters: {
      category: 'COLD_DRINK',
      maxPrice: 10,
      maxPriceExclusive: false,
      containsCoffee: false,
      caffeineFree: true,
    },
    expectedSourceKeys: ['chicha-morada-especiada'],
  },
  {
    name: 'hot coffee-free preference',
    category: 'preference',
    message: 'Quiero una bebida caliente sin café.',
    expectedFilters: { category: 'HOT_DRINK', containsCoffee: false },
    expectedSourceKeys: ['chocolate-caliente-cacao-peruano'],
    forbiddenSourceKeys: ['cafe-filtrado-descafeinado'],
  },
  {
    name: 'vegetarian food excluding milk allergen',
    category: 'preference',
    message: 'Quiero una comida vegetariana de máximo S/ 11 que no contenga leche.',
    expectedFilters: {
      category: 'FOOD',
      maxPrice: 11,
      maxPriceExclusive: false,
      dietaryTags: ['VEGETARIAN'],
      excludedAllergens: ['MILK'],
    },
    expectedSourceKeys: ['galleta-vegana-avena-cacao'],
    forbiddenSourceKeys: ['brownie-cacao', 'croissant-mantequilla'],
  },
  {
    name: 'decaffeinated coffee preference',
    category: 'preference',
    message: '¿Tienen algún café descafeinado?',
    expectedFilters: { decaffeinated: true },
    expectedSourceKeys: ['cafe-filtrado-descafeinado'],
    forbiddenSourceKeys: ['americano', 'espresso-nube'],
  },
];
