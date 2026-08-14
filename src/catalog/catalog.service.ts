import { Injectable, Logger } from '@nestjs/common';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';

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
