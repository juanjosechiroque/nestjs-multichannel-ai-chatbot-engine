import { randomUUID } from 'node:crypto';
import {
  Body,
  ConflictException,
  Controller,
  NotFoundException,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ChatService } from '../../chat/chat.service';
import type { ChatResult } from '../../chat/chat.types';
import {
  ChatTurnInProgressError,
  ChatTurnMessageConflictError,
  ChatTurnPreviouslyFailedError,
} from '../../chat/chat-turn.errors';
import { ApiErrorResponseDto } from '../../common/api-error-response.dto';
import { ConversationService } from '../../conversation/conversation.service';
import { WebChatMessageDto } from './dto/web-chat-message.dto';
import { WebChatResponseDto } from './dto/web-chat-response.dto';
import { CONVERSATION_RATE_LIMIT_NAME } from './web-rate-limit';
import { WebResponseAdapter, type WebChatResponse } from './web-response.adapter';

@ApiTags('Web chat')
@SkipThrottle({ [CONVERSATION_RATE_LIMIT_NAME]: true })
@UseGuards(ThrottlerGuard)
@Controller('chat')
export class WebChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly conversations: ConversationService,
    private readonly responseAdapter: WebResponseAdapter,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Send an idempotent message to the web chatbot' })
  @ApiCreatedResponse({ type: WebChatResponseDto })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
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

    let result: ChatResult;
    try {
      result = await this.chatService.reply({
        requestId,
        messageId: input.messageId,
        conversationId: conversation.id,
        channel: 'web',
        message: input.message,
      });
    } catch (error: unknown) {
      if (error instanceof ChatTurnInProgressError) {
        throw new ConflictException(
          'Este mensaje todavía se está procesando. Inténtalo nuevamente en unos segundos.',
        );
      }
      if (error instanceof ChatTurnMessageConflictError) {
        throw new ConflictException('El messageId ya fue utilizado con un mensaje diferente.');
      }
      if (error instanceof ChatTurnPreviouslyFailedError) {
        throw new ConflictException(
          'Este mensaje ya terminó con error. Reintenta con un messageId nuevo.',
        );
      }
      throw error;
    }

    return this.responseAdapter.adapt(result);
  }
}
