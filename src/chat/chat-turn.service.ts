import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { ConversationTurnStatus, MessageRole } from '../generated/prisma/enums';
import {
  ChatTurnInProgressError,
  ChatTurnMessageConflictError,
  ChatTurnPreviouslyFailedError,
} from './chat-turn.errors';
import type { ChatContent, ChatResult } from './chat.types';

export interface StartChatTurnInput {
  conversationId: string;
  messageId: string;
  message: string;
}

export type ChatTurnReservation = { kind: 'started' } | { kind: 'replay'; result: ChatResult };

export interface CompleteChatTurnInput {
  conversationId: string;
  messageId: string;
  userMessage: string;
  result: ChatResult;
}

@Injectable()
export class ChatTurnService {
  private readonly logger = new Logger(ChatTurnService.name);

  constructor(private readonly prisma: PrismaService) {}

  async start(input: StartChatTurnInput, context: RequestContext): Promise<ChatTurnReservation> {
    const messageHash = this.hash(input.message);

    try {
      await this.prisma.conversationTurn.create({
        data: {
          conversationId: input.conversationId,
          messageId: input.messageId,
          messageHash,
        },
      });
      this.logger.log({
        event: 'chat.turn.started',
        ...context,
        messageId: input.messageId,
      });
      return { kind: 'started' };
    } catch (error: unknown) {
      if (!this.isUniqueConstraintError(error)) {
        throw this.databaseFailure('chat.turn.start', context, error);
      }
    }

    const existing = await this.readExisting(input.conversationId, input.messageId, context);
    if (existing.messageHash !== messageHash) {
      throw new ChatTurnMessageConflictError(input.messageId);
    }
    if (existing.status === ConversationTurnStatus.PROCESSING) {
      throw new ChatTurnInProgressError(input.messageId);
    }
    if (existing.status === ConversationTurnStatus.FAILED) {
      throw new ChatTurnPreviouslyFailedError(input.messageId);
    }

    const result = this.parseStoredResult(existing.response);
    this.logger.log({
      event: 'chat.turn.replayed',
      ...context,
      messageId: input.messageId,
    });
    return { kind: 'replay', result };
  }

  async complete(input: CompleteChatTurnInput, context: RequestContext): Promise<void> {
    const response = this.toStoredResult(input.result);

    try {
      await this.prisma.$transaction(async (transaction) => {
        const updated = await transaction.conversationTurn.updateMany({
          where: {
            conversationId: input.conversationId,
            messageId: input.messageId,
            status: ConversationTurnStatus.PROCESSING,
          },
          data: {
            status: ConversationTurnStatus.COMPLETED,
            response,
          },
        });
        if (updated.count !== 1) {
          throw new Error('Conversation turn is not processing');
        }

        await transaction.conversation.update({
          where: { id: input.conversationId },
          data: {
            messages: {
              create: [
                { role: MessageRole.USER, content: input.userMessage },
                { role: MessageRole.ASSISTANT, content: input.result.reply },
              ],
            },
          },
        });
      });
    } catch (error: unknown) {
      throw this.databaseFailure('chat.turn.complete', context, error);
    }

    this.logger.log({
      event: 'chat.turn.completed',
      ...context,
      messageId: input.messageId,
    });
  }

  async fail(
    conversationId: string,
    messageId: string,
    failureCode: string,
    context: RequestContext,
  ): Promise<void> {
    try {
      await this.prisma.conversationTurn.updateMany({
        where: {
          conversationId,
          messageId,
          status: ConversationTurnStatus.PROCESSING,
        },
        data: {
          status: ConversationTurnStatus.FAILED,
        },
      });
    } catch (error: unknown) {
      throw this.databaseFailure('chat.turn.fail', context, error);
    }

    this.logger.warn({
      event: 'chat.turn.failed',
      ...context,
      messageId,
      failureCode,
    });
  }

  private async readExisting(conversationId: string, messageId: string, context: RequestContext) {
    try {
      const turn = await this.prisma.conversationTurn.findUnique({
        where: { conversationId_messageId: { conversationId, messageId } },
        select: {
          messageHash: true,
          status: true,
          response: true,
        },
      });
      if (!turn) {
        throw new Error('Unique conversation turn could not be read');
      }
      return turn;
    } catch (error: unknown) {
      throw this.databaseFailure('chat.turn.read', context, error);
    }
  }

  private toStoredResult(result: ChatResult): Prisma.InputJsonObject {
    return {
      reply: result.reply,
      ...(result.content
        ? {
            content: result.content.map((item) => ({
              type: item.type,
              title: item.title,
              url: item.url,
              mimeType: item.mimeType,
            })),
          }
        : {}),
    };
  }

  private parseStoredResult(value: Prisma.JsonValue | null): ChatResult {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new DatabaseUnavailableException();
    }

    const stored = value;
    if (typeof stored.reply !== 'string') {
      throw new DatabaseUnavailableException();
    }

    const content = this.parseContent(stored.content);
    return {
      reply: stored.reply,
      ...(content ? { content } : {}),
    };
  }

  private parseContent(value: Prisma.JsonValue | undefined): ChatContent[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw new DatabaseUnavailableException();

    return value.map((item) => {
      if (
        !item ||
        typeof item !== 'object' ||
        Array.isArray(item) ||
        item.type !== 'document' ||
        typeof item.title !== 'string' ||
        typeof item.url !== 'string' ||
        item.mimeType !== 'application/pdf'
      ) {
        throw new DatabaseUnavailableException();
      }
      return {
        type: 'document',
        title: item.title,
        url: item.url,
        mimeType: 'application/pdf',
      };
    });
  }

  private hash(message: string): string {
    return createHash('sha256').update(message).digest('hex');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }

  private databaseFailure(
    operation: string,
    context: RequestContext,
    error: unknown,
  ): DatabaseUnavailableException {
    this.logger.error({
      event: 'database.operation.failed',
      ...context,
      operation,
      failureCode: 'DATABASE_UNAVAILABLE',
      message: error instanceof Error ? error.message : 'Unknown PostgreSQL error',
    });
    return new DatabaseUnavailableException();
  }
}
