import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/catalog.service';
import type { RequestContext } from '../../common/request-context';
import type { ProductCategory } from '../../generated/prisma/enums';

const CATALOG_RESULT_LIMIT = 20;

interface CatalogProductPreferences {
  allergens: string[];
  dietaryTags: string[];
  containsCoffee: boolean | null;
  decaffeinated: boolean | null;
  caffeineFree: boolean | null;
}

export interface CatalogSearchArguments {
  productName: string | null;
  category: ProductCategory | null;
  maxPrice: number | null;
}

export interface CatalogSearchInput extends CatalogSearchArguments {
  context: RequestContext;
}

@Injectable()
export class CatalogSearchTool {
  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchProducts'>,
  ) {}

  async execute({ productName, category, maxPrice, context }: CatalogSearchInput): Promise<string> {
    const filters = {
      ...(productName ? { productName } : {}),
      ...(category ? { category } : {}),
      ...(maxPrice !== null ? { maxPrice } : {}),
      limit: CATALOG_RESULT_LIMIT,
    };
    let products = await this.catalog.searchProducts(filters, context);
    const fallbackProductName = this.getFallbackProductName(productName);

    if (products.length === 0 && fallbackProductName) {
      products = await this.catalog.searchProducts(
        { ...filters, productName: fallbackProductName },
        context,
      );
    }

    return JSON.stringify({
      catalogStatus: products.length === 0 ? 'no_results' : 'results_found',
      products: products.map((product) => ({
        sourceId: product.id,
        sourceKey: product.slug,
        type: 'product' as const,
        name: product.name,
        description: product.description,
        price: product.price.toString(),
        currency: product.currency,
        category: product.category,
        ...this.getProductPreferences(product.metadata),
      })),
    });
  }

  private getProductPreferences(metadata: unknown): CatalogProductPreferences {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return this.emptyProductPreferences();
    }

    const values = metadata as Record<string, unknown>;

    return {
      allergens: this.getStringArray(values.allergens),
      dietaryTags: this.getStringArray(values.dietaryTags),
      containsCoffee: this.getBooleanOrNull(values.containsCoffee),
      decaffeinated: this.getBooleanOrNull(values.decaffeinated),
      caffeineFree: this.getBooleanOrNull(values.caffeineFree),
    };
  }

  private emptyProductPreferences(): CatalogProductPreferences {
    return {
      allergens: [],
      dietaryTags: [],
      containsCoffee: null,
      decaffeinated: null,
      caffeineFree: null,
    };
  }

  private getStringArray(value: unknown): string[] {
    return Array.isArray(value) && value.every((item) => typeof item === 'string') ? value : [];
  }

  private getBooleanOrNull(value: unknown): boolean | null {
    return typeof value === 'boolean' ? value : null;
  }

  private getFallbackProductName(productName: string | null): string | undefined {
    if (!productName) {
      return undefined;
    }

    const terms = productName
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 4)
      .sort((left, right) => right.length - left.length);

    return terms.length > 1 ? terms[0] : undefined;
  }
}
