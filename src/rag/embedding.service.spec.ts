import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenAiEmbeddingFailedException } from '../common/application-error';
import { EmbeddingService } from './embedding.service';
import { EMBEDDING_DIMENSIONS } from './rag.types';

interface EmbeddingsClientStub {
  embeddings: {
    create: jest.Mock;
  };
}

function createEmbedding(value: number): number[] {
  return Array<number>(EMBEDDING_DIMENSIONS).fill(value);
}

function createService(): { service: EmbeddingService; create: jest.Mock } {
  const service = new EmbeddingService(
    new ConfigService({
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
      OPENAI_EMBEDDING_TIMEOUT_MS: 8_000,
      OPENAI_EMBEDDING_MAX_RETRIES: 1,
    }),
  );
  const client = service as unknown as { client: EmbeddingsClientStub };
  const create = jest.fn();
  client.client.embeddings.create = create;

  return { service, create };
}

describe('EmbeddingService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns no embeddings without calling OpenAI when the input is empty', async () => {
    const { service, create } = createService();

    await expect(service.embedMany([])).resolves.toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it('restores the input order when OpenAI returns indexed embeddings out of order', async () => {
    const firstEmbedding = createEmbedding(0.1);
    const secondEmbedding = createEmbedding(0.2);
    const { service, create } = createService();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    create.mockResolvedValue({
      model: 'text-embedding-3-small',
      data: [
        { index: 1, embedding: secondEmbedding },
        { index: 0, embedding: firstEmbedding },
      ],
      usage: { prompt_tokens: 4, total_tokens: 4 },
    });

    const result = await service.embedMany(['first', 'second'], { requestId: 'request-1' });

    expect(result).toEqual([firstEmbedding, secondEmbedding]);
    const configuredClient = service as unknown as {
      client: { timeout: number; maxRetries: number };
    };
    expect(configuredClient.client.timeout).toBe(8_000);
    expect(configuredClient.client.maxRetries).toBe(1);
    expect(create).toHaveBeenCalledWith({
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
      encoding_format: 'float',
      dimensions: EMBEDDING_DIMENSIONS,
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.embeddings.completed',
        requestId: 'request-1',
      }),
    );
  });

  it('returns the first embedding for a single input', async () => {
    const embedding = createEmbedding(0.3);
    const { service } = createService();
    const embedMany = jest.spyOn(service, 'embedMany').mockResolvedValue([embedding]);

    await expect(service.embed('espresso')).resolves.toEqual(embedding);
    expect(embedMany).toHaveBeenCalledWith(['espresso'], undefined);
  });

  it.each([
    {
      name: 'an API failure',
      configure: (create: jest.Mock) => create.mockRejectedValue(new Error('network failure')),
    },
    {
      name: 'an unexpected embedding shape',
      configure: (create: jest.Mock) =>
        create.mockResolvedValue({
          model: 'text-embedding-3-small',
          data: [{ index: 0, embedding: [0.1] }],
          usage: { prompt_tokens: 1, total_tokens: 1 },
        }),
    },
  ])('returns a controlled error for $name', async ({ configure }) => {
    const { service, create } = createService();
    configure(create);

    await expect(service.embedMany(['espresso'])).rejects.toEqual(
      new OpenAiEmbeddingFailedException(),
    );
  });

  it('returns a controlled error when OpenAI returns no embedding for a single input', async () => {
    const { service } = createService();
    jest.spyOn(service, 'embedMany').mockResolvedValue([]);

    await expect(service.embed('espresso')).rejects.toEqual(new OpenAiEmbeddingFailedException());
  });
});
