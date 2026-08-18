import { ConflictException, NotFoundException } from '@nestjs/common';
import type { ChatService } from '../../chat/chat.service';
import type { ChatRequest, ChatResult } from '../../chat/chat.types';
import {
  ChatTurnInProgressError,
  ChatTurnMessageConflictError,
  ChatTurnPreviouslyFailedError,
} from '../../chat/chat-turn.errors';
import type { RequestContext } from '../../common/request-context';
import type { ConversationService } from '../../conversation/conversation.service';
import type {
  ConversationReference,
  FindConversationInput,
} from '../../conversation/conversation.types';
import { WebChatController } from './web-chat.controller';
import { WebResponseAdapter } from './web-response.adapter';

const SESSION_ID = '59ad97ee-f9c0-44d7-8fb8-881b87d21e19';
const MESSAGE_ID = '4d1534e7-b3e8-49ce-b0f3-fd8f6150c900';

describe('WebChatController', () => {
  it('resolves the public web session before calling the channel-independent core', async () => {
    const reply = jest
      .fn<Promise<ChatResult>, [ChatRequest]>()
      .mockResolvedValue({ reply: 'Respuesta con memoria' });
    const findBySession = jest
      .fn<Promise<ConversationReference | null>, [FindConversationInput, RequestContext?]>()
      .mockResolvedValue({
        id: 'internal-conversation-id',
        sessionId: SESSION_ID,
      });
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
      new WebResponseAdapter(),
    );

    const response = await controller.chat({
      sessionId: SESSION_ID,
      messageId: MESSAGE_ID,
      message: 'Hola',
    });

    expect(findBySession.mock.calls[0]?.[0]).toEqual({
      sessionId: SESSION_ID,
      channel: 'web',
    });
    const chatRequest = reply.mock.calls[0]?.[0];
    expect(chatRequest).toMatchObject({
      conversationId: 'internal-conversation-id',
      messageId: MESSAGE_ID,
      channel: 'web',
      message: 'Hola',
    });
    expect(chatRequest?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(findBySession.mock.calls[0]?.[1]).toEqual({
      requestId: chatRequest?.requestId,
      channel: 'web',
    });
    expect(response).toEqual({ reply: 'Respuesta con memoria' });
  });

  it('rejects a session that was not created by the backend', async () => {
    const reply = jest.fn();
    const findBySession = jest
      .fn<Promise<ConversationReference | null>, [FindConversationInput, RequestContext?]>()
      .mockResolvedValue(null);
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
      new WebResponseAdapter(),
    );

    await expect(
      controller.chat({
        sessionId: '2a772a58-51a4-470b-985c-0929e9dd1f52',
        messageId: MESSAGE_ID,
        message: 'Hola',
      }),
    ).rejects.toThrow(NotFoundException);
    expect(reply).not.toHaveBeenCalled();
  });

  it('passes channel-neutral document content to the web response', async () => {
    const reply = jest.fn<Promise<ChatResult>, [ChatRequest]>().mockResolvedValue({
      reply: 'Aquí tienes nuestra carta.',
      content: [
        {
          type: 'document',
          title: 'Carta de Café Nube',
          url: '/api/menu',
          mimeType: 'application/pdf',
        },
      ],
      tokenUsage: {
        inputTokens: 1_000,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 100,
        reasoningTokens: 20,
        totalTokens: 1_100,
      },
    });
    const findBySession = jest.fn().mockResolvedValue({
      id: 'internal-conversation-id',
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
    });
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
      new WebResponseAdapter(),
    );

    await expect(
      controller.chat({
        sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
        messageId: MESSAGE_ID,
        message: 'Quiero ver la carta',
      }),
    ).resolves.toEqual({
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
  });

  it('returns plain text when the channel-neutral reply contains Markdown', async () => {
    const reply = jest.fn<Promise<ChatResult>, [ChatRequest]>().mockResolvedValue({
      reply: '**Pedido confirmado:** total `S/ 28`.',
    });
    const findBySession = jest.fn().mockResolvedValue({
      id: 'internal-conversation-id',
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
    });
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
      new WebResponseAdapter(),
    );

    await expect(
      controller.chat({
        sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
        messageId: MESSAGE_ID,
        message: 'Sí',
      }),
    ).resolves.toEqual({
      reply: 'Pedido confirmado: total S/ 28.',
    });
  });

  it.each([
    new ChatTurnInProgressError(MESSAGE_ID),
    new ChatTurnMessageConflictError(MESSAGE_ID),
    new ChatTurnPreviouslyFailedError(MESSAGE_ID),
  ])('translates %s into an HTTP conflict at the web boundary', async (turnError) => {
    const reply = jest.fn().mockRejectedValue(turnError);
    const findBySession = jest.fn().mockResolvedValue({
      id: 'internal-conversation-id',
      sessionId: SESSION_ID,
    });
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
      new WebResponseAdapter(),
    );

    await expect(
      controller.chat({
        sessionId: SESSION_ID,
        messageId: MESSAGE_ID,
        message: 'Hola',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
