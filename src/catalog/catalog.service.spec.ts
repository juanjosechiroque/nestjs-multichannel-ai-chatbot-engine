import type { PrismaService } from '../database/prisma.service';
import { DatabaseUnavailableException } from '../common/application-error';
import { CatalogAttributeType } from '../generated/prisma/enums';
import { alternateBusinessSeed } from '../../test/fixtures/alternate-business';
import { CatalogService } from './catalog.service';

describe('CatalogService', () => {
  it('returns only active products ordered by name', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    await expect(service.getProducts()).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, category: { active: true } },
      include: { category: true },
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

  it('searches only promotions valid within the current date window', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      promotion: { findMany },
    } as unknown as PrismaService);
    const evaluatedAt = new Date('2026-08-15T00:30:00.000Z');
    const context = {
      requestId: 'request-1',
      conversationId: 'conversation-1',
      channel: 'web' as const,
    };

    await service.searchPromotions(
      {
        promotionName: 'Viernes frío',
        evaluatedAt,
        includeNotStarted: false,
      },
      context,
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        name: { contains: 'Viernes frío', mode: 'insensitive' },
        AND: [
          { OR: [{ endsAt: null }, { endsAt: { gt: evaluatedAt } }] },
          { OR: [{ startsAt: null }, { startsAt: { lte: evaluatedAt } }] },
        ],
      },
      orderBy: { name: 'asc' },
    });
  });

  it('includes scheduled promotions but excludes ended ones for the published catalog', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      promotion: { findMany },
    } as unknown as PrismaService);
    const evaluatedAt = new Date('2026-08-15T00:30:00.000Z');

    await service.searchPromotions({ evaluatedAt, includeNotStarted: true });

    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: evaluatedAt } }] }],
      },
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
          category: 'books',
          maxPrice: 15,
          maxPriceExclusive: false,
          attributeFilters: [
            { key: 'format', operator: 'MATCHES', value: 'HARDCOVER' },
            { key: 'signed', operator: 'MATCHES', value: true },
          ],
          limit: 20,
        },
        context,
      ),
    ).resolves.toEqual([]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        active: true,
        category: { active: true, slug: 'books' },
        name: { contains: 'cappuccino', mode: 'insensitive' },
        price: { lte: 15 },
        AND: [
          { metadata: { path: ['format'], equals: 'HARDCOVER' } },
          { metadata: { path: ['signed'], equals: true } },
        ],
      },
      orderBy: { name: 'asc' },
      take: 20,
      include: { category: true },
    });
  });

  it('applies an exclusive maximum price when the customer says less than', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    await service.searchProducts({ maxPrice: 15, maxPriceExclusive: true, limit: 20 });

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, category: { active: true }, price: { lt: 15 } },
      orderBy: { name: 'asc' },
      take: 20,
      include: { category: true },
    });
  });

  it('excludes products from inactive categories in a broad search', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    await service.searchProducts({ limit: 20 });

    expect(findMany).toHaveBeenCalledWith({
      where: { active: true, category: { active: true } },
      orderBy: { name: 'asc' },
      take: 20,
      include: { category: true },
    });
  });

  it('searches the alternate business fixture by configurable category and attribute', async () => {
    const category = alternateBusinessSeed.categories.find(({ slug }) => slug === 'books')!;
    const attribute = alternateBusinessSeed.attributes.find(({ key }) => key === 'format')!;
    const fixtureProduct = alternateBusinessSeed.products.find(
      ({ slug }) => slug === 'the-cloud-atlas',
    )!;
    const findMany = jest.fn().mockImplementation((args: { where: unknown }) => {
      expect(args.where).toEqual({
        active: true,
        category: { active: true, slug: category.slug },
        AND: [{ metadata: { path: [attribute.key], equals: 'HARDCOVER' } }],
      });
      return [
        {
          ...fixtureProduct,
          id: fixtureProduct.slug,
          category: { id: category.slug, ...category },
        },
      ];
    });
    const service = new CatalogService({
      product: { findMany },
    } as unknown as PrismaService);

    const results = await service.searchProducts({
      category: category.slug,
      attributeFilters: [
        {
          key: attribute.key,
          operator: 'MATCHES',
          value: 'HARDCOVER',
        },
      ],
      limit: 20,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ slug: 'the-cloud-atlas', category: { slug: 'books' } });
    expect(attribute.type).toBe(CatalogAttributeType.STRING);
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
