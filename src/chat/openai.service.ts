import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';

@Injectable()
export class OpenAiService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
    });
  }

  async generate(message: string, instructions: string): Promise<string> {
    const startedAt = Date.now();

    try {
      const response = await this.client.responses.create({
        model: this.config.get<string>('OPENAI_MODEL', 'gpt-5.6-luna'),
        instructions,
        input: message,
        reasoning: { effort: 'low' },
        max_output_tokens: this.config.get<number>('OPENAI_MAX_OUTPUT_TOKENS', 500),
      });

      this.logger.log({
        event: 'openai.response.completed',
        durationMs: Date.now() - startedAt,
      });

      if (!response.output_text) {
        throw new Error('OpenAI returned an empty response');
      }

      return response.output_text;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error';
      this.logger.error({
        event: 'openai.response.failed',
        durationMs: Date.now() - startedAt,
        message,
      });
      throw new ServiceUnavailableException(
        'El asistente no está disponible en este momento. Inténtalo nuevamente.',
      );
    }
  }
}
