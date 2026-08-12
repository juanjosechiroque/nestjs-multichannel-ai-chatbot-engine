import { Module } from '@nestjs/common';
import { ChatModule } from '../../chat/chat.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { WebChatController } from './web-chat.controller';
import { WebConversationController } from './web-conversation.controller';

@Module({
  imports: [ChatModule, ConversationModule],
  controllers: [WebChatController, WebConversationController],
})
export class WebChannelModule {}
