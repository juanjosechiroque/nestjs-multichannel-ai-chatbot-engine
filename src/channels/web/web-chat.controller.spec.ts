import { NotFoundException } from '@nestjs/common';
import type { ChatService } from '../../chat/chat.service';
import type { ChatRequest, ChatResult } from '../../chat/chat.types';
import type { RequestContext } from '../../common/request-context';
import type { ConversationService } from '../../conversation/conversation.service';
import type {
  ConversationReference,
  FindConversationInput,
} from '../../conversation/conversation.types';
import { WebChatController } from './web-chat.controller';

describe('WebChatController', () => {
  it('resolves the public web session before calling the channel-independent core', async () => {
    const reply = jest
      .fn<Promise<ChatResult>, [ChatRequest]>()
      .mockResolvedValue({ reply: 'Respuesta con memoria' });
    const findBySession = jest
      .fn<Promise<ConversationReference | null>, [FindConversationInput, RequestContext?]>()
      .mockResolvedValue({
        id: 'internal-conversation-id',
        sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
      });
    const controller = new WebChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
    );

    const response = await controller.chat({
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
      message: 'Hola',
    });

    expect(findBySession.mock.calls[0]?.[0]).toEqual({
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
      channel: 'web',
    });
    const chatRequest = reply.mock.calls[0]?.[0];
    expect(chatRequest).toMatchObject({
      conversationId: 'internal-conversation-id',
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
    );

    await expect(
      controller.chat({
        sessionId: '2a772a58-51a4-470b-985c-0929e9dd1f52',
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
    );

    await expect(
      controller.chat({
        sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
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
});
