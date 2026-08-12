import type { ProductCategory } from '../generated/prisma/enums';
import type { ProductAllergen, ProductDietaryTag } from './catalog-preferences';

export interface ProductSearchFilters {
  productName?: string;
  category?: ProductCategory;
  maxPrice?: number;
  maxPriceExclusive?: boolean;
  dietaryTags?: ProductDietaryTag[];
  excludedAllergens?: ProductAllergen[];
  containsCoffee?: boolean;
  decaffeinated?: boolean;
  caffeineFree?: boolean;
  limit: number;
}
