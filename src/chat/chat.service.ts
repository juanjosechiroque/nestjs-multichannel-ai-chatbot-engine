import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KnowledgeContextService } from '../knowledge/knowledge-context.service';
import { OpenAiService } from './openai.service';
import { buildSystemPrompt } from './prompts/system-prompt';

@Injectable()
export class ChatService {
  private readonly instructions: string;

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    private readonly config: ConfigService,
    @Inject(KnowledgeContextService)
    private readonly knowledgeContext: Pick<KnowledgeContextService, 'getContext'>,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: this.config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  async reply(message: string): Promise<string> {
    const businessContext = await this.knowledgeContext.getContext();

    return this.openAi.generate({
      message,
      instructions: this.instructions,
      businessContext,
    });
  }
}
