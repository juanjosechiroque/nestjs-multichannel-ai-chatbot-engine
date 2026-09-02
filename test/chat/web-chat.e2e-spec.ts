import { randomUUID } from 'node:crypto';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import {
  DatabaseUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiRequestFailedException,
} from '../../src/common/application-error';
import type { GenerateResponseResult } from '../../src/chat/openai.service';
import { ConversationService } from '../../src/conversation/conversation.service';
import { ConversationTurnStatus } from '../../src/generated/prisma/enums';
import { chatMessage, setupHttpE2E } from '../support/e2e-app';

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

describe('Web chat HTTP endpoint', () => {
  const harness = setupHttpE2E();

  it('creates a backend-managed web conversation with a UUID session', async () => {
    const response = await request(harness.server).post('/api/conversations').expect(201);
    const body = response.body as ConversationResponse;

    expect(body.sessionId).toEqual(expect.any(String));
    expect(body.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    await expect(
      harness.prisma.conversation.findUnique({
        where: { channel_sessionId: { channel: 'web', sessionId: body.sessionId } },
      }),
    ).resolves.not.toBeNull();
  });

  it('persists a social exchange without executing embeddings or RAG', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    const chatResponse = await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Hola'))
      .expect(201);

    expect(chatResponse.body as ChatResponse).toEqual({ reply: 'Respuesta de prueba' });
    const generationInput = harness.generate.mock.calls[0]?.[0];
    expect(generationInput?.context.requestId).toEqual(expect.any(String));
    expect(generationInput?.context.conversationId).toEqual(expect.any(String));
    expect(generationInput?.context.channel).toBe('web');
    expect(harness.embed).not.toHaveBeenCalled();
    expect(harness.generate).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Hola',
        history: [],
      }),
    );
    expect(generationInput?.conversationId).toEqual(expect.any(String));
    expect(generationInput?.toolChoice).toBe('auto');

    const conversation = await harness.prisma.conversation.findUniqueOrThrow({
      where: { channel_sessionId: { channel: 'web', sessionId } },
      include: { messages: { orderBy: { id: 'asc' } } },
    });

    expect(conversation.messages).toEqual([
      expect.objectContaining({ role: 'USER', content: 'Hola' }),
      expect.objectContaining({ role: 'ASSISTANT', content: 'Respuesta de prueba' }),
    ]);
  });

  it('replays a completed message without calling OpenAI or saving memory twice', async () => {
    harness.generate.mockResolvedValueOnce({
      answer: 'Respuesta idempotente',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();
    const payload = chatMessage(sessionId, 'Hola', messageId);

    await request(harness.server).post('/api/chat').send(payload).expect(201, {
      reply: 'Respuesta idempotente',
    });
    await request(harness.server).post('/api/chat').send(payload).expect(201, {
      reply: 'Respuesta idempotente',
    });

    expect(harness.generate).toHaveBeenCalledTimes(1);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
    await expect(harness.prisma.conversationTurn.count()).resolves.toBe(1);
    await expect(harness.prisma.conversationTurn.findFirstOrThrow()).resolves.toEqual(
      expect.objectContaining({
        messageId,
        status: ConversationTurnStatus.COMPLETED,
        response: { reply: 'Respuesta idempotente' },
      }),
    );
  });

  it('rejects a messageId reused with different text', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Hola', messageId))
      .expect(201);
    await request(harness.server)
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

    expect(harness.generate).toHaveBeenCalledTimes(1);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('rejects a concurrent retry while the original message is still processing', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
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
    harness.generate.mockImplementationOnce(() => {
      signalGenerationStarted();
      return pendingGeneration;
    });

    const firstRequest = request(harness.server).post('/api/chat').send(payload).then();
    await generationStarted;
    await request(harness.server)
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
    expect(harness.generate).toHaveBeenCalledTimes(1);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('does not reprocess a failed message with the same messageId', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    const messageId = randomUUID();
    const payload = chatMessage(sessionId, 'Hola', messageId);
    harness.generate.mockRejectedValueOnce(new OpenAiRequestFailedException());

    await request(harness.server).post('/api/chat').send(payload).expect(503);
    await request(harness.server)
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

    expect(harness.generate).toHaveBeenCalledTimes(1);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(0);
    await expect(harness.prisma.conversationTurn.findFirstOrThrow()).resolves.toEqual(
      expect.objectContaining({
        messageId,
        status: ConversationTurnStatus.FAILED,
      }),
    );
  });

  it('keeps supported strong emphasis while removing unsupported inline-code Markdown', async () => {
    harness.generate.mockResolvedValueOnce({
      answer: '**Pedido confirmado:** total `S/ 28`.',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
    });
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Confirma mi pedido'))
      .expect(201, { reply: '**Pedido confirmado:** total S/ 28.' });

    await expect(
      harness.prisma.conversation.findUniqueOrThrow({
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

  it('rejects a valid but unknown session', async () => {
    await request(harness.server)
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
    await request(harness.server).post('/api/chat').send(payload).expect(400);
  });

  it.each([
    ['the generation request fails', new OpenAiRequestFailedException()],
    ['OpenAI returns an empty response', new OpenAiEmptyResponseException()],
  ])('returns a controlled 503 when %s', async (_scenario, providerError) => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate.mockRejectedValueOnce(providerError);

    await request(harness.server)
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

    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(0);
  });

  it('returns a controlled 503 when PostgreSQL is unavailable', async () => {
    const conversations = harness.app.get(ConversationService);
    const findBySession = jest
      .spyOn(conversations, 'findBySession')
      .mockRejectedValueOnce(new DatabaseUnavailableException());

    try {
      await request(harness.server)
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

      expect(harness.generate).not.toHaveBeenCalled();
    } finally {
      findBySession.mockRestore();
    }
  });
});
