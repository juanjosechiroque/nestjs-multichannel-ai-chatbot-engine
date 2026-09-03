import { Controller, ForbiddenException, Get, Logger, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/api-error-response.dto';
import { WhatsAppWebhookVerificationDto } from './dto/whatsapp-webhook-verification.dto';

@ApiTags('WhatsApp webhooks')
@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;

  constructor(config: ConfigService) {
    this.verifyToken = config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
  }

  @Get()
  @ApiOperation({ summary: 'Verify the WhatsApp webhook callback with Meta' })
  @ApiQuery({ name: 'hub.mode', example: 'subscribe' })
  @ApiQuery({ name: 'hub.verify_token', description: 'Private callback verification token.' })
  @ApiQuery({ name: 'hub.challenge', example: '123456789' })
  @ApiOkResponse({
    description: 'The exact challenge sent by Meta.',
    schema: { type: 'string', example: '123456789' },
  })
  @ApiBadRequestResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  verify(@Query() query: WhatsAppWebhookVerificationDto): string {
    if (query['hub.mode'] !== 'subscribe' || query['hub.verify_token'] !== this.verifyToken) {
      this.logger.warn({ event: 'whatsapp.webhook.verification.failed' });
      throw new ForbiddenException('Invalid WhatsApp webhook verification');
    }

    this.logger.log({ event: 'whatsapp.webhook.verification.completed' });
    return query['hub.challenge'];
  }
}
