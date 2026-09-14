import { createHmac, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
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
import type { DocumentChatContent } from '../../src/chat/chat.types';
import { CatalogSearchTool } from '../../src/chat/tools/catalog-search.tool';
import type { CatalogSearchArguments } from '../../src/chat/tools/catalog-search.tool';
import type { ToolInvocationContext } from '../../src/chat/tools/chat-tool';
import { KnowledgeSearchTool } from '../../src/chat/tools/knowledge-search.tool';
import { ManageOrderTool } from '../../src/chat/tools/manage-order.tool';
import { MenuDocumentTool } from '../../src/chat/tools/menu-document.tool';
import type {
  OrderCustomerDetailsArguments,
  OrderToolArguments,
} from '../../src/chat/tools/order.tool';
import { PromotionSearchTool } from '../../src/chat/tools/promotion-search.tool';
import type { PromotionSearchArguments } from '../../src/chat/tools/promotion-search.tool';
import { SetOrderCustomerTool } from '../../src/chat/tools/set-order-customer.tool';
import {
  WHATSAPP_PROVIDER,
  type SendWhatsAppTextInput,
  type SendWhatsAppTextResult,
} from '../../src/channels/whatsapp/providers/whatsapp-provider';
import { PrismaService } from '../../src/database/prisma.service';
import {
  ConversationTurnStatus,
  ProductCategory,
  WhatsAppOutboundStatus,
} from '../../src/generated/prisma/enums';
import { OrderAction, OrderStatus } from '../../src/order/order.types';
import { EmbeddingService } from '../../src/rag/embedding.service';
import { EMBEDDING_DIMENSIONS } from '../../src/rag/rag.types';
import { toVectorLiteral } from '../../src/rag/vector.util';
import { applyMigrations, assertDisposableTestDatabase } from '../support/test-database';

const TEST_ENVIRONMENT = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4173',
  OPENAI_API_KEY: 'e2e-not-a-real-key',
  OPENAI_MODEL: 'e2e-model',
  OPENAI_EMBEDDING_MODEL: 'e2e-embedding-model',
  OPENAI_MAX_OUTPUT_TOKENS: '500',
  OPENAI_GENERATION_TIMEOUT_MS: '20000',
  OPENAI_GENERATION_MAX_RETRIES: '1',
  OPENAI_EMBEDDING_TIMEOUT_MS: '8000',
  OPENAI_EMBEDDING_MAX_RETRIES: '1',
  RAG_MIN_SIMILARITY: '0.5',
  RATE_LIMIT_CONVERSATIONS_PER_HOUR: '100',
  RATE_LIMIT_MESSAGES_PER_MINUTE: '100',
  WHATSAPP_VERIFY_TOKEN: 'whatsapp-e2e-verify-token-32-chars',
  WHATSAPP_APP_SECRET: 'whatsapp-e2e-app-secret-32-chars',
  WHATSAPP_ACCESS_TOKEN: 'whatsapp-e2e-access-token-at-least-20-chars',
  WHATSAPP_GRAPH_API_VERSION: 'v25.0',
  BUSINESS_NAME: 'Café Nube',
  BUSINESS_TIME_ZONE: 'America/Lima',
} as const;

type EnvironmentKey = keyof typeof TEST_ENVIRONMENT | 'DATABASE_URL';

interface ConversationResponse {
  sessionId: string;
}

interface ChatResponse {
  reply: string;
  content?: Array<{
    type: string;
    title: string;
    url: string;
    mimeType: string;
  }>;
}

function chatMessage(sessionId: string, message: string, messageId = randomUUID()) {
  return { sessionId, messageId, message };
}

interface CatalogItemResponse {
  slug: string;
  active: boolean;
  availableForOrdering?: boolean;
}

interface OpenApiDocumentResponse {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

function deterministicEmbedding(): number[] {
  const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  embedding[0] = 1;
  return embedding;
}

describe('HTTP conversation flow', () => {
  let app: INestApplication;
  let container: StartedPostgreSqlContainer;
  let prisma: PrismaService;
  let server: Server;
  const originalEnvironment = new Map<EnvironmentKey, string | undefined>();
  const generate = jest.fn<Promise<GenerateResponseResult>, [GenerateResponseInput]>();
  const embed = jest.fn<Promise<number[]>, [string]>();
  const sendWhatsAppText = jest.fn<Promise<SendWhatsAppTextResult>, [SendWhatsAppTextInput]>();
  let catalogTool: CatalogSearchTool;
  let knowledgeTool: KnowledgeSearchTool;
  let promotionTool: PromotionSearchTool;
  let menuTool: MenuDocumentTool;
  let manageOrderTool: ManageOrderTool;
  let setOrderCustomerTool: SetOrderCustomerTool;

  function toolCtx(input: GenerateResponseInput): ToolInvocationContext {
    return {
      requestContext: input.context,
      conversationId: input.conversationId,
      orderContext: input.orderContext,
      message: input.message,
      ...(input.knowledgeQueryOverride ? { argumentOverride: input.knowledgeQueryOverride } : {}),
    };
  }

  function toolBag(input: GenerateResponseInput) {
    return {
      searchCatalog: (filters: CatalogSearchArguments) =>
        catalogTool.execute(filters, toolCtx(input)),
      searchKnowledge: (query: string) => knowledgeTool.execute({ query }, toolCtx(input)),
      searchPromotions: (filters: PromotionSearchArguments) =>
        promotionTool.execute(filters, toolCtx(input)),
      getMenuDocument: () => menuTool.execute(undefined, toolCtx(input)),
      manageOrder: (args: OrderToolArguments) => manageOrderTool.execute(args, toolCtx(input)),
      setOrderCustomer: (details: OrderCustomerDetailsArguments) =>
        setOrderCustomerTool.execute(details, toolCtx(input)),
    };
  }

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
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue({ sendText: sendWhatsAppText })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureApplication(app, {
      corsAllowedOrigins: app.get(ConfigService).getOrThrow<string[]>('CORS_ALLOWED_ORIGINS'),
    });
    await app.init();
    prisma = app.get(PrismaService);
    const configuredDatabaseUrl = app.get(ConfigService).getOrThrow<string>('DATABASE_URL');

    if (configuredDatabaseUrl !== container.getConnectionUri()) {
      throw new Error('NestJS is not configured with the disposable E2E database URL');
    }

    await assertDisposableTestDatabase(prisma, databaseName);

    catalogTool = app.get(CatalogSearchTool);
    knowledgeTool = app.get(KnowledgeSearchTool);
    promotionTool = app.get(PromotionSearchTool);
    menuTool = app.get(MenuDocumentTool);
    manageOrderTool = app.get(ManageOrderTool);
    setOrderCustomerTool = app.get(SetOrderCustomerTool);

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
    sendWhatsAppText.mockReset().mockResolvedValue({ providerMessageId: 'wamid.e2e-default' });
    await prisma.whatsAppOutboundMessage.deleteMany();
    await prisma.whatsAppWebhookMessage.deleteMany();
    await prisma.order.deleteMany();
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

  it('returns the exact challenge for a valid WhatsApp webhook verification', async () => {
    await request(server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        'hub.challenge': '123456789',
      })
      .expect(200, '123456789');
  });

  it('accepts the redundant underscore aliases sent by the Meta developer dashboard', async () => {
    await request(server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        'hub.challenge': '123456789',
        hub_mode: 'subscribe',
        hub_verify_token: TEST_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        hub_challenge: '123456789',
      })
      .expect(200, '123456789');
  });

  it('acknowledges a WhatsApp notification with a valid Meta signature', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const signature = `sha256=${createHmac('sha256', TEST_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(payload)
      .digest('hex')}`;

    await request(server)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(200, '');
    expect(sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('routes a WhatsApp text through the shared chatbot and suppresses a duplicate delivery', async () => {
    sendWhatsAppText.mockResolvedValueOnce({ providerMessageId: 'wamid.outbound-e2e' });
    await prisma.product.create({
      data: {
        slug: 'espresso-e2e',
        name: 'Espresso',
        description: 'Café intenso de prueba.',
        price: 8,
        currency: 'PEN',
        category: ProductCategory.HOT_DRINK,
        active: true,
        availableForOrdering: true,
      },
    });
    generate.mockImplementationOnce(async (input) => {
      expect(input.message).toBe('¿Qué productos tienen?');
      expect(input.context.channel).toBe('whatsapp');
      const catalog = JSON.parse(
        await toolBag(input).searchCatalog({
          productName: null,
          category: null,
          maxPrice: null,
          maxPriceExclusive: false,
          dietaryTags: [],
          excludedAllergens: [],
          containsCoffee: null,
          decaffeinated: null,
          caffeineFree: null,
        }),
      ) as { products: Array<{ name: string; price: string }> };
      expect(catalog.products).toEqual([expect.objectContaining({ name: 'Espresso', price: '8' })]);
      return {
        answer: 'Tenemos Espresso y otras bebidas calientes.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1220572421149962' },
                contacts: [
                  {
                    wa_id: '51999999999',
                    profile: { name: 'Ana Cliente' },
                  },
                ],
                messages: [
                  {
                    id: 'wamid.e2e-duplicate',
                    from: '51999999999',
                    timestamp: '1788195600',
                    type: 'text',
                    text: { body: '¿Qué productos tienen?' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', TEST_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(payload)
      .digest('hex')}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(server)
        .post('/api/webhook/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200, '');
    }

    await expect(
      prisma.whatsAppWebhookMessage.count({
        where: { wabaId: 'waba-e2e', messageId: 'wamid.e2e-duplicate' },
      }),
    ).resolves.toBe(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(sendWhatsAppText).toHaveBeenCalledWith({
      phoneNumberId: '1220572421149962',
      recipientPhoneNumber: '51999999999',
      text: 'Tenemos Espresso y otras bebidas calientes.',
    });
    const acceptedOutbound = await prisma.whatsAppOutboundMessage.findUniqueOrThrow({
      where: { providerMessageId: 'wamid.outbound-e2e' },
    });
    expect(acceptedOutbound.wabaId).toBe('waba-e2e');
    expect(acceptedOutbound.inboundMessageId).toBe('wamid.e2e-duplicate');
    expect(acceptedOutbound.status).toBe(WhatsAppOutboundStatus.ACCEPTED);
    expect(acceptedOutbound.attemptCount).toBe(1);
    expect(acceptedOutbound.providerAcceptedAt).toBeInstanceOf(Date);

    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.outbound-e2e',
                    status: 'delivered',
                    timestamp: '1788195605',
                  },
                  {
                    id: 'wamid.outbound-e2e',
                    status: 'sent',
                    timestamp: '1788195604',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const statusSignature = `sha256=${createHmac('sha256', TEST_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(statusPayload)
      .digest('hex')}`;

    await request(server)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', statusSignature)
      .send(statusPayload)
      .expect(200, '');

    await expect(
      prisma.whatsAppOutboundMessage.findUniqueOrThrow({
        where: { providerMessageId: 'wamid.outbound-e2e' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: WhatsAppOutboundStatus.DELIVERED,
        deliveredAt: new Date(1_788_195_605_000),
        sentAt: null,
      }),
    );
    await expect(prisma.conversation.count({ where: { channel: 'whatsapp' } })).resolves.toBe(1);
    await expect(
      prisma.conversationMessage.count({
        where: { conversation: { channel: 'whatsapp' } },
      }),
    ).resolves.toBe(2);
  });

  it('rejects an invalid WhatsApp webhook verification token', async () => {
    await request(server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'invalid-token',
        'hub.challenge': '123456789',
      })
      .expect(403);
  });

  it('validates required WhatsApp webhook verification parameters', async () => {
    await request(server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': TEST_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
      })
      .expect(400);
  });

  it('applies global security headers without exposing the Express signature', async () => {
    const response = await request(server).get('/api/health').expect(200);

    expect(response.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(response.get('X-Powered-By')).toBeUndefined();
  });

  it('allows the configured browser origin and omits CORS permission for another origin', async () => {
    const allowedResponse = await request(server)
      .get('/api/health')
      .set('Origin', 'http://localhost:4173')
      .expect(200);
    const disallowedResponse = await request(server)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200);

    expect(allowedResponse.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(disallowedResponse.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('answers preflight only with permission for the configured browser origin', async () => {
    const allowedResponse = await request(server)
      .options('/api/chat')
      .set('Origin', 'http://localhost:4173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    const disallowedResponse = await request(server)
      .options('/api/chat')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(allowedResponse.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(allowedResponse.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(allowedResponse.get('Access-Control-Allow-Headers')).toBe('content-type');
    expect(disallowedResponse.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('publishes the documented HTTP contract as OpenAPI JSON', async () => {
    const swaggerResponse = await request(server)
      .get('/api/docs')
      .expect('Content-Type', /html/)
      .expect(200);
    expect(swaggerResponse.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    const response = await request(server).get('/api/docs-json').expect(200);
    const document = response.body as OpenApiDocumentResponse;

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toEqual(
      expect.objectContaining({
        title: 'Multichannel AI Chatbot Engine API',
        version: '0.1.0',
      }),
    );
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/health',
        '/api/conversations',
        '/api/chat',
        '/api/products',
        '/api/promotions',
        '/api/faqs',
        '/api/menu',
      ]),
    );
    expect(document.paths['/api/chat']?.post).toEqual(
      expect.objectContaining({
        summary: 'Send an idempotent message to the web chatbot',
        requestBody: expect.any(Object) as object,
        responses: expect.objectContaining({
          '201': expect.any(Object) as object,
          '400': expect.any(Object) as object,
          '404': expect.any(Object) as object,
          '409': expect.any(Object) as object,
          '429': expect.any(Object) as object,
          '503': expect.any(Object) as object,
        }) as object,
      }),
    );
    expect(document.components?.schemas).toEqual(
      expect.objectContaining({
        WebChatMessageDto: expect.any(Object) as object,
        WebChatResponseDto: expect.any(Object) as object,
        ProductResponseDto: expect.any(Object) as object,
        ApiErrorResponseDto: expect.any(Object) as object,
      }),
    );
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
          availableForOrdering: false,
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
    expect(products.map((product) => product.availableForOrdering)).toEqual([false, true]);
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
      .send(chatMessage(sessionId, 'Hola'))
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
    expect(generationInput?.conversationId).toEqual(expect.any(String));
    expect(generationInput?.toolChoice).toBe('auto');

    const conversation = await prisma.conversation.findUniqueOrThrow({
      where: { channel_sessionId: { channel: 'web', sessionId } },
      include: { messages: { orderBy: { id: 'asc' } } },
    });

    expect(conversation.messages).toEqual([
      expect.objectContaining({ role: 'USER', content: 'Hola' }),
      expect.objectContaining({ role: 'ASSISTANT', content: 'Respuesta de prueba' }),
    ]);
  });

  it('replays a completed message without calling OpenAI or saving memory twice', async () => {
    generate.mockResolvedValueOnce({
      answer: 'Respuesta idempotente',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();
    const payload = chatMessage(sessionId, 'Hola', messageId);

    await request(server).post('/api/chat').send(payload).expect(201, {
      reply: 'Respuesta idempotente',
    });
    await request(server).post('/api/chat').send(payload).expect(201, {
      reply: 'Respuesta idempotente',
    });

    expect(generate).toHaveBeenCalledTimes(1);
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
    await expect(prisma.conversationTurn.count()).resolves.toBe(1);
    await expect(prisma.conversationTurn.findFirstOrThrow()).resolves.toEqual(
      expect.objectContaining({
        messageId,
        status: ConversationTurnStatus.COMPLETED,
        response: { reply: 'Respuesta idempotente' },
      }),
    );
  });

  it('rejects a messageId reused with different text', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Hola', messageId))
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero ver la carta', messageId))
      .expect(409)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(
          expect.objectContaining({
            message: 'El messageId ya fue utilizado con un mensaje diferente.',
          }),
        );
      });

    expect(generate).toHaveBeenCalledTimes(1);
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('rejects a concurrent retry while the original message is still processing', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();
    const payload = chatMessage(sessionId, 'Hola', messageId);
    let signalGenerationStarted: () => void = () => undefined;
    let finishGeneration: (result: GenerateResponseResult) => void = () => undefined;
    const generationStarted = new Promise<void>((resolve) => {
      signalGenerationStarted = resolve;
    });
    const pendingGeneration = new Promise<GenerateResponseResult>((resolve) => {
      finishGeneration = resolve;
    });
    generate.mockImplementationOnce(() => {
      signalGenerationStarted();
      return pendingGeneration;
    });

    const firstRequest = request(server).post('/api/chat').send(payload).then();
    await generationStarted;
    await request(server)
      .post('/api/chat')
      .send(payload)
      .expect(409)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(
          expect.objectContaining({
            message:
              'Este mensaje todavía se está procesando. Inténtalo nuevamente en unos segundos.',
          }),
        );
      });

    finishGeneration({
      answer: 'Respuesta terminada',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    const firstResponse = await firstRequest;

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body).toEqual({ reply: 'Respuesta terminada' });
    expect(generate).toHaveBeenCalledTimes(1);
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('does not reprocess a failed message with the same messageId', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();
    const payload = chatMessage(sessionId, 'Hola', messageId);
    generate.mockRejectedValueOnce(new OpenAiRequestFailedException());

    await request(server).post('/api/chat').send(payload).expect(503);
    await request(server)
      .post('/api/chat')
      .send(payload)
      .expect(409)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(
          expect.objectContaining({
            message: 'Este mensaje ya terminó con error. Reintenta con un messageId nuevo.',
          }),
        );
      });

    expect(generate).toHaveBeenCalledTimes(1);
    await expect(prisma.conversationMessage.count()).resolves.toBe(0);
    await expect(prisma.conversationTurn.findFirstOrThrow()).resolves.toEqual(
      expect.objectContaining({
        messageId,
        status: ConversationTurnStatus.FAILED,
      }),
    );
  });

  it('resolves current promotions through the structured PostgreSQL tool', async () => {
    const promotionId = randomUUID();
    await prisma.promotion.create({
      data: {
        id: promotionId,
        slug: 'promocion-siempre-vigente',
        name: 'Promoción siempre vigente',
        description: 'Promoción de prueba disponible todos los días y durante todo el día.',
        startsAt: new Date('2020-01-01T00:00:00.000Z'),
        endsAt: null,
        active: true,
        metadata: {},
      },
    });
    generate.mockImplementationOnce(async (input) => {
      const promotionOutput = JSON.parse(
        await toolBag(input).searchPromotions({ scope: 'CURRENT', promotionName: null }),
      ) as {
        currentPromotions: Array<{ sourceId: string; sourceKey: string; currentlyValid: boolean }>;
      };

      expect(promotionOutput.currentPromotions).toEqual([
        expect.objectContaining({
          sourceId: promotionId,
          sourceKey: 'promocion-siempre-vigente',
          currentlyValid: true,
        }),
      ]);
      return {
        answer: 'Ahora está vigente la promoción siempre vigente.',
        usedSources: [
          {
            sourceId: promotionId,
            sourceKey: 'promocion-siempre-vigente',
            sourceType: 'promotion',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_promotions'],
      };
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué promociones están vigentes ahora?'))
      .expect(201, { reply: 'Ahora está vigente la promoción siempre vigente.' });
  });

  it('keeps supported strong emphasis while removing unsupported inline-code Markdown', async () => {
    generate.mockResolvedValueOnce({
      answer: '**Pedido confirmado:** total `S/ 28`.',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Confirma mi pedido'))
      .expect(201, { reply: '**Pedido confirmado:** total S/ 28.' });

    await expect(
      prisma.conversation.findUniqueOrThrow({
        where: { channel_sessionId: { channel: 'web', sessionId } },
        include: { messages: { orderBy: { id: 'asc' } } },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        messages: [
          expect.objectContaining({ role: 'USER', content: 'Confirma mi pedido' }),
          expect.objectContaining({
            role: 'ASSISTANT',
            content: '**Pedido confirmado:** total `S/ 28`.',
          }),
        ],
      }),
    );
  });

  it('returns the menu as structured document content and serves its PDF', async () => {
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate.mockImplementationOnce(async (input) => {
      const toolOutput: unknown = JSON.parse(await toolBag(input).getMenuDocument());
      const document = (toolOutput as { document: DocumentChatContent }).document;

      return {
        answer: 'Aquí tienes nuestra carta.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['get_menu_document'],
        content: [document],
      };
    });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero ver la carta'))
      .expect(201, {
        reply: 'Aquí tienes nuestra carta.',
        content: [
          {
            type: 'document',
            title: 'Carta de Café Nube',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      });

    const menuResponse = await request(server).get('/api/menu').expect(200);
    expect(menuResponse.headers['content-type']).toContain('application/pdf');
    expect(menuResponse.headers['content-disposition']).toBe('inline; filename="menu.pdf"');
    expect(Buffer.isBuffer(menuResponse.body)).toBe(true);
    expect((menuResponse.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('creates a multi-product order through the same HTTP chat endpoint', async () => {
    const cappuccinoId = randomUUID();
    const croissantId = randomUUID();
    await prisma.product.createMany({
      data: [
        {
          id: cappuccinoId,
          slug: 'cappuccino-nube',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
          active: true,
        },
        {
          id: croissantId,
          slug: 'croissant-mantequilla',
          name: 'Croissant de mantequilla',
          description: 'Horneado durante la mañana.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
        },
      ],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    generate.mockImplementationOnce(async (input) => {
      toolOutput = await toolBag(input).manageOrder({
        action: OrderAction.ADD_ITEMS,
        items: [
          { productName: 'cappuccino', quantity: 2 },
          { productName: 'croissant', quantity: 1 },
        ],
      });
      return {
        answer: 'Agregué 2 Cappuccino Nube y 1 Croissant de mantequilla. Total: S/ 35.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['manage_order'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega dos cappuccinos y un croissant.'))
      .expect(201, {
        reply: 'Agregué 2 Cappuccino Nube y 1 Croissant de mantequilla. Total: S/ 35.',
      });

    const orderToolResult: unknown = JSON.parse(toolOutput ?? '');
    expect(orderToolResult).toEqual(
      expect.objectContaining({
        orderOperationStatus: 'completed',
        action: 'ADD_ITEMS',
        issues: [],
      }),
    );
    const typedOrderToolResult = orderToolResult as {
      order: { items: unknown[] };
      workflow: {
        allowedActions: string[];
        canConfirm: boolean;
        nextAction: string;
        missingCustomerFields: string[];
      };
    };
    expect(typedOrderToolResult.workflow).toEqual({
      allowedActions: ['ADD_ITEMS', 'REMOVE_ITEMS', 'REVIEW', 'CANCEL'],
      canConfirm: false,
      nextAction: 'REVIEW',
      missingCustomerFields: ['customerName', 'customerPhone'],
    });
    const completedOrder = typedOrderToolResult.order;
    expect(completedOrder).toEqual(expect.objectContaining({ total: 35, currency: 'PEN' }));
    expect(completedOrder.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          productName: 'Cappuccino Nube',
          unitPrice: 13,
          quantity: 2,
          lineTotal: 26,
        }),
        expect.objectContaining({
          productName: 'Croissant de mantequilla',
          unitPrice: 9,
          quantity: 1,
          lineTotal: 9,
        }),
      ]),
    );
    const persistedOrder = await prisma.order.findFirstOrThrow({
      include: { items: true },
    });
    expect(persistedOrder.total.toNumber()).toBe(35);
    expect(persistedOrder.items).toHaveLength(2);
  });

  it('uses the persisted order workflow to confirm an explicit approval', async () => {
    await prisma.product.create({
      data: {
        id: randomUUID(),
        slug: 'latte',
        name: 'Latte',
        description: 'Espresso con leche vaporizada.',
        price: '13.00',
        category: ProductCategory.HOT_DRINK,
        active: true,
      },
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let publicOrderNumber: number | undefined;

    generate
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext).toEqual({
          activeOrder: null,
          confirmationReplayAvailable: false,
        });
        await toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 3 }],
        });
        return {
          answer: 'Agregué 3 lattes. ¿Deseas agregar algo más o revisar tu pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.workflow).toEqual({
          allowedActions: [
            OrderAction.ADD_ITEMS,
            OrderAction.REMOVE_ITEMS,
            OrderAction.REVIEW,
            OrderAction.CANCEL,
          ],
          canConfirm: false,
          nextAction: OrderAction.REVIEW,
          missingCustomerFields: ['customerName', 'customerPhone'],
        });
        await toolBag(input).manageOrder({ action: OrderAction.REVIEW, items: [] });
        return {
          answer: 'Llevas 3 lattes por S/ 39. ¿Cuál es tu nombre y número de celular?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('Soy Ana Pérez, mi celular es +51 987 654 321.');
        expect(input.orderContext.activeOrder?.workflow).toEqual({
          allowedActions: [OrderAction.ADD_ITEMS, OrderAction.REMOVE_ITEMS, OrderAction.CANCEL],
          canConfirm: false,
          nextAction: null,
          missingCustomerFields: ['customerName', 'customerPhone'],
        });
        await toolBag(input).setOrderCustomer({
          customerName: 'Ana Pérez',
          customerPhone: '+51 987 654 321',
        });
        return {
          answer: 'Ana, llevas 3 lattes por S/ 39. ¿Deseas confirmar el pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['set_order_customer'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('sí');
        expect(input.orderContext.activeOrder?.workflow).toEqual({
          allowedActions: [
            OrderAction.ADD_ITEMS,
            OrderAction.REMOVE_ITEMS,
            OrderAction.CONFIRM,
            OrderAction.CANCEL,
          ],
          canConfirm: true,
          nextAction: OrderAction.CONFIRM,
          missingCustomerFields: [],
        });
        const result = JSON.parse(
          await toolBag(input).manageOrder({ action: OrderAction.CONFIRM, items: [] }),
        ) as { order: { orderNumber: number } };
        publicOrderNumber = result.order.orderNumber;
        return {
          answer: `Tu pedido #${publicOrderNumber} fue confirmado. Total: S/ 39.`,
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.message).toBe('sí, confirma de nuevo');
        expect(input.orderContext.activeOrder).toBeNull();
        expect(input.orderContext.confirmationReplayAvailable).toBe(true);
        const result = JSON.parse(
          await toolBag(input).manageOrder({ action: OrderAction.CONFIRM, items: [] }),
        ) as { idempotentReplay: boolean };
        expect(result.idempotentReplay).toBe(true);
        return {
          answer: 'Ese mismo pedido ya estaba confirmado; no se creó otro.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero tres lattes.'))
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Revisar pedido.'))
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Soy Ana Pérez, mi celular es +51 987 654 321.'))
      .expect(201, { reply: 'Ana, llevas 3 lattes por S/ 39. Deseas confirmar el pedido?' });
    await request(server).post('/api/chat').send(chatMessage(sessionId, 'sí')).expect(201);

    const firstConfirmation = await prisma.order.findFirstOrThrow();
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'sí, confirma de nuevo'))
      .expect(201, { reply: 'Ese mismo pedido ya estaba confirmado; no se creó otro.' });

    const confirmedOrder = await prisma.order.findFirstOrThrow();
    expect(confirmedOrder.status).toBe(OrderStatus.CONFIRMED);
    expect(confirmedOrder.total.toNumber()).toBe(39);
    expect(confirmedOrder.orderNumber).toBe(publicOrderNumber);
    expect(confirmedOrder.customerName).toBe('Ana Pérez');
    expect(confirmedOrder.customerPhone).toBe('+51987654321');
    expect(confirmedOrder.id).toBe(firstConfirmation.id);
    expect(confirmedOrder.updatedAt).toEqual(firstConfirmation.updatedAt);
    await expect(prisma.order.count()).resolves.toBe(1);
  });

  it('cancels an active order without deleting its audit trail', async () => {
    await prisma.product.create({
      data: {
        slug: 'cancel-latte',
        name: 'Latte',
        description: 'Espresso con leche vaporizada.',
        price: '13.00',
        category: ProductCategory.HOT_DRINK,
      },
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate
      .mockImplementationOnce(async (input) => {
        await toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 1 }],
        });
        return {
          answer: 'Agregué un latte. ¿Deseas algo más o revisar tu pedido?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await toolBag(input).manageOrder({ action: OrderAction.CANCEL, items: [] });
        return {
          answer: 'Pedido cancelado.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega un latte'))
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Cancela el pedido'))
      .expect(201, { reply: 'Pedido cancelado.' });

    const cancelledOrder = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(cancelledOrder.status).toBe(OrderStatus.CANCELLED);
    expect(cancelledOrder.items).toHaveLength(1);
    expect(cancelledOrder.total.toNumber()).toBe(13);
  });

  it('returns to product selection when the customer modifies a reviewed order', async () => {
    await prisma.product.create({
      data: {
        slug: 'modify-cappuccino',
        name: 'Cappuccino',
        description: 'Espresso con leche vaporizada.',
        price: '12.00',
        category: ProductCategory.HOT_DRINK,
      },
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate
      .mockImplementationOnce(async (input) => {
        await toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Cappuccino', quantity: 2 }],
        });
        return {
          answer: 'Agregué dos cappuccinos.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await toolBag(input).manageOrder({ action: OrderAction.REVIEW, items: [] });
        return {
          answer: 'Tu pedido contiene dos cappuccinos. Total: S/ 24. ¿Deseas cambiar algo?',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.workflow.canConfirm).toBe(false);
        expect(input.orderContext.activeOrder?.workflow.missingCustomerFields).toEqual([
          'customerName',
          'customerPhone',
        ]);
        await toolBag(input).manageOrder({
          action: OrderAction.REMOVE_ITEMS,
          items: [{ productName: 'Cappuccino', quantity: 1 }],
        });
        return {
          answer: 'Quité un cappuccino. Ahora el total es S/ 12.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    for (const message of ['Quiero dos cappuccinos', 'Revisa mi pedido', 'Mejor quita uno']) {
      await request(server).post('/api/chat').send(chatMessage(sessionId, message)).expect(201);
    }

    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.status).toBe(OrderStatus.SELECTING_PRODUCTS);
    expect(order.total.toNumber()).toBe(12);
    expect(order.items).toEqual([expect.objectContaining({ quantity: 1 })]);
  });

  it('preserves an existing draft when a later OpenAI request fails', async () => {
    await prisma.product.create({
      data: {
        slug: 'resilient-brownie',
        name: 'Brownie de cacao',
        description: 'Brownie húmedo con cacao peruano.',
        price: '11.00',
        category: ProductCategory.FOOD,
      },
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate.mockImplementationOnce(async (input) => {
      await toolBag(input).manageOrder({
        action: OrderAction.ADD_ITEMS,
        items: [{ productName: 'Brownie de cacao', quantity: 1 }],
      });
      return {
        answer: 'Agregué un brownie.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['manage_order'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Agrega un brownie'))
      .expect(201);
    generate.mockRejectedValueOnce(new OpenAiRequestFailedException());
    await request(server).post('/api/chat').send(chatMessage(sessionId, 'Agrega otro')).expect(503);

    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.status).toBe(OrderStatus.SELECTING_PRODUCTS);
    expect(order.total.toNumber()).toBe(11);
    expect(order.items).toEqual([expect.objectContaining({ quantity: 1 })]);
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('keeps the order context while answering an informational message between changes', async () => {
    await prisma.product.createMany({
      data: [
        {
          slug: 'context-latte',
          name: 'Latte',
          description: 'Espresso con leche.',
          price: '13.00',
          category: ProductCategory.HOT_DRINK,
        },
        {
          slug: 'context-brownie',
          name: 'Brownie de cacao',
          description: 'Brownie de cacao peruano.',
          price: '11.00',
          category: ProductCategory.FOOD,
        },
      ],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    generate
      .mockImplementationOnce(async (input) => {
        await toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Latte', quantity: 1 }],
        });
        return {
          answer: 'Agregué un latte.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      })
      .mockImplementationOnce((input) => {
        expect(input.orderContext.activeOrder?.order.total).toBe(13);
        return Promise.resolve({
          answer: 'Sí, tenemos brownies.',
          usedSources: [],
          llmCalls: 1,
          usedTools: [],
        });
      })
      .mockImplementationOnce(async (input) => {
        expect(input.orderContext.activeOrder?.order.total).toBe(13);
        await toolBag(input).manageOrder({
          action: OrderAction.ADD_ITEMS,
          items: [{ productName: 'Brownie de cacao', quantity: 1 }],
        });
        return {
          answer: 'También agregué un brownie.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['manage_order'],
        };
      });

    for (const message of ['Agrega un latte', '¿Tienen brownies?', 'Agrega uno']) {
      await request(server).post('/api/chat').send(chatMessage(sessionId, message)).expect(201);
    }

    const order = await prisma.order.findFirstOrThrow({ include: { items: true } });
    expect(order.total.toNumber()).toBe(24);
    expect(order.items).toHaveLength(2);
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
      toolOutput = await toolBag(input).searchCatalog({
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: [],
        excludedAllergens: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
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
      .send(chatMessage(sessionId, '¿Cuánto cuesta el cappuccino?'))
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
          availableForOrdering: true,
          allergens: [],
          dietaryTags: [],
          containsCoffee: null,
          decaffeinated: null,
          caffeineFree: null,
        },
      ],
    });
    expect(embed).not.toHaveBeenCalled();
    await expect(prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('keeps less-than price searches exclusive in PostgreSQL', async () => {
    const underLimitId = randomUUID();
    await prisma.product.createMany({
      data: [
        {
          id: underLimitId,
          slug: 'producto-catorce',
          name: 'Producto de catorce soles',
          description: 'Debe aparecer.',
          price: '14.00',
          category: ProductCategory.FOOD,
          active: true,
        },
        {
          id: randomUUID(),
          slug: 'producto-quince',
          name: 'Producto de quince soles',
          description: 'No debe aparecer en una búsqueda menor que quince.',
          price: '15.00',
          category: ProductCategory.FOOD,
          active: true,
        },
      ],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    generate.mockImplementationOnce(async (input) => {
      toolOutput = await toolBag(input).searchCatalog({
        productName: null,
        category: ProductCategory.FOOD,
        maxPrice: 15,
        maxPriceExclusive: true,
        dietaryTags: [],
        excludedAllergens: [],
        containsCoffee: null,
        decaffeinated: null,
        caffeineFree: null,
      });
      return {
        answer: 'Tenemos una opción por menos de S/ 15.',
        usedSources: [
          {
            sourceId: underLimitId,
            sourceKey: 'producto-catorce',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué tienen por menos de S/ 15?'))
      .expect(201, { reply: 'Tenemos una opción por menos de S/ 15.' });

    const parsedOutput = JSON.parse(toolOutput ?? '') as {
      products: Array<{ sourceKey: string }>;
    };
    expect(parsedOutput.products.map((product) => product.sourceKey)).toEqual(['producto-catorce']);
  });

  it('applies dietary, allergen, and coffee preferences in PostgreSQL', async () => {
    const veganCookieId = randomUUID();
    await prisma.product.createMany({
      data: [
        {
          id: veganCookieId,
          slug: 'galleta-vegana',
          name: 'Galleta vegana',
          description: 'Galleta de avena y cacao.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN'],
            dietaryTags: ['VEGAN', 'VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: false,
          },
        },
        {
          id: randomUUID(),
          slug: 'croissant-vegetariano',
          name: 'Croissant vegetariano',
          description: 'Croissant con mantequilla.',
          price: '9.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN', 'MILK'],
            dietaryTags: ['VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: true,
          },
        },
        {
          id: randomUUID(),
          slug: 'brownie-con-leche',
          name: 'Brownie con leche',
          description: 'Brownie de cacao y leche.',
          price: '8.00',
          category: ProductCategory.FOOD,
          active: true,
          metadata: {
            allergens: ['GLUTEN', 'MILK'],
            dietaryTags: ['VEGAN', 'VEGETARIAN'],
            containsCoffee: false,
            decaffeinated: false,
            caffeineFree: false,
          },
        },
      ],
    });
    const conversationResponse = await request(server).post('/api/conversations').expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    generate.mockImplementationOnce(async (input) => {
      toolOutput = await toolBag(input).searchCatalog({
        productName: null,
        category: ProductCategory.FOOD,
        maxPrice: 10,
        maxPriceExclusive: false,
        dietaryTags: ['VEGAN'],
        excludedAllergens: ['MILK'],
        containsCoffee: false,
        decaffeinated: null,
        caffeineFree: null,
      });
      return {
        answer: 'La Galleta vegana cuesta S/ 9.00.',
        usedSources: [
          {
            sourceId: veganCookieId,
            sourceKey: 'galleta-vegana',
            sourceType: 'product',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero comida vegana sin leche por máximo S/ 10.'))
      .expect(201, { reply: 'La Galleta vegana cuesta S/ 9.00.' });

    expect(JSON.parse(toolOutput ?? '')).toEqual({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: veganCookieId,
          sourceKey: 'galleta-vegana',
          type: 'product',
          name: 'Galleta vegana',
          description: 'Galleta de avena y cacao.',
          price: '9',
          currency: 'PEN',
          category: 'FOOD',
          availableForOrdering: true,
          allergens: ['GLUTEN'],
          dietaryTags: ['VEGAN', 'VEGETARIAN'],
          containsCoffee: false,
          decaffeinated: false,
          caffeineFree: false,
        },
      ],
    });
    expect(embed).not.toHaveBeenCalled();
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
      toolOutput = await toolBag(input).searchKnowledge('horario de atención');
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
      .send(chatMessage(sessionId, '¿A qué hora atienden?'))
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
        await toolBag(input).searchKnowledge('bebidas calientes');
        return {
          answer: 'Tenemos bebidas calientes.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await toolBag(input).searchKnowledge('la bebida caliente más barata');
        return {
          answer: 'El americano.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      });

    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué bebidas calientes tienen?'))
      .expect(201);
    await request(server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Y cuál es la más barata?'))
      .expect(201, { reply: 'El americano.' });

    const secondGenerationInput = generate.mock.calls[1]?.[0];
    expect(embed).toHaveBeenNthCalledWith(
      2,
      'la bebida caliente más barata',
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
      .send(chatMessage(randomUUID(), 'Hola'))
      .expect(404)
      .expect(({ body }: { body: unknown }) => {
        expect(body).toEqual(expect.objectContaining({ message: 'Conversation not found' }));
      });
  });

  it.each([
    [
      'an invalid session UUID',
      { sessionId: 'not-a-uuid', messageId: randomUUID(), message: 'Hola' },
    ],
    ['a missing messageId', { sessionId: randomUUID(), message: 'Hola' }],
    [
      'an invalid message UUID',
      { sessionId: randomUUID(), messageId: 'not-a-uuid', message: 'Hola' },
    ],
    ['an empty message', { sessionId: randomUUID(), messageId: randomUUID(), message: '' }],
    [
      'a message longer than 2000 characters',
      { sessionId: randomUUID(), messageId: randomUUID(), message: 'a'.repeat(2001) },
    ],
    ['a non-string message', { sessionId: randomUUID(), messageId: randomUUID(), message: 123 }],
    [
      'an unexpected property',
      { sessionId: randomUUID(), messageId: randomUUID(), message: 'Hola', internal: true },
    ],
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
      .send(chatMessage(sessionId, 'Hola'))
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
        .send(chatMessage(randomUUID(), 'Hola'))
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
