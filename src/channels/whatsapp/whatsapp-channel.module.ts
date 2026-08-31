import { Module } from '@nestjs/common';
import { ChatModule } from '../../chat/chat.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { MetaWhatsAppClient } from './providers/meta-whatsapp.client';
import { WHATSAPP_PROVIDER } from './providers/whatsapp-provider';
import { WhatsAppChatService } from './whatsapp-chat.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppOutboundMessageService } from './whatsapp-outbound-message.service';
import { WhatsAppWebhookReceiptService } from './whatsapp-webhook-receipt.service';

@Module({
  imports: [ChatModule, ConversationModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppChatService,
    WhatsAppOutboundMessageService,
    WhatsAppWebhookReceiptService,
    MetaWhatsAppClient,
    { provide: WHATSAPP_PROVIDER, useExisting: MetaWhatsAppClient },
  ],
})
export class WhatsAppChannelModule {}
