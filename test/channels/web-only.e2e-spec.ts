import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { configureApplication } from '../../src/app.setup';
import { MetaWhatsAppClient } from '../../src/channels/whatsapp/providers/meta-whatsapp.client';
import { WHATSAPP_PROVIDER } from '../../src/channels/whatsapp/providers/whatsapp-provider';
import { OpenAiService } from '../../src/chat/openai.service';
import { PrismaService } from '../../src/database/prisma.service';
import { EmbeddingService } from '../../src/rag/embedding.service';

const WEB_ONLY_ENVIRONMENT: Record<string, string> = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4173',
  OPENAI_API_KEY: 'web-only-e2e-not-a-real-key',
  OPENAI_MODEL: 'web-only-e2e-model',
  OPENAI_EMBEDDING_MODEL: 'web-only-e2e-embedding-model',
  RAG_MIN_SIMILARITY: '0.5',
  RATE_LIMIT_CONVERSATIONS_PER_HOUR: '100',
  RATE_LIMIT_MESSAGES_PER_MINUTE: '100',
  WHATSAPP_ENABLED: 'false',
};

const META_CREDENTIAL_KEYS = [
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_APP_SECRET',
  'WHATSAPP_ACCESS_TOKEN',
] as const;

interface CreateConversationResponse {
  sessionId: string;
}

describe('Web-only deployment (WHATSAPP_ENABLED=false)', () => {
  const originalEnvironment = { ...process.env };
  let app: INestApplication;
  let server: Server;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('Shared E2E database is not configured; is e2e-global-setup.ts wired?');
    }

    for (const key of META_CREDENTIAL_KEYS) {
      delete process.env[key];
    }
    Object.assign(process.env, WEB_ONLY_ENVIRONMENT);
    process.env.DATABASE_URL = databaseUrl;

    const { AppModule } = await import('../../src/app.module');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(OpenAiService)
      .useValue({ generate: jest.fn() })
      .overrideProvider(EmbeddingService)
      .useValue({ embed: jest.fn() })
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true, logger: false });
    configureApplication(app, {
      corsAllowedOrigins: app.get(ConfigService).getOrThrow<string[]>('CORS_ALLOWED_ORIGINS'),
    });
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app?.close();
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnvironment)) {
        delete process.env[key];
      }
    }
    Object.assign(process.env, originalEnvironment);
  });

  afterEach(async () => {
    const prisma = app.get(PrismaService);
    await prisma.conversationMessage.deleteMany();
    await prisma.conversation.deleteMany();
  });

  it('boots with no Meta credential and passes liveness and readiness', async () => {
    await request(server).get('/api/health').expect(200, { status: 'ok' });
    await request(server).get('/api/health/live').expect(200, { status: 'ok' });
    await request(server)
      .get('/api/health/ready')
      .expect(200, {
        status: 'ok',
        checks: { nest: 'ready', postgresql: 'up' },
      });
  });

  it('never constructs the Meta WhatsApp client or provider', () => {
    expect(() => {
      app.get(MetaWhatsAppClient, { strict: false });
    }).toThrow();
    expect(() => {
      app.get(WHATSAPP_PROVIDER, { strict: false });
    }).toThrow();
  });

  it('creates a backend-managed web conversation', async () => {
    const response = await request(server).post('/api/conversations').expect(201);
    const body = response.body as CreateConversationResponse;

    expect(typeof body.sessionId).toBe('string');
    expect(body.sessionId.length).toBeGreaterThan(0);

    await expect(
      app.get(PrismaService).conversation.count({ where: { channel: 'web' } }),
    ).resolves.toBe(1);
  });

  it.each([
    ['GET', '/api/webhook/whatsapp'],
    ['POST', '/api/webhook/whatsapp'],
  ])('does not register the WhatsApp webhook route (%s %s -> 404)', async (method, path) => {
    const call = method === 'GET' ? request(server).get(path) : request(server).post(path);
    await call.expect(404);
  });
});
