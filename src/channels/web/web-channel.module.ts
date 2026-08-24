import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ChatModule } from '../../chat/chat.module';
import { ConversationModule } from '../../conversation/conversation.module';
import { WebChatController } from './web-chat.controller';
import { WebConversationController } from './web-conversation.controller';
import { createWebRateLimitOptions } from './web-rate-limit';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createWebRateLimitOptions,
    }),
    ChatModule,
    ConversationModule,
  ],
  controllers: [WebChatController, WebConversationController],
})
export class WebChannelModule {}
