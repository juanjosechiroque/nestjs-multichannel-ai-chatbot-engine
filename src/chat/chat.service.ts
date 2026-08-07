import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeContextService } from '../knowledge/knowledge-context.service';
import { MemoryService } from '../memory/memory.service';
import { OpenAiService } from './openai.service';
import { buildSystemPrompt } from './prompts/system-prompt';
import type { ChatRequest } from './chat.types';

@Injectable()
export class ChatService {
  private readonly instructions: string;

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    private readonly config: ConfigService,
    @Inject(KnowledgeContextService)
    private readonly knowledgeContext: Pick<KnowledgeContextService, 'getContext'>,
    @Inject(MemoryService)
    private readonly memory: Pick<MemoryService, 'getRecentMessages' | 'saveExchange'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply({ conversationId, message }: ChatRequest): Promise<string> {
    const [businessContext, history] = await Promise.all([
      this.knowledgeContext.getContext(),
      this.memory.getRecentMessages(conversationId),
    ]);

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
