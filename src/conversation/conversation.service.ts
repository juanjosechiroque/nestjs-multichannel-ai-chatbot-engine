import { randomUUID } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ChatChannel } from '../chat/chat.types';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import type { ConversationReference, FindConversationInput } from './conversation.types';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(private readonly prisma: PrismaService) {}

  create(channel: ChatChannel): Promise<ConversationReference> {
    return executeDatabaseOperation({ logger: this.logger, operation: 'conversation.create' }, () =>
      this.prisma.conversation.create({
        data: {
          sessionId: randomUUID(),
          channel,
        },
        select: {
          id: true,
          sessionId: true,
        },
      }),
    );
  }

  findBySession({
    sessionId,
    channel,
  }: FindConversationInput): Promise<ConversationReference | null> {
    return executeDatabaseOperation(
      { logger: this.logger, operation: 'conversation.find_by_session' },
      () =>
        this.prisma.conversation.findUnique({
          where: {
            channel_sessionId: { channel, sessionId },
          },
          select: {
            id: true,
            sessionId: true,
          },
        }),
    );
  }
}
