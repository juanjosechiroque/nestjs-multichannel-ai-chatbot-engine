import type { BusinessSeed, FaqSeed, ProductSeed, PromotionSeed } from './contract';

/**
 * Storage-agnostic sink for the business seed.
 *
 * The runner never deletes or rewrites records outside the given seed: products,
 * promotions and FAQs are upserted by their stable `slug`, and only FAQ slugs
 * explicitly listed as obsolete are removed. Re-running with the same seed is
 * therefore idempotent.
 */
export interface BusinessSeedWriter {
  upsertProductBySlug(record: ProductSeed): Promise<void>;
  upsertPromotionBySlug(record: PromotionSeed): Promise<void>;
  upsertFaqBySlug(record: FaqSeed): Promise<void>;
  deleteFaqsBySlug(slugs: readonly string[]): Promise<void>;
}

export interface BusinessSeedSummary {
  products: number;
  promotions: number;
  faqs: number;
  obsoleteFaqsRemoved: number;
}

export async function seedBusiness(
  writer: BusinessSeedWriter,
  seed: BusinessSeed,
): Promise<BusinessSeedSummary> {
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
    products: seed.products.length,
    promotions: seed.promotions.length,
    faqs: seed.faqs.length,
    obsoleteFaqsRemoved: seed.obsoleteFaqSlugs.length,
  };
}
