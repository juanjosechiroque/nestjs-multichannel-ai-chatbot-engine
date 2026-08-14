import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RequestContext } from '../common/request-context';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import { EmbeddingService } from './embedding.service';
import type { RagGenerationContext, RagSearchResult } from './rag.types';
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

  async search(query: string, topK: number, context?: RequestContext): Promise<RagSearchResult[]> {
    if (!Number.isInteger(topK) || topK < 1) {
      throw new RangeError('topK must be a positive integer');
    }

    const startedAt = Date.now();
    const queryEmbedding = await this.embeddings.embed(query, context);
    const vectorLiteral = toVectorLiteral(queryEmbedding);
    const results = await executeDatabaseOperation(
      {
        logger: this.logger,
        operation: 'rag.vector_search',
        context,
      },
      () => this.prisma.$queryRaw<RagSearchResult[]>`
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
      `,
    );

    const relevantResults = results.filter((result) => result.similarity >= this.minSimilarity);

    this.logger.log({
      event: relevantResults.length === 0 ? 'rag.search.no_results' : 'rag.search.completed',
      ...context,
      durationMs: Date.now() - startedAt,
      topK,
      minSimilarity: this.minSimilarity,
      resultCode: relevantResults.length === 0 ? 'RAG_NO_RESULTS' : 'RAG_RESULTS_FOUND',
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

  async getContext(query: string, topK: number, context?: RequestContext): Promise<string> {
    const results = await this.search(query, topK, context);
    const seenSources = new Set<string>();
    const uniqueResults = results.filter((result) => {
      const sourceKey = `${result.sourceType}:${result.sourceId}`;

      if (seenSources.has(sourceKey)) {
        return false;
      }

      seenSources.add(sourceKey);
      return true;
    });
    const generationContext: RagGenerationContext = {
      retrievalStatus: uniqueResults.length === 0 ? 'no_results' : 'results_found',
      knowledge: uniqueResults.map((result) => ({
        sourceId: result.sourceId,
        sourceKey: result.sourceKey,
        type: result.sourceType,
        content: result.content,
      })),
    };

    return JSON.stringify(generationContext);
  }
}
