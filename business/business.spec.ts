import { ProductCategory } from '../src/generated/prisma/enums';
import { KnowledgeDocumentFactory } from '../src/rag/knowledge-document.factory';
import type { Faq, Product } from '../src/generated/prisma/client';
import {
  alternateBusinessProfile,
  alternateBusinessSeed,
} from '../test/fixtures/alternate-business';
import type {
  BusinessProfile,
  BusinessSeed,
  FaqSeed,
  ProductSeed,
  PromotionSeed,
} from './contract';
import { businessProfile, loadBusinessProfile, parseBusinessProfile } from './profile';
import { businessSeed } from './seed';
import { seedBusiness, type BusinessSeedWriter } from './seed-runner';

class FakeSeedStore implements BusinessSeedWriter {
  readonly products = new Map<string, ProductSeed>();
  readonly promotions = new Map<string, PromotionSeed>();
  readonly faqs = new Map<string, FaqSeed>();
  readonly upsertKeys: string[] = [];

  upsertProductBySlug(record: ProductSeed): Promise<void> {
    this.upsertKeys.push(`product:${record.slug}`);
    this.products.set(record.slug, record);
    return Promise.resolve();
  }

  upsertPromotionBySlug(record: PromotionSeed): Promise<void> {
    this.upsertKeys.push(`promotion:${record.slug}`);
    this.promotions.set(record.slug, record);
    return Promise.resolve();
  }

  upsertFaqBySlug(record: FaqSeed): Promise<void> {
    this.upsertKeys.push(`faq:${record.slug}`);
    this.faqs.set(record.slug, record);
    return Promise.resolve();
  }

  deleteFaqsBySlug(slugs: readonly string[]): Promise<void> {
    for (const slug of slugs) this.faqs.delete(slug);
    return Promise.resolve();
  }

  snapshot(): Record<string, string[]> {
    return {
      products: [...this.products.keys()].sort(),
      promotions: [...this.promotions.keys()].sort(),
      faqs: [...this.faqs.keys()].sort(),
    };
  }
}

function expectGastronomicCatalog(seed: BusinessSeed): void {
  const slugs = seed.products.map((product) => product.slug);
  expect(new Set(slugs).size).toBe(slugs.length);

  const categories = new Set(seed.products.map((product) => product.category));
  expect(categories).toContain(ProductCategory.HOT_DRINK);
  expect(categories).toContain(ProductCategory.COLD_DRINK);
  expect(categories).toContain(ProductCategory.FOOD);

  expect(seed.faqs.length).toBeGreaterThan(0);
}

function toProductRows(seed: BusinessSeed): Product[] {
  return seed.products.map((product) => ({ ...product, id: product.slug }) as unknown as Product);
}

function toFaqRows(seed: BusinessSeed): Faq[] {
  return seed.faqs.map((faq) => ({ ...faq, id: faq.slug }) as unknown as Faq);
}

describe('business profile', () => {
  it('loads and validates a well-formed identity from business/profile.json', () => {
    expect(businessProfile.name.trim().length).toBeGreaterThan(0);
    expect(businessProfile.timeZone).toMatch(/^[A-Za-z]+\/[A-Za-z_]+$/);
    expect(businessProfile).not.toHaveProperty('catalogDocument');
  });

  it.each([
    ['a non-object payload', 'not an object'],
    ['a blank name', { name: '   ', timeZone: 'America/Lima' }],
    ['an unknown time zone', { name: 'X', timeZone: 'Mars/Olympus' }],
    ['a blank menuTitle', { name: 'X', timeZone: 'America/Lima', menuTitle: '  ' }],
    ['a non-string menuTitle', { name: 'X', timeZone: 'America/Lima', menuTitle: 42 }],
  ])('rejects %s with a clear, sourced error', (_scenario, payload) => {
    expect(() => parseBusinessProfile(payload, 'business/profile.json')).toThrow(
      /Invalid business\/profile\.json/,
    );
  });

  it('accepts an identity without an explicit menu title', () => {
    expect(parseBusinessProfile({ name: 'Test Bistró', timeZone: 'America/Lima' })).toEqual({
      name: 'Test Bistró',
      timeZone: 'America/Lima',
    });
  });

  it('keeps an explicit menu title', () => {
    expect(
      parseBusinessProfile({ name: 'Test Bistró', timeZone: 'America/Lima', menuTitle: 'Menú' }),
    ).toEqual({ name: 'Test Bistró', timeZone: 'America/Lima', menuTitle: 'Menú' });
  });

  it('reports an unreadable profile file instead of failing silently', () => {
    expect(() => loadBusinessProfile('business/does-not-exist.json')).toThrow(
      /Unable to read business\/does-not-exist\.json/,
    );
  });
});

describe('business seed', () => {
  it('stays within the gastronomic catalog vertical', () => {
    expectGastronomicCatalog(businessSeed);
  });

  it('is idempotent: a second run converges to the same snapshot', async () => {
    const store = new FakeSeedStore();

    await seedBusiness(store, businessSeed);
    const afterFirst = store.snapshot();
    await seedBusiness(store, businessSeed);

    expect(store.snapshot()).toEqual(afterFirst);
    expect(store.upsertKeys.every((key) => /^(product|promotion|faq):[a-z0-9-]+$/.test(key))).toBe(
      true,
    );
  });

  it('applies exactly the records of the seed it is given', async () => {
    const store = new FakeSeedStore();

    const summary = await seedBusiness(store, businessSeed);

    expect(summary).toEqual({
      products: businessSeed.products.length,
      promotions: businessSeed.promotions.length,
      faqs: businessSeed.faqs.length,
      obsoleteFaqsRemoved: businessSeed.obsoleteFaqSlugs.length,
    });
    expect([...store.products.keys()].sort()).toEqual(
      businessSeed.products.map((product) => product.slug).sort(),
    );
  });

  it('generates knowledge documents covering every seeded category', () => {
    const documents = new KnowledgeDocumentFactory().createCatalogDocuments(
      toProductRows(businessSeed),
      toFaqRows(businessSeed),
    );

    expect(documents.length).toBeGreaterThan(0);
    const categoryDocs = documents
      .filter((doc) => doc.sourceType === 'product_category')
      .map((doc) => doc.sourceId)
      .sort();
    expect(categoryDocs).toEqual([...new Set(businessSeed.products.map((p) => p.category))].sort());
  });
});

describe('engine reuse for a different gastronomic business', () => {
  const altProfile: BusinessProfile = alternateBusinessProfile;
  const altSeed: BusinessSeed = alternateBusinessSeed;

  it('accepts an unrelated profile through the same contract', () => {
    expect(altProfile.name).not.toBe(businessProfile.name);
    expect(altProfile.timeZone).not.toBe(businessProfile.timeZone);
    expect(parseBusinessProfile(altProfile)).toEqual(altProfile);
  });

  it('seeds and indexes the unrelated business with no engine change', async () => {
    expectGastronomicCatalog(altSeed);

    const store = new FakeSeedStore();
    await seedBusiness(store, altSeed);
    await seedBusiness(store, altSeed);
    expect([...store.products.keys()].sort()).toEqual(
      altSeed.products.map((product) => product.slug).sort(),
    );

    const documents = new KnowledgeDocumentFactory().createCatalogDocuments(
      toProductRows(altSeed),
      toFaqRows(altSeed),
    );
    expect(documents.some((doc) => doc.sourceType === 'product_category')).toBe(true);
  });
});
