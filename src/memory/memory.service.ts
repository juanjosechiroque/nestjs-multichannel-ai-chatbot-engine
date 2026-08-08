import { Injectable, Logger } from '@nestjs/common';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import { MessageRole } from '../generated/prisma/enums';
import type { ChatHistoryMessage, SaveExchangeInput } from './memory.types';

const RECENT_MESSAGE_LIMIT = 10;

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRecentMessages(conversationId: string): Promise<ChatHistoryMessage[]> {
    const messages = await executeDatabaseOperation(
      { logger: this.logger, operation: 'memory.history.read' },
      () =>
        this.prisma.conversationMessage.findMany({
          where: { conversationId },
          orderBy: { id: 'desc' },
          take: RECENT_MESSAGE_LIMIT,
          select: {
            role: true,
            content: true,
          },
        }),
    );

    return messages.reverse().map((message) => ({
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
    }));
  }

  async saveExchange({
    conversationId,
    userMessage,
    assistantMessage,
  }: SaveExchangeInput): Promise<void> {
    await executeDatabaseOperation(
      { logger: this.logger, operation: 'memory.exchange.write' },
      () =>
        this.prisma.conversation.update({
          where: { id: conversationId },
          data: {
            messages: {
              create: [
                { role: MessageRole.USER, content: userMessage },
                { role: MessageRole.ASSISTANT, content: assistantMessage },
              ],
            },
          },
        }),
    );
  }
}
