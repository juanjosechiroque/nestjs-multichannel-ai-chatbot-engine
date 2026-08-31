import { Module } from '@nestjs/common';
import { ChatModule } from '../../chat/chat.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { WhatsAppChatService } from './whatsapp-chat.service';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppMessageSenderService } from './whatsapp-message-sender.service';
import { WhatsAppWebhookReceiptService } from './whatsapp-webhook-receipt.service';

@Module({
  imports: [ChatModule, ConversationModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppChatService, WhatsAppWebhookReceiptService, WhatsAppMessageSenderService],
})
export class WhatsAppChannelModule {}
