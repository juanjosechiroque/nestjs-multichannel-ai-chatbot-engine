import { ConfigService } from '@nestjs/config';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaService } from '../../src/database/prisma.service';
import { RagService } from '../../src/rag/rag.service';
import { EMBEDDING_DIMENSIONS } from '../../src/rag/rag.types';
import { toVectorLiteral } from '../../src/rag/vector.util';

function createEmbedding(firstValue: number, secondValue: number): number[] {
  const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  embedding[0] = firstValue;
  embedding[1] = secondValue;
  return embedding;
}

const EXACT_EMBEDDING = createEmbedding(1, 0);
const NEAR_EMBEDDING = createEmbedding(0.8, 0.6);
const BELOW_THRESHOLD_EMBEDDING = createEmbedding(0, 1);

describe('RagService with PostgreSQL and pgvector', () => {
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let rag: RagService;
  const embed = jest.fn().mockResolvedValue(EXACT_EMBEDDING);

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('rag_integration')
      .withUsername('chatbot')
      .withPassword('chatbot')
      .start();

    const config = new ConfigService({
      DATABASE_URL: container.getConnectionUri(),
      RAG_MIN_SIMILARITY: 0.75,
    });
    prisma = new PrismaService(config);
    await prisma.$connect();

    await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS vector');
    await prisma.$executeRawUnsafe(`
      CREATE TABLE "knowledge_chunks" (
        "id" UUID PRIMARY KEY,
        "source_type" TEXT NOT NULL,
        "source_id" TEXT NOT NULL,
        "content" TEXT NOT NULL,
        "metadata" JSONB,
        "embedding" vector(${EMBEDDING_DIMENSIONS}) NOT NULL
      )
    `);
    await prisma.$executeRawUnsafe(`
      INSERT INTO "knowledge_chunks"
        ("id", "source_type", "source_id", "content", "metadata", "embedding")
      VALUES
        (
          '11111111-1111-4111-8111-111111111111',
          'faq',
          'exact-source',
          'Exact semantic match',
          '{"slug":"exact-match"}'::jsonb,
          '${toVectorLiteral(EXACT_EMBEDDING)}'::vector
        ),
        (
          '22222222-2222-4222-8222-222222222222',
          'faq',
          'near-source',
          'Relevant semantic match',
          '{"slug":"near-match"}'::jsonb,
          '${toVectorLiteral(NEAR_EMBEDDING)}'::vector
        ),
        (
          '33333333-3333-4333-8333-333333333333',
          'faq',
          'below-threshold-source',
          'Irrelevant semantic match',
          '{"slug":"below-threshold"}'::jsonb,
          '${toVectorLiteral(BELOW_THRESHOLD_EMBEDDING)}'::vector
        )
    `);

    rag = new RagService({ embed }, prisma, config);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    await container?.stop();
  });

  it('enables the vector extension in the temporary PostgreSQL database', async () => {
    const extensions = await prisma.$queryRaw<Array<{ extname: string }>>`
      SELECT "extname"
      FROM "pg_extension"
      WHERE "extname" = 'vector'
    `;

    expect(extensions).toEqual([{ extname: 'vector' }]);
  });

  it('orders results by cosine similarity and removes matches below the threshold', async () => {
    const results = await rag.search('deterministic test query', 5);

    expect(embed).toHaveBeenCalledWith('deterministic test query');
    expect(results.map((result) => result.sourceKey)).toEqual(['exact-match', 'near-match']);
    expect(results[0]?.similarity).toBeCloseTo(1);
    expect(results[1]?.similarity).toBeCloseTo(0.8);
    expect(results.every((result) => result.similarity >= 0.75)).toBe(true);
  });
});
