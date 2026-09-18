import { Injectable } from '@nestjs/common';
import type { Category, Faq, Product } from '../generated/prisma/client';
import type { KnowledgeDocument } from './rag.types';

@Injectable()
export class KnowledgeDocumentFactory {
  createCatalogDocuments(
    products: Array<Product & { category: Category }>,
    faqs: Faq[],
  ): KnowledgeDocument[] {
    return [
      ...products.map((product) => this.createProductDocument(product)),
      ...this.createCategoryDocuments(products),
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

  private createCategoryDocuments(
    products: Array<Product & { category: Category }>,
  ): KnowledgeDocument[] {
    const productsByCategory = new Map<string, Array<Product & { category: Category }>>();
    for (const product of products) {
      const group = productsByCategory.get(product.category.slug) ?? [];
      group.push(product);
      productsByCategory.set(product.category.slug, group);
    }
    return [...productsByCategory.values()].flatMap((categoryProducts) => {
      const category = categoryProducts[0]!.category;
      const productList = categoryProducts
        .map((product) => `${product.name} — ${product.currency} ${product.price.toString()}`)
        .join('; ');

      return [
        {
          sourceType: 'product_category' as const,
          sourceId: category.slug,
          chunkIndex: 0,
          content: [
            'Tipo: menú o carta de productos.',
            `Categoría: ${category.label}.`,
            `Consultas relacionadas: ${[category.label, ...category.searchTerms].join('; ')}.`,
            `Productos y precios disponibles: ${productList}.`,
          ].join(' '),
          metadata: { category: category.slug },
        },
      ];
    });
  }

  private createProductDocument(product: Product & { category: Category }): KnowledgeDocument {
    return {
      sourceType: 'product',
      sourceId: product.id,
      chunkIndex: 0,
      content: [
        'Tipo: producto.',
        `Nombre: ${product.name}.`,
        `Categoría: ${product.category.label}.`,
        `Descripción: ${product.description}`,
        `Precio: ${product.currency} ${product.price.toString()}.`,
      ].join(' '),
      metadata: {
        slug: product.slug,
        category: product.category.slug,
      },
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
}
