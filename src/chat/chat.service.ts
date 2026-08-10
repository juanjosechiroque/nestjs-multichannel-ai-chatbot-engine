import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  async reply({ conversationId, message }: ChatRequest): Promise<string> {
    const history = await this.memory.getRecentMessages(conversationId);
    const retrievalQuery = buildRetrievalQuery(message, history);
    const businessContext = await this.rag.getContext(retrievalQuery, RAG_TOP_K);

    const reply = await this.openAi.generate({
      message,
      instructions: this.instructions,
      businessContext,
      history,
    });

    await this.memory.saveExchange({
      conversationId,
      userMessage: message,
      assistantMessage: reply,
    });

    return reply;
  }
}
