import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDeliveryFailedException } from '../../../common/application-error';
import type {
  SendWhatsAppTextInput,
  SendWhatsAppTextResult,
  WhatsAppProvider,
} from './whatsapp-provider';

@Injectable()
export class MetaWhatsAppClient implements WhatsAppProvider {
  private readonly logger = new Logger(MetaWhatsAppClient.name);
  private readonly accessToken: string;
  private readonly graphApiVersion: string;

  constructor(config: ConfigService) {
    this.accessToken = config.getOrThrow<string>('WHATSAPP_ACCESS_TOKEN');
    this.graphApiVersion = config.getOrThrow<string>('WHATSAPP_GRAPH_API_VERSION');
  }

  async sendText({
    phoneNumberId,
    recipientPhoneNumber,
    text,
  }: SendWhatsAppTextInput): Promise<SendWhatsAppTextResult> {
    let response: Response;
    try {
      response = await fetch(
        `https://graph.facebook.com/${this.graphApiVersion}/${phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: recipientPhoneNumber,
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

    const providerMessageId = await this.readProviderMessageId(response);
    if (!providerMessageId) {
      this.logFailure('Meta Graph API returned no message ID');
      throw new WhatsAppDeliveryFailedException();
    }
    this.logger.log({ event: 'whatsapp.provider.message.accepted', provider: 'meta' });
    return { providerMessageId };
  }

  private async readProviderMessageId(response: Response): Promise<string | undefined> {
    try {
      const body: unknown = await response.json();
      if (!this.isRecord(body) || !this.isUnknownArray(body.messages)) return undefined;
      const firstMessage = body.messages[0];
      return this.isRecord(firstMessage) && typeof firstMessage.id === 'string'
        ? firstMessage.id
        : undefined;
    } catch {
      return undefined;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isUnknownArray(value: unknown): value is unknown[] {
    return Array.isArray(value);
  }

  private logFailure(message: string): void {
    this.logger.error({
      event: 'whatsapp.provider.delivery.failed',
      provider: 'meta',
      failureCode: 'WHATSAPP_DELIVERY_FAILED',
      message,
    });
  }
}
