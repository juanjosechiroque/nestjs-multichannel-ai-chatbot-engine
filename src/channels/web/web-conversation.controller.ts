import { randomUUID } from 'node:crypto';
import { Controller, Post, UseGuards } from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiCreatedResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/api-error-response.dto';
import { ConversationService } from '../../conversation/conversation.service';
import { CreateWebConversationResponseDto } from './dto/web-chat-response.dto';
import { CHAT_RATE_LIMIT_NAME } from './web-rate-limit';

@ApiTags('Web conversations')
@SkipThrottle({ [CHAT_RATE_LIMIT_NAME]: true })
@UseGuards(ThrottlerGuard)
@Controller('conversations')
export class WebConversationController {
  constructor(private readonly conversations: ConversationService) {}

  @Post()
  @ApiOperation({ summary: 'Create a backend-managed web conversation' })
  @ApiCreatedResponse({ type: CreateWebConversationResponseDto })
  @ApiTooManyRequestsResponse({ type: ApiErrorResponseDto })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  async create(): Promise<CreateWebConversationResponseDto> {
    const conversation = await this.conversations.create('web', {
      requestId: randomUUID(),
      channel: 'web',
    });

    return { sessionId: conversation.sessionId };
  }
}
