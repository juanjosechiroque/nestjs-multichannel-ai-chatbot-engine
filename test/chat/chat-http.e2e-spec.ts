import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { ServiceUnavailableException, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { AppModule } from '../../src/app.module';
import { configureApplication } from '../../src/app.setup';
import type { GenerateResponseInput } from '../../src/chat/openai.service';
import { OpenAiService } from '../../src/chat/openai.service';
import { PrismaService } from '../../src/database/prisma.service';
import { ProductCategory } from '../../src/generated/prisma/enums';
import { EmbeddingService } from '../../src/rag/embedding.service';
import { EMBEDDING_DIMENSIONS } from '../../src/rag/rag.types';
import { toVectorLiteral } from '../../src/rag/vector.util';

const TEST_ENVIRONMENT = {
  NODE_ENV: 'test',
  PORT: '3000',
  OPENAI_API_KEY: 'e2e-not-a-real-key',
  OPENAI_MODEL: 'e2e-model',
  OPENAI_EMBEDDING_MODEL: 'e2e-embedding-model',
  OPENAI_MAX_OUTPUT_TOKENS: '500',
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
  const generate = jest.fn<Promise<string>, [GenerateResponseInput]>();
  const embed = jest.fn<Promise<number[]>, [string]>();

  beforeAll(async () => {
    for (const key of [...Object.keys(TEST_ENVIRONMENT), 'DATABASE_URL'] as EnvironmentKey[]) {
      originalEnvironment.set(key, process.env[key]);
    }

    Object.assign(process.env, TEST_ENVIRONMENT);

    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('chatbot_e2e')
      .withUsername('chatbot')
      .withPassword('chatbot')
      .start();

    process.env.DATABASE_URL = container.getConnectionUri();
    await applyMigrations(container.getConnectionUri());

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
    server = app.getHttpServer() as Server;
  });

  beforeEach(async () => {
    generate.mockReset().mockResolvedValue('Respuesta de prueba');
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

  it('persists a complete HTTP chat exchange in PostgreSQL', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    const chatResponse = await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Cuál es su horario?' })
      .expect(201);

    expect(chatResponse.body as ChatResponse).toEqual({ reply: 'Respuesta de prueba' });
    expect(embed).toHaveBeenCalledWith('¿Cuál es su horario?');
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: '¿Cuál es su horario?',
        businessContext: JSON.stringify({ retrievalStatus: 'no_results', knowledge: [] }),
        history: [],
      }),
    );

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { channel_sessionId: { channel: 'web', sessionId } },
      include: { messages: { orderBy: { id: 'asc' } } },
    });

    expect(conversation.messages).toEqual([
      expect.objectContaining({ role: 'USER', content: '¿Cuál es su horario?' }),
      expect.objectContaining({ role: 'ASSISTANT', content: 'Respuesta de prueba' }),
    ]);
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
    generate.mockResolvedValueOnce('Atendemos todos los días de 7:00 a. m. a 9:00 p. m.');

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿A qué hora atienden?' })
      .expect(201, { reply: 'Atendemos todos los días de 7:00 a. m. a 9:00 p. m.' });

    const generationInput = generate.mock.calls[0]?.[0];
    expect(generationInput).toBeDefined();
    expect(JSON.parse(generationInput?.businessContext ?? '')).toEqual({
      retrievalStatus: 'results_found',
      knowledge: [{ type: 'faq', content }],
    });
    expect(generationInput?.businessContext).not.toContain(sourceId);
    expect(generationInput?.businessContext).not.toContain('similarity');
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('passes the persisted first exchange as history on the second message', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate
      .mockResolvedValueOnce('Tenemos bebidas calientes.')
      .mockResolvedValueOnce('El americano.');

    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Qué bebidas calientes tienen?' })
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send({ sessionId, message: '¿Y cuál es la más barata?' })
      .expect(201, { reply: 'El americano.' });

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

  it('returns a controlled 503 when the generation provider fails', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate.mockRejectedValueOnce(
      new ServiceUnavailableException(
        'El asistente no está disponible en este momento. Inténtalo nuevamente.',
      ),
    );

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
      });

    await expect(prisma.conversationMessage.count()).resolves.toBe(0);
  });
});
