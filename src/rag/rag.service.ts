import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingService } from './embedding.service';
import type { RagSearchResult } from './rag.types';
import { toVectorLiteral } from './vector.util';

@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);
  private readonly minSimilarity: number;

  constructor(
    @Inject(EmbeddingService)
    private readonly embeddings: Pick<EmbeddingService, 'embed'>,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.minSimilarity = config.get<number>('RAG_MIN_SIMILARITY', 0.5);
  }

  async search(query: string, topK: number): Promise<RagSearchResult[]> {
    if (!Number.isInteger(topK) || topK < 1) {
      throw new RangeError('topK must be a positive integer');
    }

    const startedAt = Date.now();
    const queryEmbedding = await this.embeddings.embed(query);
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const results = await this.prisma.$queryRaw<RagSearchResult[]>`
      SELECT
        "source_id" AS "sourceId",
        COALESCE("metadata"->>'slug', "source_id") AS "sourceKey",
        "source_type" AS "sourceType",
        "content",
        1 - ("embedding" <=> ${vectorLiteral}::vector) AS "similarity"
      FROM "knowledge_chunks"
      WHERE 1 - ("embedding" <=> ${vectorLiteral}::vector) >= ${this.minSimilarity}
      ORDER BY "embedding" <=> ${vectorLiteral}::vector
      LIMIT ${topK}
    `;

    const relevantResults = results.filter((result) => result.similarity >= this.minSimilarity);

    this.logger.log({
      event: 'rag.search.completed',
      durationMs: Date.now() - startedAt,
      topK,
      minSimilarity: this.minSimilarity,
      results: relevantResults.length,
      sources: relevantResults.map((result) => ({
        sourceId: result.sourceId,
        sourceKey: result.sourceKey,
        sourceType: result.sourceType,
        similarity: Number(result.similarity.toFixed(4)),
      })),
    });

    return relevantResults;
  }

  async getContext(query: string, topK: number): Promise<string> {
    const results = await this.search(query, topK);

    return JSON.stringify({
      knowledge: results.map((result) => ({
        type: result.sourceType,
        content: result.content,
      })),
    });
  }
}
