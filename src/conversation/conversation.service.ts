import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { ChatChannel } from '../chat/chat.types';
import { PrismaService } from '../database/prisma.service';
import type { ConversationReference, FindConversationInput } from './conversation.types';

@Injectable()
export class ConversationService {
  constructor(private readonly prisma: PrismaService) {}

  create(channel: ChatChannel): Promise<ConversationReference> {
    return this.prisma.conversation.create({
      data: {
        sessionId: randomUUID(),
        channel,
      },
      select: {
        id: true,
        sessionId: true,
      },
    });
  }

  findBySession({
    sessionId,
    channel,
  }: FindConversationInput): Promise<ConversationReference | null> {
    return this.prisma.conversation.findUnique({
      where: {
        channel_sessionId: { channel, sessionId },
      },
      select: {
        id: true,
        sessionId: true,
      },
    });
  }
}
