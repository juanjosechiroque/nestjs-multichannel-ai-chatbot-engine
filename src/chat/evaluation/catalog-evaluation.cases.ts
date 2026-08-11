import type { CatalogEvaluationCase } from './catalog-evaluation.types';

export const CATALOG_EVALUATION_CASES: readonly CatalogEvaluationCase[] = [
  {
    name: 'food category with maximum price',
    category: 'category',
    message: 'Muéstrame las opciones de comida que cuestan hasta S/ 9.',
    expectedSourceKeys: ['croissant-mantequilla', 'galleta-vegana-avena-cacao'],
  },
  {
    name: 'hot drinks with maximum price',
    category: 'price',
    message: '¿Qué bebidas calientes cuestan máximo S/ 12?',
    expectedSourceKeys: ['americano', 'cafe-filtrado-descafeinado', 'cappuccino', 'espresso-nube'],
  },
  {
    name: 'vegan food preference with maximum price',
    category: 'preference',
    message: 'Quiero una comida vegana por menos de S/ 10. ¿Qué tienen?',
    expectedSourceKeys: ['galleta-vegana-avena-cacao'],
    forbiddenSourceKeys: ['croissant-mantequilla'],
  },
  {
    name: 'cold caffeine-free preference',
    category: 'preference',
    message: 'Quiero una bebida fría sin café y sin cafeína por S/ 10 o menos.',
    expectedSourceKeys: ['chicha-morada-especiada'],
  },
  {
    name: 'hot coffee-free preference',
    category: 'preference',
    message: 'Quiero una bebida caliente sin café.',
    expectedSourceKeys: ['chocolate-caliente-cacao-peruano'],
    forbiddenSourceKeys: ['cafe-filtrado-descafeinado'],
  },
];
