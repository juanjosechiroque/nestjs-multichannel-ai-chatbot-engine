import { ChatService } from './chat.service';
import type { OpenAiService } from './openai.service';

describe('ChatService', () => {
  it('sends the message and instructions to OpenAI', async () => {
    const openAi: Pick<OpenAiService, 'generate'> = {
      generate: jest.fn().mockResolvedValue('¡Hola! ¿Cómo puedo ayudarte?'),
    };
    const service = new ChatService(openAi);

    const reply = await service.reply('Hola');

    expect(reply).toBe('¡Hola! ¿Cómo puedo ayudarte?');
    expect(openAi.generate).toHaveBeenCalledWith(
      'Hola',
      expect.stringContaining('Responde siempre en español'),
    );
  });
});
