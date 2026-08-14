import { Injectable, Logger } from '@nestjs/common';
import type { RequestContext } from '../common/request-context';
import { executeDatabaseOperation } from '../database/database-operation';
import { PrismaService } from '../database/prisma.service';
import { MessageRole } from '../generated/prisma/enums';
import type { ChatHistoryMessage, SaveExchangeInput } from './memory.types';

const RECENT_MESSAGE_LIMIT = 10;

@Injectable()
export class MemoryService {
  private readonly logger = new Logger(MemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRecentMessages(
    conversationId: string,
    context: RequestContext,
  ): Promise<ChatHistoryMessage[]> {
    const startedAt = Date.now();
    const correlatedContext = { ...context, conversationId };
    const messages = await executeDatabaseOperation(
      {
        logger: this.logger,
        operation: 'memory.history.read',
        context: correlatedContext,
      },
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

    this.logger.log({
      event: 'memory.history.loaded',
      ...correlatedContext,
      durationMs: Date.now() - startedAt,
      messages: messages.length,
    });

    return messages.reverse().map((message) => ({
      role: message.role === MessageRole.USER ? 'user' : 'assistant',
      content: message.content,
    }));
  }

  async saveExchange(
    { conversationId, userMessage, assistantMessage }: SaveExchangeInput,
    context: RequestContext,
  ): Promise<void> {
    const startedAt = Date.now();
    const correlatedContext = { ...context, conversationId };
    await executeDatabaseOperation(
      {
        logger: this.logger,
        operation: 'memory.exchange.write',
        context: correlatedContext,
      },
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

    this.logger.log({
      event: 'memory.exchange.saved',
      ...correlatedContext,
      durationMs: Date.now() - startedAt,
    });
  }
}
