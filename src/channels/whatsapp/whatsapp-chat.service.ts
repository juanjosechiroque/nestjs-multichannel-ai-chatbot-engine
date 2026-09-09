import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ChatService } from '../../chat/chat.service';
import { getApplicationFailureCode } from '../../common/application-error';
import { ConversationService } from '../../conversation/conversation.service';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './providers/whatsapp-provider';
import type { WhatsAppInboundMessage } from './whatsapp-webhook-receipt.service';

const UNSUPPORTED_MESSAGE_REPLY =
  'Por ahora puedo responder mensajes de texto. Escríbeme tu consulta para ayudarte.';
const CHAT_FAILURE_REPLY =
  'No pude procesar tu consulta en este momento. Inténtalo nuevamente con otro mensaje.';

@Injectable()
export class WhatsAppChatService {
  private readonly logger = new Logger(WhatsAppChatService.name);

  constructor(
    private readonly chat: ChatService,
    private readonly conversations: ConversationService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  async handle(message: WhatsAppInboundMessage): Promise<void> {
    if (!message.text) {
      await this.sendText(message, UNSUPPORTED_MESSAGE_REPLY);
      return;
    }

    const requestId = randomUUID();
    const sessionId = this.createSessionId(message);
    let reply: string;

    try {
      const conversation = await this.conversations.findOrCreateBySession(
        { sessionId, channel: 'whatsapp' },
        { requestId, channel: 'whatsapp' },
      );
      const result = await this.chat.reply({
        requestId,
        messageId: message.messageId,
        conversationId: conversation.id,
        channel: 'whatsapp',
        message: message.text,
        customerIdentity: {
          phone: message.recipientPhoneNumber,
          ...(message.customerName ? { name: message.customerName } : {}),
        },
      });

      reply = result.reply;
    } catch (error: unknown) {
      this.logger.error({
        event: 'whatsapp.chat.reply.failed',
        requestId,
        channel: 'whatsapp',
        failureCode: getApplicationFailureCode(error) ?? 'UNKNOWN_CHAT_FAILURE',
        errorName: error instanceof Error ? error.name : 'UnknownWhatsAppChatError',
      });
      reply = CHAT_FAILURE_REPLY;
    }

    await this.sendText(message, reply);
  }

  private async sendText(message: WhatsAppInboundMessage, text: string): Promise<void> {
    await this.provider.sendText({
      phoneNumberId: message.phoneNumberId,
      recipientPhoneNumber: message.recipientPhoneNumber,
      text,
    });
  }

  private createSessionId(message: WhatsAppInboundMessage): string {
    const digest = createHash('sha256')
      .update(`${message.wabaId}:${message.recipientPhoneNumber}`)
      .digest('hex');
    return `whatsapp:${digest}`;
  }
}
