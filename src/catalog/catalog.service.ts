import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../common/request-context';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { CatalogAttributeFilter, ProductSearchFilters } from './catalog.types';
import type { PromotionSearchFilters } from './promotion.types';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  getProducts() {
    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.products.read' },
      () =>
        this.prisma.product.findMany({
          where: { active: true, category: { active: true } },
          include: { category: true },
          orderBy: { name: 'asc' },
        }),
    );
  }

  searchProducts(
    {
      productName,
      category,
      maxPrice,
      maxPriceExclusive,
      attributeFilters,
      limit,
    }: ProductSearchFilters,
    context?: RequestContext,
  ) {
    const attributeWhere = this.attributeFiltersToWhere(attributeFilters ?? []);

    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.products.search', context },
      () =>
        this.prisma.product.findMany({
          where: {
            active: true,
            category: {
              active: true,
              ...(category ? { slug: category } : {}),
            },
            ...(productName
              ? { name: { contains: productName, mode: 'insensitive' as const } }
              : {}),
            ...(maxPrice !== undefined
              ? { price: maxPriceExclusive ? { lt: maxPrice } : { lte: maxPrice } }
              : {}),
            ...(attributeWhere.length > 0 ? { AND: attributeWhere } : {}),
          },
          orderBy: { name: 'asc' },
          take: limit,
          include: { category: true },
        }),
    );
  }

  getCatalogConfiguration() {
    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.configuration.read' },
      () =>
        Promise.all([
          this.prisma.category.findMany({
            where: { active: true },
            orderBy: { slug: 'asc' },
          }),
          this.prisma.catalogAttribute.findMany({
            where: { active: true },
            orderBy: { key: 'asc' },
          }),
        ]),
    ).then(([categories, attributes]) => ({ categories, attributes }));
  }

  private attributeFiltersToWhere(filters: CatalogAttributeFilter[]): Prisma.ProductWhereInput[] {
    return filters.map((filter) => {
      const metadata = {
        path: [filter.key],
        ...(filter.matchesArray ? { array_contains: [filter.value] } : { equals: filter.value }),
      };
      return filter.operator === 'EXCLUDES' ? { NOT: { metadata } } : { metadata };
    });
  }

  getPromotions() {
    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.promotions.read' },
      () =>
        this.prisma.promotion.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
        }),
    );
  }

  searchPromotions(
    { promotionName, evaluatedAt, includeNotStarted }: PromotionSearchFilters,
    context?: RequestContext,
  ) {
    const dateWindow: Prisma.PromotionWhereInput[] = [
      { OR: [{ endsAt: null }, { endsAt: { gt: evaluatedAt } }] },
      ...(includeNotStarted
        ? []
        : [{ OR: [{ startsAt: null }, { startsAt: { lte: evaluatedAt } }] }]),
    ];

    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.promotions.search', context },
      () =>
        this.prisma.promotion.findMany({
          where: {
            active: true,
            ...(promotionName
              ? { name: { contains: promotionName, mode: 'insensitive' as const } }
              : {}),
            AND: dateWindow,
          },
          orderBy: { name: 'asc' },
        }),
    );
  }

  getFaqs() {
    return executeDatabaseOperation({ logger: this.logger, operation: 'catalog.faqs.read' }, () =>
      this.prisma.faq.findMany({
        where: { active: true },
        orderBy: { question: 'asc' },
      }),
    );
  }
}
