import type { CatalogService } from '../catalog/catalog.service';
import type { PrismaService } from '../database/prisma.service';
import type { EmbeddingService } from './embedding.service';
import type { KnowledgeDocumentFactory } from './knowledge-document.factory';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { EMBEDDING_DIMENSIONS, type KnowledgeDocument } from './rag.types';

interface ExistingChunk {
  id: string;
  sourceType: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
}

interface TestHarnessOptions {
  documents: KnowledgeDocument[];
  existingChunks?: ExistingChunk[];
  vectors?: number[][];
}

function createDocument(content = 'Question: What are your opening hours?'): KnowledgeDocument {
  return {
    sourceType: 'faq',
    sourceId: 'faq-hours',
    chunkIndex: 0,
    content,
    metadata: { slug: 'opening-hours' },
  };
}

function createVector(value: number): number[] {
  return Array<number>(EMBEDDING_DIMENSIONS).fill(value);
}

function createHarness({
  documents,
  existingChunks = [],
  vectors = documents.map(() => createVector(0.1)),
}: TestHarnessOptions) {
  const catalog = {
    getProducts: jest.fn().mockResolvedValue([]),
    getPromotions: jest.fn().mockResolvedValue([]),
    getFaqs: jest.fn().mockResolvedValue([]),
  } as unknown as CatalogService;
  const documentFactory = {
    createCatalogDocuments: jest.fn().mockReturnValue(documents),
  } as unknown as KnowledgeDocumentFactory;
  const embedMany = jest.fn().mockResolvedValue(vectors);
  const embeddings = { embedMany } as unknown as EmbeddingService;
  const executeRaw = jest.fn().mockResolvedValue(1);
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  const transaction = {
    $executeRaw: executeRaw,
    knowledgeChunk: { deleteMany },
  };
  const runTransaction = jest
    .fn()
    .mockImplementation((operation: (client: typeof transaction) => Promise<unknown>) =>
      operation(transaction),
    );
  const prisma = {
    knowledgeChunk: {
      findMany: jest.fn().mockResolvedValue(existingChunks),
    },
    $transaction: runTransaction,
  } as unknown as PrismaService;
  const service = new KnowledgeIngestionService(catalog, documentFactory, embeddings, prisma);

  return {
    service,
    catalog,
    documentFactory,
    embedMany,
    executeRaw,
    deleteMany,
    runTransaction,
  };
}

describe('KnowledgeIngestionService', () => {
  it('embeds and inserts new knowledge documents', async () => {
    const documents = [
      createDocument(),
      {
        ...createDocument('Question: Where are you located?'),
        sourceId: 'faq-location',
        metadata: { slug: 'location' },
      },
    ];
    const harness = createHarness({ documents });

    await expect(harness.service.ingest()).resolves.toEqual({
      total: 2,
      embedded: 2,
      unchanged: 0,
      deleted: 0,
    });
    expect(harness.embedMany).toHaveBeenCalledWith(documents.map((document) => document.content));
    expect(harness.executeRaw).toHaveBeenCalledTimes(2);
    expect(harness.runTransaction).toHaveBeenCalledTimes(1);
  });

  it('does not regenerate or rewrite unchanged documents', async () => {
    const document = createDocument();
    const harness = createHarness({
      documents: [document],
      existingChunks: [
        {
          id: 'existing-id',
          sourceType: document.sourceType,
          sourceId: document.sourceId,
          chunkIndex: document.chunkIndex,
          content: document.content,
        },
      ],
      vectors: [],
    });

    await expect(harness.service.ingest()).resolves.toEqual({
      total: 1,
      embedded: 0,
      unchanged: 1,
      deleted: 0,
    });
    expect(harness.embedMany).toHaveBeenCalledWith([]);
    expect(harness.executeRaw).not.toHaveBeenCalled();
    expect(harness.deleteMany).not.toHaveBeenCalled();
  });

  it('updates changed documents and deletes stale chunks in the same transaction', async () => {
    const document = createDocument('Updated opening hours');
    const harness = createHarness({
      documents: [document],
      existingChunks: [
        {
          id: 'changed-id',
          sourceType: document.sourceType,
          sourceId: document.sourceId,
          chunkIndex: document.chunkIndex,
          content: 'Old opening hours',
        },
        {
          id: 'stale-id',
          sourceType: 'faq',
          sourceId: 'removed-faq',
          chunkIndex: 0,
          content: 'Removed FAQ',
        },
      ],
    });

    await expect(harness.service.ingest()).resolves.toEqual({
      total: 1,
      embedded: 1,
      unchanged: 0,
      deleted: 1,
    });
    expect(harness.executeRaw).toHaveBeenCalledTimes(1);
    expect(harness.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['stale-id'] } } });
  });

  it('aborts ingestion when an embedding is missing', async () => {
    const harness = createHarness({ documents: [createDocument()], vectors: [] });

    await expect(harness.service.ingest()).rejects.toThrow(
      'Missing embedding for knowledge document',
    );
    expect(harness.executeRaw).not.toHaveBeenCalled();
    expect(harness.deleteMany).not.toHaveBeenCalled();
  });
});
