export type CatalogAttributeFilterValue = string | number | boolean;

export interface CatalogAttributeFilter {
  key: string;
  value: CatalogAttributeFilterValue;
  operator: 'MATCHES' | 'EXCLUDES';
  matchesArray?: boolean;
}

export interface ProductSearchFilters {
  productName?: string;
  category?: string;
  maxPrice?: number;
  maxPriceExclusive?: boolean;
  attributeFilters?: CatalogAttributeFilter[];
  limit: number;
}
