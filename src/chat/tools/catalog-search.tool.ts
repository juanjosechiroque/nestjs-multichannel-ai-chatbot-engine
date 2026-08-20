import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../../catalog/catalog.service';
import type { RequestContext } from '../../common/request-context';
import type { ProductCategory } from '../../generated/prisma/enums';

const CATALOG_RESULT_LIMIT = 20;

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
      })),
    });
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
