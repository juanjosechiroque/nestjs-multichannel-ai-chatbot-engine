export const PRODUCT_ALLERGENS = ['GLUTEN', 'MILK', 'EGG', 'TREE_NUTS', 'SESAME'] as const;
export const PRODUCT_DIETARY_TAGS = ['VEGETARIAN', 'VEGAN'] as const;

export type ProductAllergen = (typeof PRODUCT_ALLERGENS)[number];
export type ProductDietaryTag = (typeof PRODUCT_DIETARY_TAGS)[number];
