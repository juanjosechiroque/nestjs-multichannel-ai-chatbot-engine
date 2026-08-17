import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApplicationFailureCode } from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { MemoryService } from '../memory/memory.service';
import { OpenAiService } from './openai.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';
import type { ChatRequest } from './chat.types';

@Injectable()
export class ChatService {
  private readonly instructions: string;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    private readonly config: ConfigService,
    @Inject(KnowledgeSearchTool)
    private readonly knowledgeSearch: Pick<KnowledgeSearchTool, 'execute'>,
    @Inject(MemoryService)
    private readonly memory: Pick<MemoryService, 'getRecentMessages' | 'saveExchange'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply({ requestId, conversationId, channel, message }: ChatRequest): Promise<string> {
    const startedAt = Date.now();
    const context: RequestContext = { requestId, conversationId, channel };

    try {
      const history = await this.memory.getRecentMessages(conversationId, context);

      const generation = await this.openAi.generate({
        context,
        message,
        instructions: this.instructions,
        history,
        searchKnowledge: (query) => this.knowledgeSearch.execute({ query, history, context }),
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
      });

      return generation.answer;
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
