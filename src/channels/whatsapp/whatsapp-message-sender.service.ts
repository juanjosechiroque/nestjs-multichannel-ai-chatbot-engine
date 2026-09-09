import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDeliveryFailedException } from '../../common/application-error';
import type { WhatsAppInboundMessage } from './whatsapp-webhook-receipt.service';

@Injectable()
export class WhatsAppMessageSenderService {
  private readonly logger = new Logger(WhatsAppMessageSenderService.name);
  private readonly accessToken: string;
  private readonly graphApiVersion: string;

  constructor(config: ConfigService) {
    this.accessToken = config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    this.graphApiVersion = config.getOrThrow<string>('WHATSAPP_GRAPH_API_VERSION');
  }

  async sendText(message: WhatsAppInboundMessage, text: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${this.graphApiVersion}/${message.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: message.recipientPhoneNumber,
            type: 'text',
            text: { body: text },
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error: unknown) {
      this.logFailure(error instanceof Error ? error.message : 'Unknown network error');
      throw new WhatsAppDeliveryFailedException();
    }

    if (!response.ok) {
      this.logFailure(`Meta Graph API returned HTTP ${response.status}`);
      throw new WhatsAppDeliveryFailedException();
    }

    this.logger.log({ event: 'whatsapp.message.text.sent' });
  }

  private logFailure(message: string): void {
    this.logger.error({
      event: 'whatsapp.message.delivery.failed',
      failureCode: 'WHATSAPP_DELIVERY_FAILED',
      message,
    });
  }
}
