import { KnowledgeDocumentFactory } from '../src/rag/knowledge-document.factory';
import type { Category, Faq, Product } from '../src/generated/prisma/client';
import {
  alternateBusinessProfile,
  alternateBusinessSeed,
} from '../test/fixtures/alternate-business';
import type {
  BusinessProfile,
  BusinessSeed,
  CatalogAttributeSeed,
  CategorySeed,
  FaqSeed,
  ProductSeed,
  PromotionSeed,
} from './contract';
import { businessProfile, loadBusinessProfile, parseBusinessProfile } from './profile';
import { validateBusinessCatalog } from './catalog';
import { businessSeed } from './seed';
import { seedBusiness, type BusinessSeedWriter } from './seed-runner';

class FakeSeedStore implements BusinessSeedWriter {
  readonly categories = new Map<string, CategorySeed>();
  readonly attributes = new Map<string, CatalogAttributeSeed>();
  readonly products = new Map<string, ProductSeed>();
  readonly promotions = new Map<string, PromotionSeed>();
  readonly faqs = new Map<string, FaqSeed>();
  upsertCategoryBySlug(record: CategorySeed) {
    this.categories.set(record.slug, record);
    return Promise.resolve();
  }
  upsertCatalogAttributeByKey(record: CatalogAttributeSeed) {
    this.attributes.set(record.key, record);
    return Promise.resolve();
  }
  upsertProductBySlug(record: ProductSeed) {
    this.products.set(record.slug, record);
    return Promise.resolve();
  }
  upsertPromotionBySlug(record: PromotionSeed) {
    this.promotions.set(record.slug, record);
    return Promise.resolve();
  }
  upsertFaqBySlug(record: FaqSeed) {
    this.faqs.set(record.slug, record);
    return Promise.resolve();
  }
  deleteFaqsBySlug(slugs: readonly string[]) {
    for (const slug of slugs) this.faqs.delete(slug);
    return Promise.resolve();
  }
}

function rows(seed: BusinessSeed): Array<Product & { category: Category }> {
  return seed.products.map((product) => {
    const category = seed.categories.find((item) => item.slug === product.category)!;
    return {
      ...product,
      id: product.slug,
      categoryId: category.slug,
      category: { ...category, id: category.slug, createdAt: new Date(), updatedAt: new Date() },
    } as unknown as Product & { category: Category };
  });
}

describe('business configuration', () => {
  it('loads a validated profile', () => {
    expect(businessProfile.name.trim()).not.toBe('');
    expect(parseBusinessProfile({ name: 'Test', timeZone: 'America/Lima' })).toEqual({
      name: 'Test',
      timeZone: 'America/Lima',
    });
    expect(() => loadBusinessProfile('business/does-not-exist.json')).toThrow(/Unable to read/);
  });

  it('seeds configured categories and validates product attributes', async () => {
    const store = new FakeSeedStore();
    const summary = await seedBusiness(store, businessSeed);
    expect(summary).toMatchObject({
      categories: businessSeed.categories.length,
      attributes: businessSeed.attributes.length,
      products: businessSeed.products.length,
    });
    expect([...store.categories.keys()]).toEqual(
      businessSeed.categories.map((category) => category.slug),
    );
  });

  it('rejects attribute values that are absent from the configured schema', () => {
    expect(() =>
      validateBusinessCatalog(alternateBusinessSeed.categories, alternateBusinessSeed.attributes, [
        { ...alternateBusinessSeed.products[0]!, metadata: { unsupported: true } },
      ]),
    ).toThrow(/Invalid value for catalog attribute unsupported/);
  });

  it('indexes category labels and synonyms from business data', () => {
    const docs = new KnowledgeDocumentFactory().createCatalogDocuments(
      rows(businessSeed),
      businessSeed.faqs.map((faq) => ({ ...faq, id: faq.slug })) as unknown as Faq[],
    );
    expect(docs.some((doc) => doc.content.includes('cafés calientes'))).toBe(true);
  });

  it('accepts a non-gastronomic catalog without food-specific attributes', async () => {
    const seed: BusinessSeed = alternateBusinessSeed;
    const store = new FakeSeedStore();
    await seedBusiness(store, seed);
    expect(seed.categories.map((category) => category.slug)).toEqual([
      'books',
      'flowers',
      'gift-boxes',
    ]);
    expect(seed.attributes.map((attribute) => attribute.key)).toEqual(['format', 'occasion']);
    expect(new KnowledgeDocumentFactory().createCatalogDocuments(rows(seed), [])).toHaveLength(6);
    const profile: BusinessProfile = alternateBusinessProfile;
    expect(parseBusinessProfile(profile)).toEqual(profile);
  });
});
