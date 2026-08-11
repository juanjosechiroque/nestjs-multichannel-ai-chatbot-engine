import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../common/request-context';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import type { Prisma } from '../generated/prisma/client';
import type { ProductSearchFilters } from './catalog.types';

@Injectable()
export class CatalogService {
  private readonly logger = new Logger(CatalogService.name);

  constructor(private readonly prisma: PrismaService) {}

  getProducts() {
    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.products.read' },
      () =>
        this.prisma.product.findMany({
          where: { active: true },
          orderBy: { name: 'asc' },
        }),
    );
  }

  searchProducts(
    {
      productName,
      category,
      maxPrice,
      dietaryTags,
      excludedAllergens,
      containsCoffee,
      decaffeinated,
      caffeineFree,
      limit,
    }: ProductSearchFilters,
    context?: RequestContext,
  ) {
    const preferenceFilters: Prisma.ProductWhereInput[] = [
      ...(dietaryTags && dietaryTags.length > 0
        ? [{ metadata: { path: ['dietaryTags'], array_contains: dietaryTags } }]
        : []),
      ...(containsCoffee !== undefined
        ? [{ metadata: { path: ['containsCoffee'], equals: containsCoffee } }]
        : []),
      ...(decaffeinated !== undefined
        ? [{ metadata: { path: ['decaffeinated'], equals: decaffeinated } }]
        : []),
      ...(caffeineFree !== undefined
        ? [{ metadata: { path: ['caffeineFree'], equals: caffeineFree } }]
        : []),
    ];
    const excludedAllergenFilters: Prisma.ProductWhereInput[] = (excludedAllergens ?? []).map(
      (allergen) => ({ metadata: { path: ['allergens'], array_contains: [allergen] } }),
    );

    return executeDatabaseOperation(
      { logger: this.logger, operation: 'catalog.products.search', context },
      () =>
        this.prisma.product.findMany({
          where: {
            active: true,
            ...(productName
              ? { name: { contains: productName, mode: 'insensitive' as const } }
              : {}),
            ...(category ? { category } : {}),
            ...(maxPrice !== undefined ? { price: { lte: maxPrice } } : {}),
            ...(preferenceFilters.length > 0 ? { AND: preferenceFilters } : {}),
            ...(excludedAllergenFilters.length > 0 ? { NOT: { OR: excludedAllergenFilters } } : {}),
          },
          orderBy: { name: 'asc' },
          take: limit,
        }),
    );
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

  getFaqs() {
    return executeDatabaseOperation({ logger: this.logger, operation: 'catalog.faqs.read' }, () =>
      this.prisma.faq.findMany({
        where: { active: true },
        orderBy: { question: 'asc' },
      }),
    );
  }
}
