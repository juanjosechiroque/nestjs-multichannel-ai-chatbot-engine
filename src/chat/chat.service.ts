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
import { PromotionSearchTool } from './tools/promotion-search.tool';
import type { ChatRequest, ChatResult, TrustedCustomerIdentity } from './chat.types';
import { ChatTurnError } from './chat-turn.errors';
import { ChatTurnService } from './chat-turn.service';

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
    private readonly orderTool: Pick<OrderTool, 'execute' | 'getContext' | 'setCustomerDetails'>,
    @Inject(PromotionSearchTool)
    private readonly promotionSearch: Pick<PromotionSearchTool, 'execute'>,
    @Inject(MemoryService)
    private readonly memory: Pick<MemoryService, 'getRecentMessages'>,
    @Inject(ChatTurnService)
    private readonly turns: Pick<ChatTurnService, 'start' | 'complete' | 'fail'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply({
    requestId,
    messageId,
    conversationId,
    channel,
    message,
    customerIdentity,
  }: ChatRequest): Promise<ChatResult> {
    const startedAt = Date.now();
    const context: RequestContext = { requestId, conversationId, channel };
    let turnReserved = false;

    try {
      const reservation = await this.turns.start({ conversationId, messageId, message }, context);
      if (reservation.kind === 'replay') {
        this.logger.log({
          event: 'chat.response.replayed',
          requestId,
          messageId,
          conversationId,
          channel,
          totalDurationMs: Date.now() - startedAt,
        });
        return reservation.result;
      }
      turnReserved = true;

      const [history, initialOrderContext] = await Promise.all([
        this.memory.getRecentMessages(conversationId, context),
        this.orderTool.getContext(conversationId, context),
      ]);
      const orderContext = await this.applyTrustedCustomerIdentity(
        initialOrderContext,
        customerIdentity,
        conversationId,
        context,
      );

      const generation = await this.openAi.generate({
        context,
        message,
        instructions: this.instructions,
        history,
        orderContext,
        manageOrder: (order) => this.orderTool.execute({ ...order, conversationId, context }),
        setOrderCustomer: (details) =>
          this.orderTool.setCustomerDetails(details, conversationId, context),
        getMenuDocument: () => this.menuDocument.execute(),
        searchCatalog: (filters) => this.catalogSearch.execute({ ...filters, context }),
        searchPromotions: (filters) => this.promotionSearch.execute({ ...filters, context }),
        searchKnowledge: (query) => this.knowledgeSearch.execute({ query, context }),
      });

      const result: ChatResult = {
        reply: generation.answer,
        ...(generation.tokenUsage ? { tokenUsage: generation.tokenUsage } : {}),
        ...(generation.content && generation.content.length > 0
          ? { content: generation.content }
          : {}),
      };
      await this.turns.complete(
        {
          conversationId,
          messageId,
          userMessage: message,
          result,
        },
        context,
      );

      this.logger.log({
        event: 'chat.response.completed',
        requestId,
        messageId,
        conversationId,
        channel,
        totalDurationMs: Date.now() - startedAt,
        llmCalls: generation.llmCalls,
        usedTools: generation.usedTools,
        usedSources: generation.usedSources,
        contentTypes: generation.content?.map((item) => item.type) ?? [],
      });

      return result;
    } catch (error: unknown) {
      if (error instanceof ChatTurnError) {
        this.logger.warn({
          event: 'chat.response.rejected',
          requestId,
          messageId,
          conversationId,
          channel,
          totalDurationMs: Date.now() - startedAt,
          reason: error.name,
        });
        throw error;
      }
      if (turnReserved) {
        try {
          await this.turns.fail(
            conversationId,
            messageId,
            getApplicationFailureCode(error) ??
              (error instanceof Error ? error.name : 'UNKNOWN_CHAT_FAILURE'),
            context,
          );
        } catch (turnFailure: unknown) {
          this.logger.error({
            event: 'chat.turn.failure_persistence_failed',
            requestId,
            messageId,
            conversationId,
            channel,
            failureCode: getApplicationFailureCode(turnFailure),
          });
        }
      }
      const message = error instanceof Error ? error.message : 'Unknown chat error';
      this.logger.error({
        event: 'chat.response.failed',
        requestId,
        messageId,
        conversationId,
        channel,
        totalDurationMs: Date.now() - startedAt,
        failureCode: getApplicationFailureCode(error),
        message,
      });
      throw error;
    }
  }

  private async applyTrustedCustomerIdentity(
    orderContext: Awaited<ReturnType<OrderTool['getContext']>>,
    identity: TrustedCustomerIdentity | undefined,
    conversationId: string,
    context: RequestContext,
  ): Promise<Awaited<ReturnType<OrderTool['getContext']>>> {
    const missingFields = orderContext.activeOrder?.workflow.missingCustomerFields ?? [];
    const customerName = missingFields.includes('customerName') ? identity?.name : undefined;
    const customerPhone = missingFields.includes('customerPhone') ? identity?.phone : undefined;
    if (customerName === undefined && customerPhone === undefined) return orderContext;

    await this.orderTool.setCustomerDetails(
      {
        customerName: customerName ?? null,
        customerPhone: customerPhone ?? null,
      },
      conversationId,
      context,
    );
    return this.orderTool.getContext(conversationId, context);
  }
}
