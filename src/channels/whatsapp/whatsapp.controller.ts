import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  Controller,
  Body,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  Query,
  Req,
  type RawBodyRequest,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../../common/api-error-response.dto';
import { WhatsAppWebhookVerificationDto } from './dto/whatsapp-webhook-verification.dto';
import { WhatsAppChatService } from './whatsapp-chat.service';
import { WhatsAppWebhookReceiptService } from './whatsapp-webhook-receipt.service';

@ApiTags('WhatsApp webhooks')
@Controller('webhook/whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);
  private readonly verifyToken: string;
  private readonly appSecret: string;

  constructor(
    config: ConfigService,
    private readonly webhookReceipts: WhatsAppWebhookReceiptService,
    private readonly whatsappChat: WhatsAppChatService,
  ) {
    this.verifyToken = config.getOrThrow<string>('WHATSAPP_VERIFY_TOKEN');
    this.appSecret = config.getOrThrow<string>('WHATSAPP_APP_SECRET');
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

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Authenticate and process a WhatsApp webhook notification' })
  @ApiHeader({
    name: 'X-Hub-Signature-256',
    description: 'Meta HMAC-SHA256 signature prefixed with sha256=.',
    required: true,
  })
  @ApiOkResponse({
    description: 'The signed notification was processed and acknowledged with an empty response.',
  })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  async receive(
    @Req() request: RawBodyRequest<Record<string, unknown>>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() payload: unknown,
  ): Promise<void> {
    if (!request.rawBody || !this.hasValidSignature(request.rawBody, signature)) {
      this.logger.warn({ event: 'whatsapp.webhook.signature.invalid' });
      throw new ForbiddenException('Invalid WhatsApp webhook signature');
    }

    const receipt = await this.webhookReceipts.reserve(payload);
    for (const message of receipt.acceptedMessages) {
      try {
        await this.whatsappChat.handle(message);
      } catch (error: unknown) {
        await this.webhookReceipts.release(message);
        throw error;
      }
    }

    this.logger.log({
      event: 'whatsapp.webhook.notification.acknowledged',
      acceptedMessages: receipt.acceptedMessages.length,
      duplicateMessages: receipt.duplicateMessages,
    });
  }

  private hasValidSignature(rawBody: Buffer, signature: string | undefined): boolean {
    if (!signature?.startsWith('sha256=')) return false;

    const signatureHex = signature.slice('sha256='.length);
    if (!/^[a-f\d]{64}$/i.test(signatureHex)) return false;

    const providedSignature = Buffer.from(signatureHex, 'hex');
    const expectedSignature = createHmac('sha256', this.appSecret).update(rawBody).digest();

    return (
      providedSignature.length === expectedSignature.length &&
      timingSafeEqual(providedSignature, expectedSignature)
    );
  }
}
