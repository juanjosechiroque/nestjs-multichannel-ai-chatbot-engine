import type { ProductCategory } from '../generated/prisma/enums';

export interface ProductSearchFilters {
  productName?: string;
  category?: ProductCategory;
  maxPrice?: number;
  limit: number;
}
