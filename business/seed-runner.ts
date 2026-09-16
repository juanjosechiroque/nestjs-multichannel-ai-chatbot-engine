import { validateBusinessCatalog } from './catalog';
import type {
  BusinessSeed,
  CatalogAttributeSeed,
  CategorySeed,
  FaqSeed,
  ProductSeed,
  PromotionSeed,
} from './contract';

/**
 * Storage-agnostic sink for the business seed.
 *
 * The runner never deletes or rewrites records outside the given seed: products,
 * promotions and FAQs are upserted by their stable `slug`, and only FAQ slugs
 * explicitly listed as obsolete are removed. Re-running with the same seed is
 * therefore idempotent.
 */
export interface BusinessSeedWriter {
  upsertCategoryBySlug(record: CategorySeed): Promise<void>;
  upsertCatalogAttributeByKey(record: CatalogAttributeSeed): Promise<void>;
  upsertProductBySlug(record: ProductSeed): Promise<void>;
  upsertPromotionBySlug(record: PromotionSeed): Promise<void>;
  upsertFaqBySlug(record: FaqSeed): Promise<void>;
  deleteFaqsBySlug(slugs: readonly string[]): Promise<void>;
}

export interface BusinessSeedSummary {
  categories: number;
  attributes: number;
  products: number;
  promotions: number;
  faqs: number;
  obsoleteFaqsRemoved: number;
}

export async function seedBusiness(
  writer: BusinessSeedWriter,
  seed: BusinessSeed,
): Promise<BusinessSeedSummary> {
  validateBusinessCatalog(seed.categories, seed.attributes, seed.products);
  for (const category of seed.categories) {
    await writer.upsertCategoryBySlug(category);
  }
  for (const attribute of seed.attributes) {
    await writer.upsertCatalogAttributeByKey(attribute);
  }
  for (const product of seed.products) {
    await writer.upsertProductBySlug(product);
  }
  for (const promotion of seed.promotions) {
    await writer.upsertPromotionBySlug(promotion);
  }
  for (const faq of seed.faqs) {
    await writer.upsertFaqBySlug(faq);
  }
  await writer.deleteFaqsBySlug(seed.obsoleteFaqSlugs);

  return {
    categories: seed.categories.length,
    attributes: seed.attributes.length,
    products: seed.products.length,
    promotions: seed.promotions.length,
    faqs: seed.faqs.length,
    obsoleteFaqsRemoved: seed.obsoleteFaqSlugs.length,
  };
}
