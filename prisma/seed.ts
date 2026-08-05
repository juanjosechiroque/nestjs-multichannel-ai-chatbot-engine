import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { cafeNubeFaqs, cafeNubeProducts, cafeNubePromotions } from './seed-data/cafe-nube';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error('DATABASE_URL is required to seed the database');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function seed(): Promise<void> {
  for (const product of cafeNubeProducts) {
    await prisma.product.upsert({
      where: { slug: product.slug },
      update: product,
      create: product,
    });
  }

  for (const promotion of cafeNubePromotions) {
    await prisma.promotion.upsert({
      where: { slug: promotion.slug },
      update: promotion,
      create: promotion,
    });
  }

  for (const faq of cafeNubeFaqs) {
    await prisma.faq.upsert({
      where: { slug: faq.slug },
      update: faq,
      create: faq,
    });
  }

  console.log(
    `Seed completed: ${cafeNubeProducts.length} products, ${cafeNubePromotions.length} promotions and ${cafeNubeFaqs.length} FAQs.`,
  );
}

seed()
  .catch((error: unknown) => {
    console.error('Seed failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
