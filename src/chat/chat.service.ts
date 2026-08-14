import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getApplicationFailureCode } from '../common/application-error';
import { MemoryService } from '../memory/memory.service';
import { RagService } from '../rag/rag.service';
import { buildRetrievalQuery } from '../rag/retrieval-query';
import { OpenAiService } from './openai.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import type { ChatRequest } from './chat.types';

const RAG_TOP_K = 5;

@Injectable()
export class ChatService {
  private readonly instructions: string;
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    private readonly config: ConfigService,
    @Inject(RagService)
    private readonly rag: Pick<RagService, 'getContext'>,
    @Inject(MemoryService)
    private readonly memory: Pick<MemoryService, 'getRecentMessages' | 'saveExchange'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply({ requestId, conversationId, channel, message }: ChatRequest): Promise<string> {
    const startedAt = Date.now();

    try {
      const history = await this.memory.getRecentMessages(conversationId);
      const retrievalQuery = buildRetrievalQuery(message, history);
      const businessContext = await this.rag.getContext(retrievalQuery, RAG_TOP_K, { requestId });

      const generation = await this.openAi.generate({
        requestId,
        message,
        instructions: this.instructions,
        businessContext,
        history,
      });

      await this.memory.saveExchange({
        conversationId,
        userMessage: message,
        assistantMessage: generation.answer,
      });

      this.logger.log({
        event: 'chat.response.completed',
        requestId,
        conversationId,
        channel,
        totalDurationMs: Date.now() - startedAt,
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
