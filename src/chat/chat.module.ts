import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation/conversation.module';
import { MemoryModule } from '../memory/memory.module';
import { RagModule } from '../rag/rag.module';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';
import { ConversationSecurityEvaluationService } from './evaluation/conversation-security-evaluation.service';
import { ConversationSecurityJudgeService } from './evaluation/conversation-security-judge.service';
import { OpenAiService } from './openai.service';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';

@Module({
  imports: [ConversationModule, MemoryModule, RagModule],
  controllers: [ChatController],
  providers: [
    ChatService,
    ConversationSecurityEvaluationService,
    ConversationSecurityJudgeService,
    KnowledgeSearchTool,
    OpenAiService,
  ],
})
export class ChatModule {}
