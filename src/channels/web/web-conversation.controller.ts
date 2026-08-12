import { randomUUID } from 'node:crypto';
import { Controller, Post } from '@nestjs/common';
import { ConversationService } from '../../conversation/conversation.service';

interface CreateWebConversationResponse {
  sessionId: string;
}

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
