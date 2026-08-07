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
      ...faqs.map((faq) => this.createFaqDocument(faq)),
    ];
  }

  private createProductCategoryDocuments(products: Product[]): KnowledgeDocument[] {
    return Object.values(ProductCategory).flatMap((category) => {
      const categoryProducts = products.filter((product) => product.category === category);

      if (categoryProducts.length === 0) {
        return [];
      }

      const categoryLabel = this.getProductCategoryLabel(category);
      const productList = categoryProducts
        .map(
          (product) =>
            `${product.name}: ${product.description} Precio: ${product.currency} ${product.price.toString()}.`,
        )
        .join(' ');

      return [
        {
          sourceType: 'product_category' as const,
          sourceId: category,
          chunkIndex: 0,
          content: [
            'Tipo: catálogo de productos.',
            `Categoría: ${categoryLabel}.`,
            `Productos disponibles en esta categoría: ${productList}`,
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

  private createFaqDocument(faq: Faq): KnowledgeDocument {
    return {
      sourceType: 'faq',
      sourceId: faq.id,
      chunkIndex: 0,
      content: [
        'Tipo: pregunta frecuente.',
        `Pregunta: ${faq.question}`,
        `Respuesta: ${faq.answer}`,
        `Categoría: ${faq.category}.`,
      ].join(' '),
      metadata: {
        slug: faq.slug,
        category: faq.category,
      },
    };
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
}
