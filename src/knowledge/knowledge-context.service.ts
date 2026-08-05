import { Inject, Injectable } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';

interface KnowledgeProduct {
  name: string;
  description: string;
  price: { toString(): string };
  currency: string;
  category: string;
}

interface KnowledgePromotion {
  name: string;
  description: string;
}

interface KnowledgeFaq {
  question: string;
  answer: string;
  category: string;
}

interface KnowledgeCatalog {
  getProducts(): Promise<KnowledgeProduct[]>;
  getPromotions(): Promise<KnowledgePromotion[]>;
  getFaqs(): Promise<KnowledgeFaq[]>;
}

@Injectable()
export class KnowledgeContextService {
  constructor(
    @Inject(CatalogService)
    private readonly catalog: KnowledgeCatalog,
  ) {}

  async getContext(): Promise<string> {
    const [products, promotions, faqs] = await Promise.all([
      this.catalog.getProducts(),
      this.catalog.getPromotions(),
      this.catalog.getFaqs(),
    ]);

    return JSON.stringify({
      products: products.map((product) => ({
        name: product.name,
        description: product.description,
        price: product.price.toString(),
        currency: product.currency,
        category: product.category,
      })),
      promotions: promotions.map((promotion) => ({
        name: promotion.name,
        description: promotion.description,
      })),
      faqs: faqs.map((faq) => ({
        question: faq.question,
        answer: faq.answer,
        category: faq.category,
      })),
    });
  }
}
