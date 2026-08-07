import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { RequestContext } from '../common/request-context';
import { EMBEDDING_DIMENSIONS } from './rag.types';

@Injectable()
export class EmbeddingService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly model: string;

  constructor(config: ConfigService) {
    this.client = new OpenAI({
      apiKey: config.getOrThrow<string>('OPENAI_API_KEY'),
    });
    this.model = config.get<string>('OPENAI_EMBEDDING_MODEL', 'text-embedding-3-small');
  }

  async embed(input: string, context?: RequestContext): Promise<number[]> {
    const embeddings = await this.embedMany([input], context);
    const embedding = embeddings[0];

    if (!embedding) {
      throw new ServiceUnavailableException('OpenAI returned an empty embedding');
    }

    return embedding;
  }

  async embedMany(inputs: string[], context?: RequestContext): Promise<number[][]> {
    if (inputs.length === 0) {
      return [];
    }

    const startedAt = Date.now();

    try {
      const response = await this.client.embeddings.create({
        model: this.model,
        input: inputs,
        encoding_format: 'float',
        dimensions: EMBEDDING_DIMENSIONS,
      });
      const embeddings = [...response.data]
        .sort((left, right) => left.index - right.index)
        .map((item) => item.embedding);

      if (
        embeddings.length !== inputs.length ||
        embeddings.some((embedding) => embedding.length !== EMBEDDING_DIMENSIONS)
      ) {
        throw new Error('OpenAI returned embeddings with an unexpected shape');
      }

      this.logger.log({
        event: 'openai.embeddings.completed',
        ...context,
        model: response.model,
        durationMs: Date.now() - startedAt,
        inputs: inputs.length,
        inputTokens: response.usage.prompt_tokens,
        totalTokens: response.usage.total_tokens,
      });

      return embeddings;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error';
      this.logger.error({
        event: 'openai.embeddings.failed',
        ...context,
        model: this.model,
        durationMs: Date.now() - startedAt,
        message,
      });
      throw new ServiceUnavailableException(
        'La búsqueda de conocimiento no está disponible en este momento.',
      );
    }
  }
}
