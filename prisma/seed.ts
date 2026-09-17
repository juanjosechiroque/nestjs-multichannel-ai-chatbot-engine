import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { businessProfile } from '../business/profile';
import { businessSeed } from '../business/seed';
import { seedBusiness, type BusinessSeedWriter } from '../business/seed-runner';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const writer: BusinessSeedWriter = {
  upsertProductBySlug: async (record) => {
    await prisma.product.upsert({
      where: { slug: record.slug },
      update: record,
      create: record,
    });
  },
  upsertPromotionBySlug: async (record) => {
    await prisma.promotion.upsert({
      where: { slug: record.slug },
      update: record,
      create: record,
    });
  },
  upsertFaqBySlug: async (record) => {
    await prisma.faq.upsert({
      where: { slug: record.slug },
      update: record,
      create: record,
    });
  },
  deleteFaqsBySlug: async (slugs) => {
    if (slugs.length === 0) return;
    await prisma.faq.deleteMany({ where: { slug: { in: [...slugs] } } });
  },
};

seedBusiness(writer, businessSeed)
  .then((summary) => {
    console.log(
      `Seed completed for "${businessProfile.name}": ${summary.products} products, ${summary.promotions} promotions and ${summary.faqs} FAQs.`,
    );
  })
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
