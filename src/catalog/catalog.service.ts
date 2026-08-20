import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../common/request-context';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
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
    { productName, category, maxPrice, limit }: ProductSearchFilters,
    context?: RequestContext,
  ) {
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
