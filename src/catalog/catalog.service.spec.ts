import type { PrismaService } from '../database/prisma.service';
import { DatabaseUnavailableException } from '../common/application-error';
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

  it('returns a controlled database error when reading the catalog fails', async () => {
    const service = new CatalogService({
      product: {
        findMany: jest.fn().mockRejectedValue(new Error('connection failed')),
      },
    } as unknown as PrismaService);

    await expect(service.getProducts()).rejects.toEqual(new DatabaseUnavailableException());
  });
});
