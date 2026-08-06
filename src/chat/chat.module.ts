import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { OpenAiService } from './openai.service';

@Module({
  imports: [ConversationModule, KnowledgeModule, MemoryModule],
  controllers: [ChatController],
  providers: [ChatService, OpenAiService],
})
export class ChatModule {}
