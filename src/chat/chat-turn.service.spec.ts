import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../common/application-error';
import type { PrismaService } from '../database/prisma.service';
import { ConversationTurnStatus, MessageRole } from '../generated/prisma/enums';
import {
  ChatTurnInProgressError,
  ChatTurnMessageConflictError,
  ChatTurnPreviouslyFailedError,
} from './chat-turn.errors';
import { ChatTurnService } from './chat-turn.service';

const CONTEXT = {
  requestId: 'request-1',
  conversationId: 'conversation-1',
  channel: 'web',
} as const;

const INPUT = {
  conversationId: 'conversation-1',
  messageId: '4d1534e7-b3e8-49ce-b0f3-fd8f6150c900',
  message: 'Quiero ver la carta',
};

function duplicateMessageError(): { code: 'P2002' } {
  return { code: 'P2002' };
}

function messageHash(message = INPUT.message): string {
  return createHash('sha256').update(message).digest('hex');
}

describe('ChatTurnService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserves a new message before processing it', async () => {
    const create = jest.fn().mockResolvedValue({});
    const service = new ChatTurnService({
      conversationTurn: { create },
    } as unknown as PrismaService);

    await expect(service.start(INPUT, CONTEXT)).resolves.toEqual({ kind: 'started' });
    expect(create).toHaveBeenCalledWith({
      data: {
        conversationId: INPUT.conversationId,
        messageId: INPUT.messageId,
        messageHash: messageHash(),
      },
    });
  });

  it('replays a completed response without exposing the previous token usage', async () => {
    const create = jest.fn().mockRejectedValue(duplicateMessageError());
    const findUnique = jest.fn().mockResolvedValue({
      messageHash: messageHash(),
      status: ConversationTurnStatus.COMPLETED,
      response: {
        reply: 'Aquí tienes nuestra carta.',
        content: [
          {
            type: 'document',
            title: 'Carta de Café Nube',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
    const service = new ChatTurnService({
      conversationTurn: { create, findUnique },
    } as unknown as PrismaService);

    await expect(service.start(INPUT, CONTEXT)).resolves.toEqual({
      kind: 'replay',
      result: {
        reply: 'Aquí tienes nuestra carta.',
        content: [
          {
            type: 'document',
            title: 'Carta de Café Nube',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      },
    });
  });

  it('rejects a messageId reused with different text', async () => {
    const service = new ChatTurnService({
      conversationTurn: {
        create: jest.fn().mockRejectedValue(duplicateMessageError()),
        findUnique: jest.fn().mockResolvedValue({
          messageHash: 'different-hash',
          status: ConversationTurnStatus.COMPLETED,
          response: { reply: 'Respuesta anterior' },
        }),
      },
    } as unknown as PrismaService);

    await expect(service.start(INPUT, CONTEXT)).rejects.toBeInstanceOf(
      ChatTurnMessageConflictError,
    );
  });

  it.each([
    [ConversationTurnStatus.PROCESSING, ChatTurnInProgressError],
    [ConversationTurnStatus.FAILED, ChatTurnPreviouslyFailedError],
  ])('rejects a duplicate message in %s state', async (status, expectedError) => {
    const service = new ChatTurnService({
      conversationTurn: {
        create: jest.fn().mockRejectedValue(duplicateMessageError()),
        findUnique: jest.fn().mockResolvedValue({
          messageHash: messageHash(),
          status,
          response: null,
        }),
      },
    } as unknown as PrismaService);

    await expect(service.start(INPUT, CONTEXT)).rejects.toBeInstanceOf(expectedError);
  });

  it('completes the turn and stores both memory messages atomically', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const update = jest.fn().mockResolvedValue({ id: INPUT.conversationId });
    const transaction = jest.fn(
      async (
        operation: (client: {
          conversationTurn: { updateMany: typeof updateMany };
          conversation: { update: typeof update };
        }) => Promise<void>,
      ) => operation({ conversationTurn: { updateMany }, conversation: { update } }),
    );
    const service = new ChatTurnService({
      $transaction: transaction,
    } as unknown as PrismaService);

    await service.complete(
      {
        conversationId: INPUT.conversationId,
        messageId: INPUT.messageId,
        userMessage: INPUT.message,
        result: {
          reply: 'Aquí tienes nuestra carta.',
          tokenUsage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            cacheWriteTokens: 0,
            outputTokens: 20,
            reasoningTokens: 0,
            totalTokens: 120,
          },
        },
      },
      CONTEXT,
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: INPUT.conversationId,
        messageId: INPUT.messageId,
        status: ConversationTurnStatus.PROCESSING,
      },
      data: {
        status: ConversationTurnStatus.COMPLETED,
        response: { reply: 'Aquí tienes nuestra carta.' },
      },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: INPUT.conversationId },
      data: {
        messages: {
          create: [
            { role: MessageRole.USER, content: INPUT.message },
            { role: MessageRole.ASSISTANT, content: 'Aquí tienes nuestra carta.' },
          ],
        },
      },
    });
  });

  it('marks a processing turn as failed without changing completed turns', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const service = new ChatTurnService({
      conversationTurn: { updateMany },
    } as unknown as PrismaService);

    await service.fail(INPUT.conversationId, INPUT.messageId, 'OPENAI_REQUEST_FAILED', CONTEXT);

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        conversationId: INPUT.conversationId,
        messageId: INPUT.messageId,
        status: ConversationTurnStatus.PROCESSING,
      },
      data: {
        status: ConversationTurnStatus.FAILED,
      },
    });
  });

  it('returns a controlled database error when reserving a message fails', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new ChatTurnService({
      conversationTurn: { create: jest.fn().mockRejectedValue(new Error('database down')) },
    } as unknown as PrismaService);

    await expect(service.start(INPUT, CONTEXT)).rejects.toEqual(new DatabaseUnavailableException());
  });
});
