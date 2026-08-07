import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { CatalogService } from '../catalog/catalog.service';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingService } from './embedding.service';
import { KnowledgeDocumentFactory } from './knowledge-document.factory';
import type { IngestionResult, KnowledgeSourceType } from './rag.types';
import { toVectorLiteral } from './vector.util';

const MANAGED_SOURCE_TYPES: KnowledgeSourceType[] = [
  'product',
  'product_category',
  'promotion',
  'faq',
];

@Injectable()
export class KnowledgeIngestionService {
  private readonly logger = new Logger(KnowledgeIngestionService.name);

  constructor(
    private readonly catalog: CatalogService,
    private readonly documents: KnowledgeDocumentFactory,
    private readonly embeddings: EmbeddingService,
    private readonly prisma: PrismaService,
  ) {}

  async ingest(): Promise<IngestionResult> {
    const [products, promotions, faqs, existingChunks] = await Promise.all([
      this.catalog.getProducts(),
      this.catalog.getPromotions(),
      this.catalog.getFaqs(),
      this.prisma.knowledgeChunk.findMany({
        where: { sourceType: { in: MANAGED_SOURCE_TYPES } },
        select: {
          id: true,
          sourceType: true,
          sourceId: true,
          chunkIndex: true,
          content: true,
        },
      }),
    ]);
    const documents = this.documents.createCatalogDocuments(products, promotions, faqs);
    const existingByKey = new Map(
      existingChunks.map((chunk) => [this.getKey(chunk), chunk] as const),
    );
    const currentKeys = new Set(documents.map((document) => this.getKey(document)));
    const changedDocuments = documents.filter(
      (document) => existingByKey.get(this.getKey(document))?.content !== document.content,
    );
    const staleIds = existingChunks
      .filter((chunk) => !currentKeys.has(this.getKey(chunk)))
      .map((chunk) => chunk.id);
    const vectors = await this.embeddings.embedMany(
      changedDocuments.map((document) => document.content),
    );

    await this.prisma.$transaction(async (transaction) => {
      for (const [index, document] of changedDocuments.entries()) {
        const vector = vectors[index];

        if (!vector) {
          throw new Error('Missing embedding for knowledge document');
        }

        const vectorLiteral = toVectorLiteral(vector);
        const metadata = JSON.stringify(document.metadata);

        await transaction.$executeRaw`
          INSERT INTO "knowledge_chunks" (
            "id",
            "source_type",
            "source_id",
            "chunk_index",
            "content",
            "metadata",
            "embedding",
            "created_at",
            "updated_at"
          )
          VALUES (
            ${randomUUID()}::uuid,
            ${document.sourceType},
            ${document.sourceId},
            ${document.chunkIndex},
            ${document.content},
            ${metadata}::jsonb,
            ${vectorLiteral}::vector,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("source_type", "source_id", "chunk_index")
          DO UPDATE SET
            "content" = EXCLUDED."content",
            "metadata" = EXCLUDED."metadata",
            "embedding" = EXCLUDED."embedding",
            "updated_at" = CURRENT_TIMESTAMP
        `;
      }

      if (staleIds.length > 0) {
        await transaction.knowledgeChunk.deleteMany({
          where: { id: { in: staleIds } },
        });
      }
    });

    const result: IngestionResult = {
      total: documents.length,
      embedded: changedDocuments.length,
      unchanged: documents.length - changedDocuments.length,
      deleted: staleIds.length,
    };
    this.logger.log({ event: 'knowledge.ingestion.completed', ...result });

    return result;
  }

  private getKey(document: { sourceType: string; sourceId: string; chunkIndex: number }): string {
    return `${document.sourceType}:${document.sourceId}:${document.chunkIndex}`;
  }
}
