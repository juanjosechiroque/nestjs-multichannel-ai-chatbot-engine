import { Inject, Injectable } from '@nestjs/common';
import { OpenAiService } from './openai.service';

@Injectable()
export class ChatService {
  private readonly instructions = [
    'Responde siempre en español.',
    'Sé amable, claro y breve.',
    'Si no conoces una respuesta, dilo y ofrece escalar la consulta a una persona.',
  ].join(' ');

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
  ) {}

  async reply(message: string): Promise<string> {
    return this.openAi.generate(message, this.instructions);
  }
}
