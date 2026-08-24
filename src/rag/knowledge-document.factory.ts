import { Injectable } from '@nestjs/common';
import type { Faq, Product, Promotion } from '../generated/prisma/client';
import { ProductCategory } from '../generated/prisma/enums';
import type { KnowledgeDocument } from './rag.types';

@Injectable()
export class KnowledgeDocumentFactory {
  createCatalogDocuments(
    products: Product[],
    promotions: Promotion[],
    faqs: Faq[],
  ): KnowledgeDocument[] {
    return [
      ...products.map((product) => this.createProductDocument(product)),
      ...this.createProductCategoryDocuments(products),
      ...promotions.map((promotion) => this.createPromotionDocument(promotion)),
      ...this.createServiceSummaryDocuments(faqs),
      ...faqs.flatMap((faq) => this.createFaqDocuments(faq)),
    ];
  }

  private createServiceSummaryDocuments(faqs: Faq[]): KnowledgeDocument[] {
    const services = faqs.flatMap((faq) => {
      const serviceSummary = this.getMetadataString(faq.metadata, 'serviceSummary');
      return serviceSummary ? [serviceSummary] : [];
    });

    if (services.length === 0) {
      return [];
    }

    return [
      {
        sourceType: 'faq',
        sourceId: 'business-services-summary',
        chunkIndex: 0,
        content: [
          'Tipo: resumen de servicios confirmados del negocio.',
          'Consultas relacionadas: qué servicios ofrecen; cuáles son sus servicios; servicios disponibles.',
          `Servicios confirmados: ${services.join('; ')}.`,
        ].join(' '),
        metadata: {
          slug: 'servicios',
          category: 'SERVICES',
          purpose: 'service_summary',
        },
      },
    ];
  }

  private createProductCategoryDocuments(products: Product[]): KnowledgeDocument[] {
    return Object.values(ProductCategory).flatMap((category) => {
      const categoryProducts = products.filter((product) => product.category === category);

      if (categoryProducts.length === 0) {
        return [];
      }

      const categoryLabel = this.getProductCategoryLabel(category);
      const searchPhrases = this.getProductCategorySearchPhrases(category);
      const productList = categoryProducts
        .map((product) => `${product.name} — ${product.currency} ${product.price.toString()}`)
        .join('; ');

      return [
        {
          sourceType: 'product_category' as const,
          sourceId: category,
          chunkIndex: 0,
          content: [
            'Tipo: menú o carta de productos.',
            `Categoría: ${categoryLabel}.`,
            `Consultas relacionadas: ${searchPhrases.join('; ')}.`,
            `Productos y precios disponibles: ${productList}.`,
          ].join(' '),
          metadata: { category },
        },
      ];
    });
  }

  private createProductDocument(product: Product): KnowledgeDocument {
    const category = this.getProductCategoryLabel(product.category);

    return {
      sourceType: 'product',
      sourceId: product.id,
      chunkIndex: 0,
      content: [
        'Tipo: producto.',
        `Nombre: ${product.name}.`,
        `Categoría: ${category}.`,
        `Descripción: ${product.description}`,
        `Precio: ${product.currency} ${product.price.toString()}.`,
      ].join(' '),
      metadata: {
        slug: product.slug,
        category: product.category,
      },
    };
  }

  private createPromotionDocument(promotion: Promotion): KnowledgeDocument {
    return {
      sourceType: 'promotion',
      sourceId: promotion.id,
      chunkIndex: 0,
      content: [
        'Tipo: promoción.',
        `Nombre: ${promotion.name}.`,
        `Descripción: ${promotion.description}`,
      ].join(' '),
      metadata: { slug: promotion.slug },
    };
  }

  private createFaqDocuments(faq: Faq): KnowledgeDocument[] {
    const searchPhrases = this.getSearchPhrases(faq.metadata);
    const metadata = {
      slug: faq.slug,
      category: faq.category,
    };
    const canonicalDocument: KnowledgeDocument = {
      sourceType: 'faq',
      sourceId: faq.id,
      chunkIndex: 0,
      content: [
        'Tipo: pregunta frecuente.',
        `Pregunta: ${faq.question}`,
        `Respuesta: ${faq.answer}`,
        `Categoría: ${faq.category}.`,
      ].join(' '),
      metadata,
    };

    if (searchPhrases.length === 0) {
      return [canonicalDocument];
    }

    return [
      canonicalDocument,
      {
        sourceType: 'faq',
        sourceId: faq.id,
        chunkIndex: 1,
        content: [
          `Consultas relacionadas: ${searchPhrases.join('; ')}.`,
          `Respuesta: ${faq.answer}`,
        ].join(' '),
        metadata: {
          ...metadata,
          purpose: 'search_aliases',
        },
      },
    ];
  }

  private getSearchPhrases(metadata: unknown): string[] {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return [];
    }

    const searchPhrases: unknown = (metadata as Record<string, unknown>).searchPhrases;

    if (!Array.isArray(searchPhrases)) {
      return [];
    }

    const values: unknown[] = searchPhrases;
    return values.filter(
      (searchPhrase): searchPhrase is string =>
        typeof searchPhrase === 'string' && searchPhrase.trim().length > 0,
    );
  }

  private getMetadataString(metadata: unknown, key: string): string | undefined {
    if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
      return undefined;
    }

    const value: unknown = (metadata as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
  }

  private getProductCategoryLabel(category: ProductCategory): string {
    switch (category) {
      case ProductCategory.HOT_DRINK:
        return 'bebida caliente';
      case ProductCategory.COLD_DRINK:
        return 'bebida fría';
      case ProductCategory.FOOD:
        return 'comida';
    }
  }

  private getProductCategorySearchPhrases(category: ProductCategory): string[] {
    switch (category) {
      case ProductCategory.HOT_DRINK:
        return [
          'qué bebidas calientes tienen',
          'menú de bebidas calientes',
          'opciones de café caliente',
        ];
      case ProductCategory.COLD_DRINK:
        return [
          'qué bebidas frías tienen',
          'menú de bebidas frías',
          'opciones de bebidas con hielo',
        ];
      case ProductCategory.FOOD:
        return [
          'qué opciones de comida tienen',
          'carta de comida y platos disponibles',
          'puedo ver la carta para comer',
          'opciones para comer o acompañar el café',
        ];
    }
  }
}
