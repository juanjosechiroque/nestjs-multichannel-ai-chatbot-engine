import { Injectable, Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../../common/application-error';
import { PrismaService } from '../../database/prisma.service';

export interface WhatsAppInboundMessage {
  wabaId: string;
  messageId: string;
  phoneNumberId: string;
  recipientPhoneNumber: string;
  messageType: string;
  text?: string;
  customerName?: string;
}

export interface WhatsAppWebhookReceipt {
  acceptedMessages: WhatsAppInboundMessage[];
  duplicateMessages: number;
}

@Injectable()
export class WhatsAppWebhookReceiptService {
  private readonly logger = new Logger(WhatsAppWebhookReceiptService.name);

  constructor(private readonly prisma: PrismaService) {}

  async reserve(payload: unknown): Promise<WhatsAppWebhookReceipt> {
    const messages = this.extractMessages(payload);
    const acceptedMessages: WhatsAppInboundMessage[] = [];
    let duplicateMessages = 0;

    for (const message of messages) {
      try {
        await this.prisma.whatsAppWebhookMessage.create({
          data: { wabaId: message.wabaId, messageId: message.messageId },
        });
        acceptedMessages.push(message);
      } catch (error: unknown) {
        if (this.isUniqueConstraintError(error)) {
          duplicateMessages += 1;
          continue;
        }

        this.logger.error({
          event: 'database.operation.failed',
          operation: 'whatsapp.webhook_message.reserve',
          failureCode: 'DATABASE_UNAVAILABLE',
          message: error instanceof Error ? error.message : 'Unknown PostgreSQL error',
        });
        throw new DatabaseUnavailableException();
      }
    }

    this.logger.log({
      event: 'whatsapp.webhook.messages.reserved',
      messages: messages.length,
      acceptedMessages: acceptedMessages.length,
      duplicateMessages,
    });

    return { acceptedMessages, duplicateMessages };
  }

  async release(message: WhatsAppInboundMessage): Promise<void> {
    try {
      await this.prisma.whatsAppWebhookMessage.deleteMany({
        where: { wabaId: message.wabaId, messageId: message.messageId },
      });
      this.logger.warn({ event: 'whatsapp.webhook.message.reservation.released' });
    } catch (error: unknown) {
      this.logger.error({
        event: 'database.operation.failed',
        operation: 'whatsapp.webhook_message.release',
        failureCode: 'DATABASE_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'Unknown PostgreSQL error',
      });
      throw new DatabaseUnavailableException();
    }
  }

  private extractMessages(payload: unknown): WhatsAppInboundMessage[] {
    if (!this.isRecord(payload) || !Array.isArray(payload.entry)) return [];

    const messages: WhatsAppInboundMessage[] = [];
    for (const entry of payload.entry) {
      if (
        !this.isRecord(entry) ||
        !this.isIdentifier(entry.id, 64) ||
        !Array.isArray(entry.changes)
      ) {
        continue;
      }

      for (const change of entry.changes) {
        if (!this.isRecord(change) || !this.isRecord(change.value)) continue;
        const metadata = change.value.metadata;
        const valueMessages = change.value.messages;
        if (
          !this.isRecord(metadata) ||
          !this.isPhoneNumber(metadata.phone_number_id) ||
          !Array.isArray(valueMessages)
        ) {
          continue;
        }

        const contactNames = this.extractContactNames(change.value.contacts);

        for (const message of valueMessages) {
          if (
            !this.isRecord(message) ||
            !this.isIdentifier(message.id, 255) ||
            !this.isPhoneNumber(message.from)
          ) {
            continue;
          }
          const messageType = this.isIdentifier(message.type, 64) ? message.type : 'unknown';
          const text = this.extractText(messageType, message.text);
          const customerName = contactNames.get(message.from);
          messages.push({
            wabaId: entry.id,
            messageId: message.id,
            phoneNumberId: metadata.phone_number_id,
            recipientPhoneNumber: message.from,
            messageType,
            ...(text ? { text } : {}),
            ...(customerName ? { customerName } : {}),
          });
        }
      }
    }

    return messages;
  }

  private extractContactNames(value: unknown): Map<string, string> {
    const contacts = new Map<string, string>();
    if (!Array.isArray(value)) return contacts;

    for (const contact of value) {
      if (
        !this.isRecord(contact) ||
        !this.isPhoneNumber(contact.wa_id) ||
        !this.isRecord(contact.profile)
      ) {
        continue;
      }
      const name = contact.profile.name;
      if (typeof name !== 'string') continue;
      const normalizedName = name.trim();
      if (normalizedName.length === 0 || normalizedName.length > 100) continue;
      contacts.set(contact.wa_id, normalizedName);
    }

    return contacts;
  }

  private extractText(messageType: string, value: unknown): string | undefined {
    if (messageType !== 'text' || !this.isRecord(value) || typeof value.body !== 'string') {
      return undefined;
    }
    const text = value.body.trim();
    return text.length > 0 && text.length <= 2_000 ? text : undefined;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isIdentifier(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
  }

  private isPhoneNumber(value: unknown): value is string {
    return typeof value === 'string' && /^\d{5,20}$/.test(value);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }
}
