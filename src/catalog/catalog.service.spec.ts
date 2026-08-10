import type { PrismaService } from '../database/prisma.service';
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
});
