import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApplicationFailureCode } from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { MemoryService } from '../memory/memory.service';
import { OpenAiService } from './openai.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import { CatalogSearchTool } from './tools/catalog-search.tool';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';
import { MenuDocumentTool } from './tools/menu-document.tool';
import { OrderTool } from './tools/order.tool';
import type { ChatRequest, ChatResult } from './chat.types';

@Injectable()
export class ChatService {
  private readonly instructions: string;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    private readonly config: ConfigService,
    @Inject(CatalogSearchTool)
    private readonly catalogSearch: Pick<CatalogSearchTool, 'execute'>,
    @Inject(KnowledgeSearchTool)
    private readonly knowledgeSearch: Pick<KnowledgeSearchTool, 'execute'>,
    @Inject(MenuDocumentTool)
    private readonly menuDocument: Pick<MenuDocumentTool, 'execute'>,
    @Inject(OrderTool)
    private readonly orderTool: Pick<OrderTool, 'execute' | 'getContext'>,
    @Inject(MemoryService)
    private readonly memory: Pick<MemoryService, 'getRecentMessages' | 'saveExchange'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply({ requestId, conversationId, channel, message }: ChatRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    const context: RequestContext = { requestId, conversationId, channel };

    try {
      const [history, orderContext] = await Promise.all([
        this.memory.getRecentMessages(conversationId, context),
        this.orderTool.getContext(conversationId, context),
      ]);

      const generation = await this.openAi.generate({
        context,
        message,
        instructions: this.instructions,
        history,
        orderContext,
        manageOrder: (order) => this.orderTool.execute({ ...order, conversationId, context }),
        getMenuDocument: () => this.menuDocument.execute(),
        searchCatalog: (filters) => this.catalogSearch.execute({ ...filters, context }),
        searchKnowledge: (query) => this.knowledgeSearch.execute({ query, context }),
      });

      await this.memory.saveExchange(
        {
          conversationId,
          userMessage: message,
          assistantMessage: generation.answer,
        },
        context,
      );

      this.logger.log({
        event: 'chat.response.completed',
        requestId,
        conversationId,
        channel,
        totalDurationMs: Date.now() - startedAt,
        llmCalls: generation.llmCalls,
        usedTools: generation.usedTools,
        usedSources: generation.usedSources,
        contentTypes: generation.content?.map((item) => item.type) ?? [],
      });

      return {
        reply: generation.answer,
        ...(generation.tokenUsage ? { tokenUsage: generation.tokenUsage } : {}),
        ...(generation.content && generation.content.length > 0
          ? { content: generation.content }
          : {}),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown chat error';
      this.logger.error({
        event: 'chat.response.failed',
        requestId,
        conversationId,
        channel,
        totalDurationMs: Date.now() - startedAt,
        failureCode: getApplicationFailureCode(error),
        message,
      });
      throw error;
    }
  }
}
