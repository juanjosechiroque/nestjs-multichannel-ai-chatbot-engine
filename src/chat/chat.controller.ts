import { randomUUID } from 'node:crypto';
import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ConversationService } from '../conversation/conversation.service';
import { ChatService } from './chat.service';
import { ChatMessageDto } from './dto/chat-message.dto';

interface ChatResponse {
  reply: string;
}

@Controller('chat')
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversations: ConversationService,
  ) {}

  @Post()
  async chat(@Body() input: ChatMessageDto): Promise<ChatResponse> {
    const conversation = await this.conversations.findBySession({
      sessionId: input.sessionId,
      channel: 'web',
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const reply = await this.chatService.reply({
      requestId: randomUUID(),
      conversationId: conversation.id,
      channel: 'web',
      message: input.message,
    });
    return { reply };
  }
}
