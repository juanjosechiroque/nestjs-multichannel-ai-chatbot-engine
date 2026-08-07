import type { RagEvaluationCase } from './rag-evaluation.types';

export const RAG_EVALUATION_CASES: readonly RagEvaluationCase[] = [
  {
    name: 'business hours',
    query: '¿A qué hora cierran los domingos?',
    expectedSource: { sourceType: 'faq', sourceKey: 'horario-atencion' },
  },
  {
    name: 'location',
    query: '¿Cómo llego a su local en Miraflores?',
    expectedSource: { sourceType: 'faq', sourceKey: 'ubicacion' },
  },
  {
    name: 'payment methods',
    query: '¿Puedo pagar con Yape?',
    expectedSource: { sourceType: 'faq', sourceKey: 'metodos-pago' },
  },
  {
    name: 'delivery coverage',
    query: '¿Hacen delivery a todo Miraflores?',
    expectedSource: { sourceType: 'faq', sourceKey: 'delivery' },
  },
  {
    name: 'pickup preparation time',
    query: '¿Cuánto demora un pedido para recoger?',
    expectedSource: { sourceType: 'faq', sourceKey: 'recojo-local' },
  },
  {
    name: 'plant-based milk',
    query: '¿Tienen leche de avena?',
    expectedSource: {
      sourceType: 'faq',
      sourceKey: 'opciones-vegetarianas-leches-vegetales',
    },
  },
  {
    name: 'gluten information',
    query: '¿Qué productos no contienen gluten?',
    expectedSource: { sourceType: 'faq', sourceKey: 'alergenos' },
  },
  {
    name: 'pet policy',
    query: '¿Puedo ir con mi perro?',
    expectedSource: { sourceType: 'faq', sourceKey: 'wifi-mascotas' },
  },
  {
    name: 'espresso price',
    query: '¿Cuánto cuesta el Espresso Nube?',
    expectedSource: { sourceType: 'product', sourceKey: 'espresso-nube' },
  },
  {
    name: 'cold brew preparation',
    query: '¿Cuántas horas extraen el cold brew?',
    expectedSource: { sourceType: 'product', sourceKey: 'cold-brew-citrico' },
  },
  {
    name: 'toston ingredients',
    query: '¿Qué ingredientes lleva el tostón palteado?',
    expectedSource: { sourceType: 'product', sourceKey: 'toston-palteado' },
  },
  {
    name: 'hot drinks catalog',
    query: '¿Qué bebidas calientes tienen?',
    expectedSource: { sourceType: 'product_category', sourceKey: 'HOT_DRINK' },
  },
  {
    name: 'cold drinks catalog',
    query: 'Muéstrame todas las bebidas frías',
    expectedSource: { sourceType: 'product_category', sourceKey: 'COLD_DRINK' },
  },
  {
    name: 'food catalog',
    query: '¿Qué opciones de comida venden?',
    expectedSource: { sourceType: 'product_category', sourceKey: 'FOOD' },
  },
  {
    name: 'frappe promotion',
    query: '¿Cuándo tienen dos por uno en frappés?',
    expectedSource: { sourceType: 'promotion', sourceKey: 'frappe-dos-por-uno' },
  },
  {
    name: 'breakfast promotion',
    query: '¿Qué incluye la promoción Desayuno Nube?',
    expectedSource: { sourceType: 'promotion', sourceKey: 'desayuno-nube' },
  },
  {
    name: 'friday promotion',
    query: '¿Hay descuentos en bebidas frías los viernes?',
    expectedSource: { sourceType: 'promotion', sourceKey: 'viernes-frio' },
  },
  {
    name: 'unrelated recipe',
    query: 'Dame una receta para preparar flan',
    expectNoResults: true,
  },
  {
    name: 'unrelated programming',
    query: 'Escribe una función de TypeScript para ordenar números',
    expectNoResults: true,
  },
  {
    name: 'unrelated general knowledge',
    query: '¿Cuál es la capital de Francia?',
    expectNoResults: true,
  },
];
