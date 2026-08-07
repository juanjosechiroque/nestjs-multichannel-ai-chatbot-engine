import { NotFoundException } from '@nestjs/common';
import type { ConversationService } from '../conversation/conversation.service';
import { ChatController } from './chat.controller';
import type { ChatService } from './chat.service';
import type { ChatRequest } from './chat.types';

describe('ChatController', () => {
  it('resolves the public web session before calling the chatbot core', async () => {
    const reply = jest
      .fn<Promise<string>, [ChatRequest]>()
      .mockResolvedValue('Respuesta con memoria');
    const findBySession = jest.fn().mockResolvedValue({
      id: 'internal-conversation-id',
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
    });
    const controller = new ChatController(
      { reply } as unknown as ChatService,
      { findBySession } as unknown as ConversationService,
    );

    const response = await controller.chat({
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
      message: 'Hola',
    });

    expect(findBySession).toHaveBeenCalledWith({
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
    expect(response).toEqual({ reply: 'Respuesta con memoria' });
  });

  it('rejects a session that was not created by the backend', async () => {
    const reply = jest.fn();
    const findBySession = jest.fn().mockResolvedValue(null);
    const controller = new ChatController(
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
});
