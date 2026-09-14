import { Inject, Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { PRODUCT_ALLERGENS, PRODUCT_DIETARY_TAGS } from '../../catalog/catalog-preferences';
import type { ProductAllergen, ProductDietaryTag } from '../../catalog/catalog-preferences';
import { CatalogService } from '../../catalog/catalog.service';
import { ProductCategory } from '../../generated/prisma/enums';
import type { ChatTool, ToolInvocationContext } from './chat-tool';

const CATALOG_RESULT_LIMIT = 20;
const CATALOG_SEARCH_TOOL_NAME = 'search_catalog';

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
  maxPriceExclusive: boolean;
  dietaryTags: ProductDietaryTag[];
  excludedAllergens: ProductAllergen[];
  containsCoffee: boolean | null;
  decaffeinated: boolean | null;
  caffeineFree: boolean | null;
}

@Injectable()
export class CatalogSearchTool implements ChatTool<CatalogSearchArguments> {
  readonly name = CATALOG_SEARCH_TOOL_NAME;

  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchProducts'>,
  ) {}

  buildDefinition(): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: CATALOG_SEARCH_TOOL_NAME,
      description: [
        "Search the current business's active product catalog in its database.",
        'Use it for product names, descriptions, categories, exact prices, ordering availability, complete product lists, price filters, declared allergens, dietary tags, and caffeine or coffee preferences.',
        'Do not use it for FAQs, policies, location, hours, services, or promotions.',
        'The availableForOrdering field confirms whether the business currently accepts that product in orders, but it does not represent an exact stock quantity.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          productName: {
            type: ['string', 'null'],
            description: 'Full or partial product name, or null when no name filter is needed.',
            minLength: 1,
            maxLength: 100,
          },
          category: {
            type: ['string', 'null'],
            description: 'Product category filter, or null when all categories are acceptable.',
            enum: [...Object.values(ProductCategory), null],
          },
          maxPrice: {
            type: ['number', 'null'],
            description:
              'Maximum price in the catalog currency, or null when there is no price limit.',
            minimum: 0,
            maximum: 10_000,
          },
          maxPriceExclusive: {
            type: 'boolean',
            description:
              'True when the customer says less than or below the maximum price; false for up to, at most, maximum, or when maxPrice is null.',
          },
          dietaryTags: {
            type: 'array',
            description:
              'Dietary tags every returned product must contain. Use an empty array when not requested.',
            items: { type: 'string', enum: [...PRODUCT_DIETARY_TAGS] },
            maxItems: PRODUCT_DIETARY_TAGS.length,
          },
          excludedAllergens: {
            type: 'array',
            description:
              'Declared allergens that returned products must not contain. Use an empty array when not requested. This does not guarantee absence of cross-contamination.',
            items: { type: 'string', enum: [...PRODUCT_ALLERGENS] },
            maxItems: PRODUCT_ALLERGENS.length,
          },
          containsCoffee: {
            type: ['boolean', 'null'],
            description:
              'True for products containing coffee, false for coffee-free products, or null when not requested.',
          },
          decaffeinated: {
            type: ['boolean', 'null'],
            description:
              'True for explicitly decaffeinated products, false when decaffeinated products must be excluded, or null when not requested.',
          },
          caffeineFree: {
            type: ['boolean', 'null'],
            description:
              'True for explicitly caffeine-free products, false for products not declared caffeine-free, or null when not requested.',
          },
        },
        required: [
          'productName',
          'category',
          'maxPrice',
          'maxPriceExclusive',
          'dietaryTags',
          'excludedAllergens',
          'containsCoffee',
          'decaffeinated',
          'caffeineFree',
        ],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): CatalogSearchArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('productName' in parsed) ||
      !('category' in parsed) ||
      !('maxPrice' in parsed) ||
      !('maxPriceExclusive' in parsed) ||
      !('dietaryTags' in parsed) ||
      !('excludedAllergens' in parsed) ||
      !('containsCoffee' in parsed) ||
      !('decaffeinated' in parsed) ||
      !('caffeineFree' in parsed) ||
      Object.keys(parsed).some(
        (key) =>
          key !== 'productName' &&
          key !== 'category' &&
          key !== 'maxPrice' &&
          key !== 'maxPriceExclusive' &&
          key !== 'dietaryTags' &&
          key !== 'excludedAllergens' &&
          key !== 'containsCoffee' &&
          key !== 'decaffeinated' &&
          key !== 'caffeineFree',
      )
    ) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }

    const productName = parsed.productName;
    const category = parsed.category;
    const maxPrice = parsed.maxPrice;
    const maxPriceExclusive = parsed.maxPriceExclusive;
    const dietaryTags = parsed.dietaryTags;
    const excludedAllergens = parsed.excludedAllergens;
    const containsCoffee = parsed.containsCoffee;
    const decaffeinated = parsed.decaffeinated;
    const caffeineFree = parsed.caffeineFree;
    const validCategory =
      category === null || Object.values(ProductCategory).some((value) => value === category);
    const validDietaryTags =
      Array.isArray(dietaryTags) &&
      dietaryTags.length <= PRODUCT_DIETARY_TAGS.length &&
      dietaryTags.every(
        (value) =>
          typeof value === 'string' && PRODUCT_DIETARY_TAGS.some((allowed) => allowed === value),
      ) &&
      new Set(dietaryTags).size === dietaryTags.length;
    const validExcludedAllergens =
      Array.isArray(excludedAllergens) &&
      excludedAllergens.length <= PRODUCT_ALLERGENS.length &&
      excludedAllergens.every(
        (value) =>
          typeof value === 'string' && PRODUCT_ALLERGENS.some((allowed) => allowed === value),
      ) &&
      new Set(excludedAllergens).size === excludedAllergens.length;

    if (
      !(
        productName === null ||
        (typeof productName === 'string' &&
          productName.trim().length > 0 &&
          productName.length <= 100)
      ) ||
      typeof maxPriceExclusive !== 'boolean' ||
      !validCategory ||
      !(
        maxPrice === null ||
        (typeof maxPrice === 'number' &&
          Number.isFinite(maxPrice) &&
          maxPrice >= 0 &&
          maxPrice <= 10_000)
      ) ||
      !validDietaryTags ||
      !validExcludedAllergens ||
      !(containsCoffee === null || typeof containsCoffee === 'boolean') ||
      !(decaffeinated === null || typeof decaffeinated === 'boolean') ||
      !(caffeineFree === null || typeof caffeineFree === 'boolean')
    ) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }

    return {
      productName: productName === null ? null : productName.trim(),
      category: category as ProductCategory | null,
      maxPrice,
      maxPriceExclusive,
      dietaryTags: dietaryTags as CatalogSearchArguments['dietaryTags'],
      excludedAllergens: excludedAllergens as CatalogSearchArguments['excludedAllergens'],
      containsCoffee,
      decaffeinated,
      caffeineFree,
    };
  }

  async execute(args: CatalogSearchArguments, context: ToolInvocationContext): Promise<string> {
    const {
      productName,
      category,
      maxPrice,
      maxPriceExclusive,
      dietaryTags,
      excludedAllergens,
      containsCoffee,
      decaffeinated,
      caffeineFree,
    } = args;
    const filters = {
      ...(productName ? { productName } : {}),
      ...(category ? { category } : {}),
      ...(maxPrice !== null ? { maxPrice } : {}),
      ...(maxPrice !== null ? { maxPriceExclusive } : {}),
      ...(dietaryTags.length > 0 ? { dietaryTags } : {}),
      ...(excludedAllergens.length > 0 ? { excludedAllergens } : {}),
      ...(containsCoffee !== null ? { containsCoffee } : {}),
      ...(decaffeinated !== null ? { decaffeinated } : {}),
      ...(caffeineFree !== null ? { caffeineFree } : {}),
      limit: CATALOG_RESULT_LIMIT,
    };
    let products = await this.catalog.searchProducts(filters, context.requestContext);
    const fallbackProductName = this.getFallbackProductName(productName);

    if (products.length === 0 && fallbackProductName) {
      products = await this.catalog.searchProducts(
        { ...filters, productName: fallbackProductName },
        context.requestContext,
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
        availableForOrdering: product.availableForOrdering,
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
