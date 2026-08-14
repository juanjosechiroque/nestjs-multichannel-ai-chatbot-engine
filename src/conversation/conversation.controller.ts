import { randomUUID } from 'node:crypto';
import { Controller, Post } from '@nestjs/common';
import { ConversationService } from './conversation.service';

interface CreateConversationResponse {
  sessionId: string;
}

@Controller('conversations')
export class ConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  async create(): Promise<CreateConversationResponse> {
    const conversation = await this.conversations.create('web', {
      requestId: randomUUID(),
      channel: 'web',
    });

    return { sessionId: conversation.sessionId };
  }
}
