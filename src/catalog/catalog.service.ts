import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  getProducts() {
    return this.prisma.product.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  getPromotions() {
    return this.prisma.promotion.findMany({
      where: { active: true },
      orderBy: { name: 'asc' },
    });
  }

  getFaqs() {
    return this.prisma.faq.findMany({
      where: { active: true },
      orderBy: { question: 'asc' },
    });
  }
}
