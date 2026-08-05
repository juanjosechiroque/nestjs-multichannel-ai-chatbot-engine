import { Body, Controller, Post } from '@nestjs/common';
import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';

interface ChatResponse {
  reply: string;
}

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post()
  async chat(@Body() input: ChatMessageDto): Promise<ChatResponse> {
    const reply = await this.chatService.reply(input.message);
    return { reply };
  }
}
