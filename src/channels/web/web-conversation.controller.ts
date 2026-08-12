import { randomUUID } from 'node:crypto';
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import { ConversationService } from '../../conversation/conversation.service';
import { CHAT_RATE_LIMIT_NAME } from './web-rate-limit';

interface CreateWebConversationResponse {
  sessionId: string;
}

@SkipThrottle({ [CHAT_RATE_LIMIT_NAME]: true })
@UseGuards(ThrottlerGuard)
@Controller('conversations')
export class WebConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  async create(): Promise<CreateWebConversationResponse> {
    const conversation = await this.conversations.create('web', {
      requestId: randomUUID(),
      channel: 'web',
    });

    return { sessionId: conversation.sessionId };
  }
}
