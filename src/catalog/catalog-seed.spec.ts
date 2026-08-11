import { cafeNubeProducts } from '../../prisma/seed-data/cafe-nube';
import { ProductCategory } from '../generated/prisma/enums';

describe('Café Nube product seed', () => {
  const expectedNewSlugs = [
    'iced-latte',
    'te-helado-maracuya',
    'panini-caprese',
    'brownie-cacao',
    'chocolate-caliente-cacao-peruano',
    'cafe-filtrado-descafeinado',
    'espresso-tonic',
    'chicha-morada-especiada',
    'galleta-vegana-avena-cacao',
    'sandwich-pollo-pesto',
  ];

  it('contains 20 uniquely identified products including the 10 new examples', () => {
    const slugs = cafeNubeProducts.map((product) => product.slug);

    expect(cafeNubeProducts).toHaveLength(20);
    expect(new Set(slugs)).toHaveProperty('size', 20);
    expect(slugs).toEqual(expect.arrayContaining(expectedNewSlugs));
  });

  it('keeps a useful distribution across all catalog categories', () => {
    const categoryCounts = Object.fromEntries(
      Object.values(ProductCategory).map((category) => [
        category,
        cafeNubeProducts.filter((product) => product.category === category).length,
      ]),
    );

    expect(categoryCounts).toEqual({ HOT_DRINK: 7, COLD_DRINK: 6, FOOD: 7 });
  });

  it('uses normalized preferences without introducing sizes or variants', () => {
    const allowedAllergens = new Set(['GLUTEN', 'MILK', 'EGG', 'TREE_NUTS', 'SESAME']);
    const allowedDietaryTags = new Set(['VEGETARIAN', 'VEGAN']);

    for (const product of cafeNubeProducts) {
      expect(product.metadata.allergens.every((value) => allowedAllergens.has(value))).toBe(true);
      expect(product.metadata.dietaryTags.every((value) => allowedDietaryTags.has(value))).toBe(
        true,
      );
      expect(product.metadata.containsCoffee).toEqual(expect.any(Boolean));
      expect(product.metadata.decaffeinated).toEqual(expect.any(Boolean));
      expect(product.metadata.caffeineFree).toEqual(expect.any(Boolean));
      expect(product.metadata).not.toHaveProperty('sizes');
      expect(product.metadata).not.toHaveProperty('variants');
    }
  });
});
