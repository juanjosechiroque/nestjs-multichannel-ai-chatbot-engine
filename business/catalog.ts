import { CatalogAttributeType } from '../src/generated/prisma/enums';
import type { CatalogAttributeSeed, CategorySeed, ProductSeed } from './contract';

export type CatalogAttributeValue = string | number | boolean | readonly string[];
export type ProductAttributes = Record<string, CatalogAttributeValue>;

/** Identity helper for readable, type-checked business-owned product attributes. */
export function catalogAttributes(attributes: ProductAttributes): ProductAttributes {
  return attributes;
}

export function validateBusinessCatalog(
  categories: readonly CategorySeed[],
  attributes: readonly CatalogAttributeSeed[],
  products: readonly ProductSeed[],
): void {
  const categorySlugs = new Set<string>();
  for (const category of categories) {
    assertSlug(category.slug, 'category');
    if (!category.label.trim() || categorySlugs.has(category.slug)) {
      throw new Error(`Invalid catalog category: ${category.slug}`);
    }
    categorySlugs.add(category.slug);
  }

  const attributesByKey = new Map<string, CatalogAttributeSeed>();
  for (const attribute of attributes) {
    assertAttributeKey(attribute.key);
    if (!attribute.label.trim() || attributesByKey.has(attribute.key)) {
      throw new Error(`Invalid catalog attribute: ${attribute.key}`);
    }
    if (
      attribute.allowedValues.length > 0 &&
      attribute.type !== CatalogAttributeType.STRING &&
      attribute.type !== CatalogAttributeType.STRING_ARRAY
    ) {
      throw new Error(`Only string attributes may declare allowed values: ${attribute.key}`);
    }
    if (new Set(attribute.allowedValues).size !== attribute.allowedValues.length) {
      throw new Error(`Catalog attribute has duplicate allowed values: ${attribute.key}`);
    }
    attributesByKey.set(attribute.key, attribute);
  }

  for (const product of products) {
    if (!categorySlugs.has(product.category)) {
      throw new Error(
        `Product ${product.slug} references an unknown category: ${product.category}`,
      );
    }
    const metadata = product.metadata;
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) continue;
    for (const [key, value] of Object.entries(metadata)) {
      const definition = attributesByKey.get(key);
      if (!definition || !isValidAttributeValue(value, definition)) {
        throw new Error(`Invalid value for catalog attribute ${key} on product ${product.slug}`);
      }
    }
  }
}

function assertSlug(value: string, subject: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid ${subject}: ${value}`);
  }
}

function assertAttributeKey(value: string): void {
  if (!/^[a-z][A-Za-z0-9-]*$/.test(value)) {
    throw new Error(`Invalid attribute key: ${value}`);
  }
}

function isValidAttributeValue(value: unknown, definition: CatalogAttributeSeed): boolean {
  const stringValues = definition.allowedValues;
  if (definition.type === CatalogAttributeType.STRING) {
    return typeof value === 'string' && (stringValues.length === 0 || stringValues.includes(value));
  }
  if (definition.type === CatalogAttributeType.NUMBER)
    return typeof value === 'number' && Number.isFinite(value);
  if (definition.type === CatalogAttributeType.BOOLEAN) return typeof value === 'boolean';
  return (
    Array.isArray(value) &&
    value.every(
      (item) =>
        typeof item === 'string' && (stringValues.length === 0 || stringValues.includes(item)),
    )
  );
}
