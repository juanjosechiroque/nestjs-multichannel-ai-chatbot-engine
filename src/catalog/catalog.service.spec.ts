import type { PrismaService } from '../database/prisma.service';
import { DatabaseUnavailableException } from '../common/application-error';
import { ProductCategory } from '../generated/prisma/enums';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  it('returns only active products ordered by name', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    await expect(service.getProducts()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  });

  it('returns only active promotions ordered by name', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      promotion: { findMany },
    } as unknown as PrismaService);

    await expect(service.getPromotions()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  });

  it('searches active products with exact structured filters', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);
    const context = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      channel: 'web' as const,
    };

    await expect(
      service.searchProducts(
        {
          productName: 'cappuccino',
          category: ProductCategory.HOT_DRINK,
          maxPrice: 15,
          maxPriceExclusive: false,
          dietaryTags: ['VEGAN'],
          excludedAllergens: ['MILK', 'TREE_NUTS'],
          containsCoffee: false,
          decaffeinated: false,
          caffeineFree: true,
          limit: 20,
        },
        context,
      ),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        name: { contains: 'cappuccino', mode: 'insensitive' },
        category: ProductCategory.HOT_DRINK,
        price: { lte: 15 },
        AND: [
          { metadata: { path: ['dietaryTags'], array_contains: ['VEGAN'] } },
          { metadata: { path: ['containsCoffee'], equals: false } },
          { metadata: { path: ['decaffeinated'], equals: false } },
          { metadata: { path: ['caffeineFree'], equals: true } },
        ],
        NOT: {
          OR: [
            { metadata: { path: ['allergens'], array_contains: ['MILK'] } },
            { metadata: { path: ['allergens'], array_contains: ['TREE_NUTS'] } },
          ],
        },
      },
      orderBy: { name: 'asc' },
      take: 20,
    });
  });

  it('applies an exclusive maximum price when the customer says less than', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    await service.searchProducts({ maxPrice: 15, maxPriceExclusive: true, limit: 20 });

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, price: { lt: 15 } },
      orderBy: { name: 'asc' },
      take: 20,
    });
  });

  it('returns only active FAQs ordered by question', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      faq: { findMany },
    } as unknown as PrismaService);

    await expect(service.getFaqs()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true },
      orderBy: { question: 'asc' },
    });
  });

  it('returns a controlled database error when reading the catalog fails', async () => {
    const service = new CatalogService({
      product: {
        findMany: jest.fn().mockRejectedValue(new Error('connection failed')),
      },
    } as unknown as PrismaService);

    await expect(service.getProducts()).rejects.toEqual(new DatabaseUnavailableException());
  });
});
