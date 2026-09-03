import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { configureApplication } from '../../src/app.setup';
import type { GenerateResponseInput, GenerateResponseResult } from '../../src/chat/openai.service';
import { OpenAiService } from '../../src/chat/openai.service';
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
import { EmbeddingService } from '../../src/rag/embedding.service';
import { EMBEDDING_DIMENSIONS } from '../../src/rag/rag.types';
import { assertDisposableTestDatabase } from './test-database';

export const E2E_ENVIRONMENT = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4173',
  OPENAI_API_KEY: 'e2e-not-a-real-key',
  OPENAI_MODEL: 'e2e-model',
  OPENAI_EMBEDDING_MODEL: 'e2e-embedding-model',
  OPENAI_TIMEOUT_MS: '20000',
  OPENAI_MAX_RETRIES: '1',
  RAG_MIN_SIMILARITY: '0.5',
  RATE_LIMIT_CONVERSATIONS_PER_HOUR: '100',
  RATE_LIMIT_MESSAGES_PER_MINUTE: '100',
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_VERIFY_TOKEN: 'whatsapp-e2e-verify-token-32-chars',
  WHATSAPP_APP_SECRET: 'whatsapp-e2e-app-secret-32-chars',
  WHATSAPP_ACCESS_TOKEN: 'whatsapp-e2e-access-token-at-least-20-chars',
  // The business identity is not an env var: AppModule loads it from
  // business/profile.json, exactly as a real deployment does.
} as const;

type EnvironmentKey = keyof typeof E2E_ENVIRONMENT | 'DATABASE_URL';

export interface ChatMessagePayload {
  sessionId: string;
  messageId: string;
  message: string;
}

export function chatMessage(
  sessionId: string,
  message: string,
  messageId: string = randomUUID(),
): ChatMessagePayload {
  return { sessionId, messageId, message };
}

export function deterministicEmbedding(): number[] {
  const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  embedding[0] = 1;
  return embedding;
}

export type GenerateMock = jest.Mock<Promise<GenerateResponseResult>, [GenerateResponseInput]>;
export type EmbedMock = jest.Mock<Promise<number[]>, [string]>;
export type SendWhatsAppTextMock = jest.Mock<
  Promise<SendWhatsAppTextResult>,
  [SendWhatsAppTextInput]
>;

export interface ToolBag {
  searchCatalog(filters: CatalogSearchArguments): Promise<string>;
  searchKnowledge(query: string): Promise<string>;
  searchPromotions(filters: PromotionSearchArguments): Promise<string>;
  getMenuDocument(): Promise<string>;
  manageOrder(args: OrderToolArguments): Promise<string>;
  setOrderCustomer(details: OrderCustomerDetailsArguments): Promise<string>;
}

export class HttpE2EHarness {
  readonly generate: GenerateMock = jest.fn<
    Promise<GenerateResponseResult>,
    [GenerateResponseInput]
  >();
  readonly embed: EmbedMock = jest.fn<Promise<number[]>, [string]>();
  readonly sendWhatsAppText: SendWhatsAppTextMock = jest.fn<
    Promise<SendWhatsAppTextResult>,
    [SendWhatsAppTextInput]
  >();

  private readonly originalEnvironment = new Map<EnvironmentKey, string | undefined>();
  private appInstance?: INestApplication;
  private serverInstance?: Server;
  private prismaInstance?: PrismaService;
  private catalogTool?: CatalogSearchTool;
  private knowledgeTool?: KnowledgeSearchTool;
  private promotionTool?: PromotionSearchTool;
  private menuTool?: MenuDocumentTool;
  private manageOrderTool?: ManageOrderTool;
  private setOrderCustomerTool?: SetOrderCustomerTool;

  get app(): INestApplication {
    if (!this.appInstance) {
      throw new Error('HttpE2EHarness.app read before setupHttpE2E() beforeAll ran');
    }
    return this.appInstance;
  }

  get server(): Server {
    if (!this.serverInstance) {
      throw new Error('HttpE2EHarness.server read before setupHttpE2E() beforeAll ran');
    }
    return this.serverInstance;
  }

  get prisma(): PrismaService {
    if (!this.prismaInstance) {
      throw new Error('HttpE2EHarness.prisma read before setupHttpE2E() beforeAll ran');
    }
    return this.prismaInstance;
  }

  async init(): Promise<void> {
    const databaseUrl = process.env.DATABASE_URL;
    const databaseName = process.env.E2E_DATABASE_NAME;
    if (!databaseUrl || !databaseName) {
      throw new Error(
        'Shared E2E database is not configured; is test/support/e2e-global-setup.ts wired as globalSetup?',
      );
    }

    for (const key of [...Object.keys(E2E_ENVIRONMENT), 'DATABASE_URL'] as EnvironmentKey[]) {
      this.originalEnvironment.set(key, process.env[key]);
    }
    Object.assign(process.env, E2E_ENVIRONMENT);
    process.env.DATABASE_URL = databaseUrl;

    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiService)
      .useValue({ generate: this.generate })
      .overrideProvider(EmbeddingService)
      .useValue({ embed: this.embed })
      .overrideProvider(WHATSAPP_PROVIDER)
      .useValue({ sendText: this.sendWhatsAppText })
      .compile();

    const app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    configureApplication(app, {
      corsAllowedOrigins: app.get(ConfigService).getOrThrow<string[]>('CORS_ALLOWED_ORIGINS'),
    });
    await app.init();

    const prisma = app.get(PrismaService);
    const configuredDatabaseUrl = app.get(ConfigService).getOrThrow<string>('DATABASE_URL');
    if (configuredDatabaseUrl !== databaseUrl) {
      throw new Error('NestJS is not configured with the shared E2E database URL');
    }
    await assertDisposableTestDatabase(prisma, databaseName);

    this.appInstance = app;
    this.prismaInstance = prisma;
    this.serverInstance = app.getHttpServer() as Server;
    this.catalogTool = app.get(CatalogSearchTool);
    this.knowledgeTool = app.get(KnowledgeSearchTool);
    this.promotionTool = app.get(PromotionSearchTool);
    this.menuTool = app.get(MenuDocumentTool);
    this.manageOrderTool = app.get(ManageOrderTool);
    this.setOrderCustomerTool = app.get(SetOrderCustomerTool);
  }

  async close(): Promise<void> {
    await this.appInstance?.close();
    for (const [key, value] of this.originalEnvironment) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    this.originalEnvironment.clear();
  }

  async reset(): Promise<void> {
    this.generate.mockReset().mockResolvedValue({
      answer: 'Respuesta de prueba',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    this.embed.mockReset().mockResolvedValue(deterministicEmbedding());
    this.sendWhatsAppText.mockReset().mockResolvedValue({ providerMessageId: 'wamid.e2e-default' });

    const prisma = this.prisma;
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
  }

  private toolCtx(input: GenerateResponseInput): ToolInvocationContext {
    return {
      requestContext: input.context,
      conversationId: input.conversationId,
      orderContext: input.orderContext,
      message: input.message,
      ...(input.knowledgeQueryOverride ? { argumentOverride: input.knowledgeQueryOverride } : {}),
    };
  }

  toolBag(input: GenerateResponseInput): ToolBag {
    const context = this.toolCtx(input);
    return {
      searchCatalog: (filters) => this.catalogTool!.execute(filters, context),
      searchKnowledge: (query) => this.knowledgeTool!.execute({ query }, context),
      searchPromotions: (filters) => this.promotionTool!.execute(filters, context),
      getMenuDocument: () => this.menuTool!.execute(undefined, context),
      manageOrder: (args) => this.manageOrderTool!.execute(args, context),
      setOrderCustomer: (details) => this.setOrderCustomerTool!.execute(details, context),
    };
  }
}

export function setupHttpE2E(): HttpE2EHarness {
  const harness = new HttpE2EHarness();
  beforeAll(() => harness.init());
  afterAll(() => harness.close());
  beforeEach(() => harness.reset());
  return harness;
}
