import { createHash } from 'node:crypto';
import { Logger } from '@nestjs/common';
import type { ChatService } from '../../chat/chat.service';
import {
  OpenAiRequestFailedException,
  WhatsAppDeliveryFailedException,
} from '../../common/application-error';
import type { ConversationService } from '../../conversation/conversation.service';
import { WhatsAppChatService } from './whatsapp-chat.service';
import type { WhatsAppMessageSenderService } from './whatsapp-message-sender.service';
import type { WhatsAppInboundMessage } from './whatsapp-webhook-receipt.service';

const MESSAGE: WhatsAppInboundMessage = {
  wabaId: 'waba-123',
  messageId: 'wamid.123',
  phoneNumberId: '1220572421149962',
  recipientPhoneNumber: '51999999999',
  messageType: 'text',
  text: '¿Qué productos tienen?',
  customerName: 'Ana Cliente',
};

const reply = jest.fn();
const findOrCreateBySession = jest.fn();
const sendText = jest.fn();

function createService(): WhatsAppChatService {
  return new WhatsAppChatService(
    { reply } as unknown as ChatService,
    { findOrCreateBySession } as unknown as ConversationService,
    { sendText } as unknown as WhatsAppMessageSenderService,
  );
}

describe('WhatsAppChatService', () => {
  beforeEach(() => {
    reply.mockReset().mockResolvedValue({
      reply: 'Tenemos bebidas calientes, bebidas frías y alimentos.',
    });
    findOrCreateBySession.mockReset().mockResolvedValue({
      id: 'conversation-123',
      sessionId: 'whatsapp:stable-hash',
    });
    sendText.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('routes an inbound text through the shared chatbot and sends its answer through Meta', async () => {
    const service = createService();

    await service.handle(MESSAGE);

    const expectedSessionId = `whatsapp:${createHash('sha256')
      .update('waba-123:51999999999')
      .digest('hex')}`;
    expect(findOrCreateBySession).toHaveBeenCalledWith(
      { sessionId: expectedSessionId, channel: 'whatsapp' },
      expect.objectContaining({ channel: 'whatsapp' }),
    );
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'wamid.123',
        conversationId: 'conversation-123',
        channel: 'whatsapp',
        message: '¿Qué productos tienen?',
        customerIdentity: {
          name: 'Ana Cliente',
          phone: '51999999999',
        },
      }),
    );
    expect(sendText).toHaveBeenCalledWith(
      MESSAGE,
      'Tenemos bebidas calientes, bebidas frías y alimentos.',
    );
  });

  it('keeps the same session for later messages from the same WABA customer', async () => {
    const service = createService();

    await service.handle(MESSAGE);
    await service.handle({ ...MESSAGE, messageId: 'wamid.456', text: '¿Y bebidas frías?' });

    const expectedSession = {
      sessionId: `whatsapp:${createHash('sha256').update('waba-123:51999999999').digest('hex')}`,
      channel: 'whatsapp',
    };
    expect(findOrCreateBySession).toHaveBeenNthCalledWith(
      1,
      expectedSession,
      expect.objectContaining({ channel: 'whatsapp' }),
    );
    expect(findOrCreateBySession).toHaveBeenNthCalledWith(
      2,
      expectedSession,
      expect.objectContaining({ channel: 'whatsapp' }),
    );
  });

  it('answers unsupported message types without calling OpenAI or creating a conversation', async () => {
    const service = createService();
    const imageMessage: WhatsAppInboundMessage = {
      ...MESSAGE,
      messageType: 'image',
      text: undefined,
    };

    await service.handle(imageMessage);

    expect(findOrCreateBySession).not.toHaveBeenCalled();
    expect(reply).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledWith(
      imageMessage,
      'Por ahora puedo responder mensajes de texto. Escríbeme tu consulta para ayudarte.',
    );
  });

  it('sends a safe fallback when the chatbot is temporarily unavailable', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    reply.mockRejectedValueOnce(new OpenAiRequestFailedException());
    const service = createService();

    await service.handle(MESSAGE);

    expect(sendText).toHaveBeenCalledWith(
      MESSAGE,
      'No pude procesar tu consulta en este momento. Inténtalo nuevamente con otro mensaje.',
    );
  });

  it('propagates Meta delivery failures so the webhook reservation can be retried', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    sendText.mockRejectedValueOnce(new WhatsAppDeliveryFailedException());
    const service = createService();

    await expect(service.handle(MESSAGE)).rejects.toBeInstanceOf(WhatsAppDeliveryFailedException);
  });
});
