import { Inject, Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import { CatalogService } from '../../catalog/catalog.service';
import type {
  CatalogAttributeFilter,
  CatalogAttributeFilterValue,
} from '../../catalog/catalog.types';
import { CatalogAttributeType } from '../../generated/prisma/enums';
import type { ChatTool, ToolInvocationContext } from './chat-tool';

const CATALOG_RESULT_LIMIT = 20;
const CATALOG_SEARCH_TOOL_NAME = 'search_catalog';
const MAX_ATTRIBUTE_FILTERS = 10;

export interface CatalogSearchAttributeFilter {
  key: string;
  operator: 'MATCHES' | 'EXCLUDES';
  value: CatalogAttributeFilterValue;
}

export interface CatalogSearchArguments {
  productName: string | null;
  category: string | null;
  maxPrice: number | null;
  maxPriceExclusive: boolean;
  attributeFilters: CatalogSearchAttributeFilter[];
}

@Injectable()
export class CatalogSearchTool implements ChatTool<CatalogSearchArguments> {
  readonly name = CATALOG_SEARCH_TOOL_NAME;

  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'getCatalogConfiguration' | 'searchProducts'>,
  ) {}

  buildDefinition(): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: CATALOG_SEARCH_TOOL_NAME,
      description: [
        "Search the current business's active product catalog in its database.",
        'Use it for product names, descriptions, configured category slugs, exact prices, ordering availability, and configured attribute filters.',
        'Use only configured category slugs and filterable attribute keys. Do not use it for FAQs, policies, location, hours, services, or promotions.',
        'The availableForOrdering field confirms whether the business currently accepts that product in orders, but it does not represent an exact stock quantity.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          productName: { type: ['string', 'null'], minLength: 1, maxLength: 100 },
          category: {
            type: ['string', 'null'],
            description:
              'Configured product category slug, or null when all categories are acceptable.',
            minLength: 1,
            maxLength: 80,
          },
          maxPrice: { type: ['number', 'null'], minimum: 0, maximum: 10_000 },
          maxPriceExclusive: { type: 'boolean' },
          attributeFilters: {
            type: 'array',
            description:
              'Configured filterable attributes that every result must match. Use an empty array when no attribute was requested. String-array attributes match products containing the supplied string.',
            maxItems: MAX_ATTRIBUTE_FILTERS,
            items: {
              type: 'object',
              properties: {
                key: { type: 'string', minLength: 1, maxLength: 80 },
                operator: { type: 'string', enum: ['MATCHES', 'EXCLUDES'] },
                value: { type: ['string', 'number', 'boolean'] },
              },
              required: ['key', 'operator', 'value'],
              additionalProperties: false,
            },
          },
        },
        required: ['productName', 'category', 'maxPrice', 'maxPriceExclusive', 'attributeFilters'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): CatalogSearchArguments {
    const parsed: unknown = JSON.parse(argumentsJson);
    const keys = ['productName', 'category', 'maxPrice', 'maxPriceExclusive', 'attributeFilters'];
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, keys)) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }
    const { productName, category, maxPrice, maxPriceExclusive, attributeFilters } = parsed;
    if (
      !(productName === null || isBoundedString(productName, 100)) ||
      !(category === null || isBoundedString(category, 80)) ||
      !(
        maxPrice === null ||
        (typeof maxPrice === 'number' &&
          Number.isFinite(maxPrice) &&
          maxPrice >= 0 &&
          maxPrice <= 10_000)
      ) ||
      typeof maxPriceExclusive !== 'boolean' ||
      !Array.isArray(attributeFilters) ||
      attributeFilters.length > MAX_ATTRIBUTE_FILTERS ||
      !attributeFilters.every(isValidAttributeFilter) ||
      new Set(attributeFilters.map((filter) => filter.key)).size !== attributeFilters.length
    ) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }
    return {
      productName: productName === null ? null : productName.trim(),
      category: category === null ? null : category.trim(),
      maxPrice,
      maxPriceExclusive,
      attributeFilters: attributeFilters.map((filter) => ({
        key: filter.key.trim(),
        operator: filter.operator,
        value: filter.value,
      })),
    };
  }

  async execute(args: CatalogSearchArguments, context: ToolInvocationContext): Promise<string> {
    const configuration = await this.catalog.getCatalogConfiguration();
    const issues = this.validateConfiguredFilters(args, configuration);
    if (issues.length > 0) {
      return JSON.stringify({ catalogStatus: 'invalid_filter', products: [], issues });
    }
    const attributeFilters: CatalogAttributeFilter[] = args.attributeFilters.map((filter) => {
      const definition = configuration.attributes.find(
        (attribute) => attribute.key === filter.key,
      )!;
      return {
        ...filter,
        ...(definition.type === CatalogAttributeType.STRING_ARRAY ? { matchesArray: true } : {}),
      };
    });
    const filters = {
      ...(args.productName ? { productName: args.productName } : {}),
      ...(args.category ? { category: args.category } : {}),
      ...(args.maxPrice !== null
        ? { maxPrice: args.maxPrice, maxPriceExclusive: args.maxPriceExclusive }
        : {}),
      ...(attributeFilters.length > 0 ? { attributeFilters } : {}),
      limit: CATALOG_RESULT_LIMIT,
    };
    let products = await this.catalog.searchProducts(filters, context.requestContext);
    const fallbackProductName = this.getFallbackProductName(args.productName);
    if (products.length === 0 && fallbackProductName) {
      products = await this.catalog.searchProducts(
        { ...filters, productName: fallbackProductName },
        context.requestContext,
      );
    }
    return JSON.stringify({
      catalogStatus: products.length === 0 ? 'no_results' : 'results_found',
      categories: configuration.categories.map((category) => ({
        slug: category.slug,
        label: category.label,
      })),
      filterableAttributes: configuration.attributes
        .filter((attribute) => attribute.filterable)
        .map((attribute) => ({
          key: attribute.key,
          label: attribute.label,
          type: attribute.type,
          allowedValues: attribute.allowedValues,
        })),
      products: products.map((product) => {
        const attributes = this.getConfiguredAttributes(product.metadata, configuration.attributes);
        return {
          sourceId: product.id,
          sourceKey: product.slug,
          type: 'product' as const,
          name: product.name,
          description: product.description,
          price: product.price.toString(),
          currency: product.currency,
          category: { slug: product.category.slug, label: product.category.label },
          availableForOrdering: product.availableForOrdering,
          attributes,
          ...attributes,
        };
      }),
    });
  }

  private validateConfiguredFilters(
    args: CatalogSearchArguments,
    configuration: Awaited<ReturnType<CatalogService['getCatalogConfiguration']>>,
  ): Array<{ field: string; reason: string }> {
    const issues: Array<{ field: string; reason: string }> = [];
    if (
      args.category &&
      !configuration.categories.some((category) => category.slug === args.category)
    ) {
      issues.push({ field: 'category', reason: 'unknown_category' });
    }
    for (const filter of args.attributeFilters) {
      const definition = configuration.attributes.find((attribute) => attribute.key === filter.key);
      if (!definition || !definition.filterable) {
        issues.push({
          field: `attributeFilters.${filter.key}`,
          reason: 'unknown_or_unfilterable_attribute',
        });
      } else if (!this.valueMatchesDefinition(filter.value, definition)) {
        issues.push({ field: `attributeFilters.${filter.key}`, reason: 'invalid_attribute_value' });
      }
    }
    return issues;
  }

  private valueMatchesDefinition(
    value: CatalogAttributeFilterValue,
    definition: Awaited<
      ReturnType<CatalogService['getCatalogConfiguration']>
    >['attributes'][number],
  ): boolean {
    if (definition.type === CatalogAttributeType.BOOLEAN && typeof value !== 'boolean')
      return false;
    if (definition.type === CatalogAttributeType.NUMBER && typeof value !== 'number') return false;
    if (
      (definition.type === CatalogAttributeType.STRING ||
        definition.type === CatalogAttributeType.STRING_ARRAY) &&
      typeof value !== 'string'
    )
      return false;
    return (
      definition.allowedValues.length === 0 ||
      (typeof value === 'string' && definition.allowedValues.includes(value))
    );
  }

  private getConfiguredAttributes(
    metadata: unknown,
    definitions: Awaited<ReturnType<CatalogService['getCatalogConfiguration']>>['attributes'],
  ): Record<string, unknown> {
    if (!isRecord(metadata)) return {};
    const activeKeys = new Set(definitions.map((definition) => definition.key));
    return Object.fromEntries(Object.entries(metadata).filter(([key]) => activeKeys.has(key)));
  }

  private getFallbackProductName(productName: string | null): string | undefined {
    if (!productName) return undefined;
    const terms = productName
      .split(/[^\p{L}\p{N}]+/u)
      .filter((term) => term.length >= 4)
      .sort((left, right) => right.length - left.length);
    return terms.length > 1 ? terms[0] : undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => key in value) && Object.keys(value).every((key) => keys.includes(key));
}

function isBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isValidAttributeFilter(value: unknown): value is CatalogSearchAttributeFilter {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['key', 'operator', 'value']) &&
    isBoundedString(value.key, 80) &&
    (value.operator === 'MATCHES' || value.operator === 'EXCLUDES') &&
    (typeof value.value === 'string' ||
      typeof value.value === 'number' ||
      typeof value.value === 'boolean') &&
    (typeof value.value !== 'number' || Number.isFinite(value.value))
  );
}
