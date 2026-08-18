import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { ConversationModule } from '../conversation/conversation.module';
import { DatabaseModule } from '../database/database.module';
import { MemoryModule } from '../memory/memory.module';
import { OrderModule } from '../order/order.module';
import { RagModule } from '../rag/rag.module';
import { ChatService } from './chat.service';
import { ChatTurnService } from './chat-turn.service';
import { CatalogEvaluationService } from './evaluation/catalog-evaluation.service';
import { ConversationSecurityEvaluationService } from './evaluation/conversation-security-evaluation.service';
import { ConversationSecurityJudgeService } from './evaluation/conversation-security-judge.service';
import { OrderConversationEvaluationService } from './evaluation/order-conversation-evaluation.service';
import { OpenAiService } from './openai.service';
import { CatalogSearchTool } from './tools/catalog-search.tool';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';
import { MenuDocumentTool } from './tools/menu-document.tool';
import { OrderTool } from './tools/order.tool';
import { PromotionSearchTool } from './tools/promotion-search.tool';

@Module({
  imports: [
    CatalogModule,
    ConversationModule,
    DatabaseModule,
    MemoryModule,
    OrderModule,
    RagModule,
  ],
  providers: [
    ChatService,
    ChatTurnService,
    CatalogEvaluationService,
    CatalogSearchTool,
    ConversationSecurityEvaluationService,
    ConversationSecurityJudgeService,
    OrderConversationEvaluationService,
    KnowledgeSearchTool,
    MenuDocumentTool,
    OrderTool,
    PromotionSearchTool,
    OpenAiService,
  ],
  exports: [ChatService],
})
export class ChatModule {}
