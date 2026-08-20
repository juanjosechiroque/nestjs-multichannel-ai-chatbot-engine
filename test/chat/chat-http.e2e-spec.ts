import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { configureApplication } from '../../src/app.setup';
import {
  DatabaseUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiRequestFailedException,
} from '../../src/common/application-error';
import { ConversationService } from '../../src/conversation/conversation.service';
import type { GenerateResponseInput, GenerateResponseResult } from '../../src/chat/openai.service';
import { OpenAiService } from '../../src/chat/openai.service';
import { PrismaService } from '../../src/database/prisma.service';
import { ProductCategory } from '../../src/generated/prisma/enums';
import { EmbeddingService } from '../../src/rag/embedding.service';
import { EMBEDDING_DIMENSIONS } from '../../src/rag/rag.types';
import { toVectorLiteral } from '../../src/rag/vector.util';
import { assertDisposableTestDatabase } from '../support/test-database';

const TEST_ENVIRONMENT = {
  NODE_ENV: 'test',
  PORT: '3000',
  OPENAI_API_KEY: 'e2e-not-a-real-key',
  OPENAI_MODEL: 'e2e-model',
  OPENAI_EMBEDDING_MODEL: 'e2e-embedding-model',
  OPENAI_MAX_OUTPUT_TOKENS: '500',
  OPENAI_GENERATION_TIMEOUT_MS: '20000',
  OPENAI_GENERATION_MAX_RETRIES: '1',
  OPENAI_EMBEDDING_TIMEOUT_MS: '8000',
  OPENAI_EMBEDDING_MAX_RETRIES: '1',
  RAG_MIN_SIMILARITY: '0.5',
  BUSINESS_NAME: 'Café Nube',
} as const;

type EnvironmentKey = keyof typeof TEST_ENVIRONMENT | 'DATABASE_URL';

interface ConversationResponse {
  sessionId: string;
}

interface ChatResponse {
  reply: string;
}

interface CatalogItemResponse {
  slug: string;
  active: boolean;
}

function deterministicEmbedding(): number[] {
  const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  embedding[0] = 1;
  return embedding;
}

async function applyMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  const migrationsPath = join(process.cwd(), 'prisma', 'migrations');
  const migrations = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  await client.connect();

  try {
    for (const migration of migrations) {
      const migrationPath = join(migrationsPath, migration.name, 'migration.sql');
      const sql = await readFile(migrationPath, 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

describe('HTTP conversation flow', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let server: Server;
  const originalEnvironment = new Map<EnvironmentKey, string | undefined>();
  const generate = jest.fn<Promise<GenerateResponseResult>, [GenerateResponseInput]>();
  const embed = jest.fn<Promise<number[]>, [string]>();

  beforeAll(async () => {
    for (const key of [...Object.keys(TEST_ENVIRONMENT), 'DATABASE_URL'] as EnvironmentKey[]) {
      originalEnvironment.set(key, process.env[key]);
    }

    Object.assign(process.env, TEST_ENVIRONMENT);

    const databaseName = `chatbot_engine_e2e_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase(databaseName)
      .withUsername('chatbot')
      .withPassword('chatbot')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
    await applyMigrations(container.getConnectionUri());

    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiService)
      .useValue({ generate })
      .overrideProvider(EmbeddingService)
      .useValue({ embed })
      .compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    prisma = app.get(PrismaService);
    const configuredDatabaseUrl = app.get(ConfigService).getOrThrow<string>('DATABASE_URL');

    if (configuredDatabaseUrl !== container.getConnectionUri()) {
      throw new Error('NestJS is not configured with the disposable E2E database URL');
    }

    await assertDisposableTestDatabase(prisma, databaseName);

    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    generate.mockReset().mockResolvedValue({
      answer: 'Respuesta de prueba',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    embed.mockReset().mockResolvedValue(deterministicEmbedding());
    await prisma.conversationMessage.deleteMany();
    await Promise.all([
      prisma.conversation.deleteMany(),
      prisma.knowledgeChunk.deleteMany(),
      prisma.product.deleteMany(),
      prisma.promotion.deleteMany(),
      prisma.faq.deleteMany(),
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await container?.stop();

    for (const [key, value] of originalEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns application health through the global API prefix', async () => {
    await request(server).get('/api/health').expect(200, { status: 'ok' });
  });

  it('creates a backend-managed web conversation with a UUID session', async () => {
    const response = await request(server).post('/api/conversations').expect(201);
    const body = response.body as ConversationResponse;

    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(
      prisma.conversation.findUnique({
        where: { channel_sessionId: { channel: 'web', sessionId: body.sessionId } },
      }),
    ).resolves.not.toBeNull();
  });

  it('returns only active products ordered by name', async () => {
    await prisma.product.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-activo',
          name: 'Zeta Latte',
          description: 'Producto activo que debe aparecer segundo.',
          price: '12.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-activo',
          name: 'Alpha Espresso',
          description: 'Producto activo que debe aparecer primero.',
          price: '8.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'producto-inactivo',
          name: 'Producto oculto',
          description: 'Este producto no debe exponerse.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: false,
        },
      ],
    });

    const response = await request(server).get('/api/products').expect(200);
    const products = response.body as CatalogItemResponse[];

    expect(products.map((product) => product.slug)).toEqual(['alpha-activo', 'zeta-activo']);
    expect(products.every((product) => product.active)).toBe(true);
  });

  it('returns only active promotions ordered by name', async () => {
    await prisma.promotion.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-promocion',
          name: 'Zeta promoción',
          description: 'Promoción activa que debe aparecer segunda.',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-promocion',
          name: 'Alpha promoción',
          description: 'Promoción activa que debe aparecer primera.',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'promocion-inactiva',
          name: 'Promoción oculta',
          description: 'Esta promoción no debe exponerse.',
          active: false,
        },
      ],
    });

    const response = await request(server).get('/api/promotions').expect(200);
    const promotions = response.body as CatalogItemResponse[];

    expect(promotions.map((promotion) => promotion.slug)).toEqual([
      'alpha-promocion',
      'zeta-promocion',
    ]);
    expect(promotions.every((promotion) => promotion.active)).toBe(true);
  });

  it('returns only active FAQs ordered by question', async () => {
    await prisma.faq.createMany({
      data: [
        {
          id: randomUUID(),
          slug: 'zeta-faq',
          question: '¿Zonas de delivery?',
          answer: 'Atendemos todo Miraflores.',
          category: 'DELIVERY',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'alpha-faq',
          question: '¿Aceptan tarjetas?',
          answer: 'Sí, aceptamos tarjetas.',
          category: 'PAYMENTS',
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'faq-inactiva',
          question: '¿Pregunta oculta?',
          answer: 'Esta respuesta no debe exponerse.',
          category: 'INACTIVE',
          active: false,
        },
      ],
    });

    const response = await request(server).get('/api/faqs').expect(200);
    const faqs = response.body as CatalogItemResponse[];

    expect(faqs.map((faq) => faq.slug)).toEqual(['alpha-faq', 'zeta-faq']);
    expect(faqs.every((faq) => faq.active)).toBe(true);
  });

  it('persists a social exchange without executing embeddings or RAG', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    const chatResponse = await request(server)
      .post('/api/chat')
      .send({ sessionId, message: 'Hola' })
      .expect(201);

    expect(chatResponse.body as ChatResponse).toEqual({ reply: 'Respuesta de prueba' });
    const generationInput = generate.mock.calls[0]?.[0];
    expect(generationInput?.context.requestId).toEqual(expect.any(String));
    expect(generationInput?.context.conversationId).toEqual(expect.any(String));
    expect(generationInput?.context.channel).toBe('web');
    expect(embed).not.toHaveBeenCalled();
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Hola',
        history: [],
      }),
    );
    expect(typeof generationInput?.searchKnowledge).toBe('function');
    expect(typeof generationInput?.searchCatalog).toBe('function');

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { channel_sessionId: { channel: 'web', sessionId } },
      include: { messages: { orderBy: { id: 'asc' } } },
    });

    expect(conversation.messages).toEqual([
      expect.objectContaining({ role: 'USER', content: 'Hola' }),
      expect.objectContaining({ role: 'ASSISTANT', content: 'Respuesta de prueba' }),
    ]);
  });

  it('queries the active product catalog without running embeddings', async () => {
    const productId = randomUUID();
    await prisma.product.createMany({
      data: [
        {
          id: productId,
          slug: 'cappuccino-nube',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'cappuccino-inactivo',
          name: 'Cappuccino Inactivo',
          description: 'No debe devolverse.',
          price: '10.00',
          category: ProductCategory.HOT_DRINK,
          active: false,
        },
      ],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    generate.mockImplementationOnce(async (input) => {
      toolOutput = await input.searchCatalog({
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
      });
      return {
        answer: 'El Cappuccino Nube cuesta S/ 13.00.',
        usedSources: [
          {
            sourceId: productId,
            sourceKey: 'cappuccino-nube',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Cuánto cuesta el cappuccino?' })
      .expect(201, { reply: 'El Cappuccino Nube cuesta S/ 13.00.' });

    expect(JSON.parse(toolOutput ?? '')).toEqual({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: productId,
          sourceKey: 'cappuccino-nube',
          type: 'product',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13',
          currency: 'PEN',
          category: 'HOT_DRINK',
        },
      ],
    });
    expect(embed).not.toHaveBeenCalled();
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('retrieves matching pgvector knowledge before generating and persisting a reply', async () => {
    const vectorLiteral = toVectorLiteral(deterministicEmbedding());
    const sourceId = 'faq-hours-e2e';
    const content =
      'Tipo: pregunta frecuente. Pregunta: ¿Cuál es el horario? Respuesta: Atendemos todos los días de 7:00 a. m. a 9:00 p. m.';
    await prisma.$executeRaw`
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
        'faq',
        ${sourceId},
        0,
        ${content},
        '{"slug":"horario-atencion"}'::jsonb,
        ${vectorLiteral}::vector,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    generate.mockImplementationOnce(async (input) => {
      toolOutput = await input.searchKnowledge('horario de atención');
      return {
        answer: 'Atendemos todos los días de 7:00 a. m. a 9:00 p. m.',
        usedSources: [
          {
            sourceId,
            sourceKey: 'horario-atencion',
            sourceType: 'faq',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_knowledge'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿A qué hora atienden?' })
      .expect(201, { reply: 'Atendemos todos los días de 7:00 a. m. a 9:00 p. m.' });

    const generationInput = generate.mock.calls[0]?.[0];
    expect(generationInput).toBeDefined();
    expect(JSON.parse(toolOutput ?? '')).toEqual({
      retrievalStatus: 'results_found',
      knowledge: [{ sourceId, sourceKey: 'horario-atencion', type: 'faq', content }],
    });
    expect(toolOutput).toContain(sourceId);
    expect(toolOutput).not.toContain('similarity');
    expect(embed).toHaveBeenCalledWith('horario de atención', generationInput?.context);
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('passes the persisted first exchange as history on the second message', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate
      .mockImplementationOnce(async (input) => {
        await input.searchKnowledge('bebidas calientes');
        return {
          answer: 'Tenemos bebidas calientes.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await input.searchKnowledge('la bebida caliente más barata');
        return {
          answer: 'El americano.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      });

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Qué bebidas calientes tienen?' })
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Y cuál es la más barata?' })
      .expect(201, { reply: 'El americano.' });

    const secondGenerationInput = generate.mock.calls[1]?.[0];
    expect(embed).toHaveBeenNthCalledWith(
      2,
      [
        'Previous customer message:',
        '¿Qué bebidas calientes tienen?',
        'Current customer message:',
        'la bebida caliente más barata',
      ].join('\n'),
      secondGenerationInput?.context,
    );
    expect(generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: '¿Y cuál es la más barata?',
        history: [
          { role: 'user', content: '¿Qué bebidas calientes tienen?' },
          { role: 'assistant', content: 'Tenemos bebidas calientes.' },
        ],
      }),
    );
  });

  it('rejects a valid but unknown session', async () => {
    await request(server)
      .post('/api/chat')
      .send({ sessionId: randomUUID(), message: 'Hola' })
      .expect(404)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(expect.objectContaining({ message: 'Conversation not found' }));
      });
  });

  it.each([
    ['an invalid UUID', { sessionId: 'not-a-uuid', message: 'Hola' }],
    ['an empty message', { sessionId: randomUUID(), message: '' }],
    ['an unexpected property', { sessionId: randomUUID(), message: 'Hola', internal: true }],
  ])('returns 400 for %s', async (_scenario, payload) => {
    await request(server).post('/api/chat').send(payload).expect(400);
  });

  it.each([
    ['the generation request fails', new OpenAiRequestFailedException()],
    ['OpenAI returns an empty response', new OpenAiEmptyResponseException()],
  ])('returns a controlled 503 when %s', async (_scenario, providerError) => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate.mockRejectedValueOnce(providerError);

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: 'Hola' })
      .expect(503)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(
          expect.objectContaining({
            message: 'El asistente no está disponible en este momento. Inténtalo nuevamente.',
          }),
        );
        expect(body).not.toHaveProperty('failureCode');
      });

    await expect(prisma.conversationMessage.count()).resolves.toBe(0);
  });

  it('returns a controlled 503 when PostgreSQL is unavailable', async () => {
    const conversations = app.get(ConversationService);
    const findBySession = jest
      .spyOn(conversations, 'findBySession')
      .mockRejectedValueOnce(new DatabaseUnavailableException());

    try {
      await request(server)
        .post('/api/chat')
        .send({ sessionId: randomUUID(), message: 'Hola' })
        .expect(503)
        .expect(({ body }: { body: unknown }) => {
          expect(body).toEqual(
            expect.objectContaining({
              message:
                'No puedo consultar la información del negocio en este momento. Inténtalo nuevamente.',
            }),
          );
          expect(body).not.toHaveProperty('failureCode');
        });

      expect(generate).not.toHaveBeenCalled();
    } finally {
      findBySession.mockRestore();
    }
  });
});
