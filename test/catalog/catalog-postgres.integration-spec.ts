import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../src/database/prisma.service';
import { CatalogService } from '../../src/catalog/catalog.service';
import { seedBusiness, type BusinessSeedWriter } from '../../business/seed-runner';
import { alternateBusinessSeed } from '../fixtures/alternate-business';
import {
  applyMigrations,
  assertDisposableTestDatabase,
  createIntegrationDatabase,
} from '../support/test-database';

describe('CatalogService with PostgreSQL', () => {
  let prisma: PrismaService;
  let catalog: CatalogService;
  const previousNodeEnvironment = process.env.NODE_ENV;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    const databaseName = `chatbot_engine_catalog_integration_test_${randomUUID()
      .replaceAll('-', '')
      .slice(0, 16)}`;
    const databaseUrl = await createIntegrationDatabase(databaseName);

    await applyMigrations(databaseUrl);
    prisma = new PrismaService(new ConfigService({ DATABASE_URL: databaseUrl }));
    await prisma.$connect();
    await assertDisposableTestDatabase(prisma, databaseName);
    catalog = new CatalogService(prisma);

    const writer: BusinessSeedWriter = {
      upsertCategoryBySlug: async (record) => {
        const data = { ...record, searchTerms: [...record.searchTerms] };
        await prisma.category.upsert({ where: { slug: record.slug }, update: data, create: data });
      },
      upsertCatalogAttributeByKey: async (record) => {
        const data = { ...record, allowedValues: [...record.allowedValues] };
        await prisma.catalogAttribute.upsert({
          where: { key: record.key },
          update: data,
          create: data,
        });
      },
      upsertProductBySlug: async (record) => {
        const { category, ...product } = record;
        const data = { ...product, category: { connect: { slug: category } } };
        await prisma.product.upsert({ where: { slug: record.slug }, update: data, create: data });
      },
      upsertPromotionBySlug: async (record) => {
        await prisma.promotion.upsert({
          where: { slug: record.slug },
          update: record,
          create: record,
        });
      },
      upsertFaqBySlug: async (record) => {
        await prisma.faq.upsert({ where: { slug: record.slug }, update: record, create: record });
      },
      deleteFaqsBySlug: async (slugs) => {
        await prisma.faq.deleteMany({ where: { slug: { in: [...slugs] } } });
      },
    };
    await prisma.product.deleteMany();
    await prisma.promotion.deleteMany();
    await prisma.faq.deleteMany();
    await prisma.category.deleteMany();
    await prisma.catalogAttribute.deleteMany();
    await seedBusiness(writer, alternateBusinessSeed);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (previousNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnvironment;
    }
  });

  it('returns the alternate fixture product for a configurable category and attribute', async () => {
    const results = await catalog.searchProducts({
      category: 'books',
      attributeFilters: [{ key: 'format', operator: 'MATCHES', value: 'HARDCOVER' }],
      limit: 20,
    });

    expect(results.map((product) => product.slug)).toEqual(['the-cloud-atlas']);
    expect(results[0]).toMatchObject({
      name: 'The Cloud Atlas',
      category: { slug: 'books', label: 'Books' },
      metadata: { format: 'HARDCOVER' },
    });
  });
});
