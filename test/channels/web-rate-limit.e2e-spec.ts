import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { ThrottlerModule } from '@nestjs/throttler';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { configureApplication } from '../../src/app.setup';
import { ChatService } from '../../src/chat/chat.service';
import { WebChatController } from '../../src/channels/web/web-chat.controller';
import { WebConversationController } from '../../src/channels/web/web-conversation.controller';
import { createWebRateLimitOptions } from '../../src/channels/web/web-rate-limit';
import { WebResponseAdapter } from '../../src/channels/web/web-response.adapter';
import { ConversationService } from '../../src/conversation/conversation.service';

describe('Web channel rate limiting', () => {
  let app: INestApplication;
  let server: Server;
  const createConversation = jest.fn();
  const findBySession = jest.fn();
  const reply = jest.fn();

  beforeAll(async () => {
    createConversation.mockImplementation(() =>
      Promise.resolve({ id: randomUUID(), sessionId: randomUUID() }),
    );
    findBySession.mockImplementation(({ sessionId }: { sessionId: string }) =>
      Promise.resolve({ id: randomUUID(), sessionId }),
    );
    reply.mockResolvedValue({ reply: 'Respuesta de prueba' });

    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot(createWebRateLimitOptions(new ConfigService()))],
      controllers: [WebConversationController, WebChatController],
      providers: [
        {
          provide: ConversationService,
          useValue: { create: createConversation, findBySession },
        },
        { provide: ChatService, useValue: { reply } },
        WebResponseAdapter,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApplication(app);
    await app.init();
    server = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await app.close();
  });

  it('allows five conversation creations per IP and blocks the sixth before persistence', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(server).post('/api/conversations').expect(201);
    }

    const response = await request(server).post('/api/conversations').expect(429);

    expect(response.body).toEqual({
      statusCode: 429,
      message: 'Has realizado demasiadas solicitudes. Inténtalo nuevamente más tarde.',
    });
    expect(response.headers['retry-after-conversation']).toBeDefined();
    expect(createConversation).toHaveBeenCalledTimes(5);
  });

  it('allows ten messages per session and blocks the eleventh before the chatbot core', async () => {
    const sessionId = randomUUID();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(server)
        .post('/api/chat')
        .send({ sessionId, messageId: randomUUID(), message: `Mensaje ${attempt + 1}` })
        .expect(201);
    }

    const response = await request(server)
      .post('/api/chat')
      .send({ sessionId, messageId: randomUUID(), message: 'Mensaje 11' })
      .expect(429);

    expect(response.body).toEqual({
      statusCode: 429,
      message: 'Has realizado demasiadas solicitudes. Inténtalo nuevamente más tarde.',
    });
    expect(response.headers['retry-after-chat']).toBeDefined();
    expect(findBySession).toHaveBeenCalledTimes(10);
    expect(reply).toHaveBeenCalledTimes(10);
  });
});
