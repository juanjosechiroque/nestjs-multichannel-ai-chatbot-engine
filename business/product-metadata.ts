import type { Prisma } from '../src/generated/prisma/client';
import type { ProductAllergen, ProductDietaryTag } from '../src/catalog/catalog-preferences';

/**
 * Structured product metadata for the gastronomic vertical.
 *
 * These fields (declared allergens, dietary tags, caffeine/coffee flags) are a
 * deliberate constraint of the food-and-drink domain. They are not generalized to
 * other industries — see `ARCHITECTURE.md` › "Business configuration".
 */
export interface ProductMetadata extends Prisma.InputJsonObject {
  allergens: ProductAllergen[];
  dietaryTags: ProductDietaryTag[];
  containsCoffee: boolean;
  decaffeinated: boolean;
  caffeineFree: boolean;
}

/** Identity helper that keeps the seed data readable and type-checked. */
export function productMetadata(metadata: ProductMetadata): ProductMetadata {
  return metadata;
}
