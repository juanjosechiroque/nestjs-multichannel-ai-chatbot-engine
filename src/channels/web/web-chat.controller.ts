import { randomUUID } from 'node:crypto';
import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
import { ChatService } from '../../chat/chat.service';
import type { ChatContent } from '../../chat/chat.types';
import { ConversationService } from '../../conversation/conversation.service';
import { WebChatMessageDto } from './dto/web-chat-message.dto';

interface WebChatResponse {
  reply: string;
  content?: ChatContent[];
}

@Controller('chat')
export class WebChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversations: ConversationService,
  ) {}

  @Post()
  async chat(@Body() input: WebChatMessageDto): Promise<WebChatResponse> {
    const requestId = randomUUID();
    const conversation = await this.conversations.findBySession(
      {
        sessionId: input.sessionId,
        channel: 'web',
      },
      { requestId, channel: 'web' },
    );

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    const result = await this.chatService.reply({
      requestId,
      conversationId: conversation.id,
      channel: 'web',
      message: input.message,
    });

    return {
      reply: result.reply,
      ...(result.content ? { content: result.content } : {}),
    };
  }
}
