import { randomUUID } from 'node:crypto';
import { Body, Controller, NotFoundException, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ChatService } from '../../chat/chat.service';
import type { ChatContent } from '../../chat/chat.types';
import { ConversationService } from '../../conversation/conversation.service';
import { WebChatMessageDto } from './dto/web-chat-message.dto';
import { CONVERSATION_RATE_LIMIT_NAME } from './web-rate-limit';

interface WebChatResponse {
  reply: string;
  content?: ChatContent[];
}

@SkipThrottle({ [CONVERSATION_RATE_LIMIT_NAME]: true })
@UseGuards(ThrottlerGuard)
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
