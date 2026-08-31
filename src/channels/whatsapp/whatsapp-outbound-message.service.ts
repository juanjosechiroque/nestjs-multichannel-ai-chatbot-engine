import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  getApplicationFailureCode,
  WhatsAppDeliveryFailedException,
} from '../../common/application-error';
import { executeDatabaseOperation } from '../../database/database-operation';
import { PrismaService } from '../../database/prisma.service';
import { WhatsAppOutboundStatus } from '../../generated/prisma/enums';
import { WHATSAPP_PROVIDER, type WhatsAppProvider } from './providers/whatsapp-provider';
import type { WhatsAppInboundMessage } from './whatsapp-webhook-receipt.service';

type MetaDeliveryStatus = 'sent' | 'delivered' | 'read' | 'failed';

interface MetaDeliveryStatusEvent {
  providerMessageId: string;
  status: MetaDeliveryStatus;
  occurredAt: Date;
  failureCode?: string;
}

export interface WhatsAppDeliveryStatusReceipt {
  receivedStatuses: number;
  updatedStatuses: number;
  ignoredStatuses: number;
}

const STATUS_RANK: Record<WhatsAppOutboundStatus, number> = {
  [WhatsAppOutboundStatus.PENDING]: 0,
  [WhatsAppOutboundStatus.ACCEPTED]: 1,
  [WhatsAppOutboundStatus.SENT]: 2,
  [WhatsAppOutboundStatus.DELIVERED]: 3,
  [WhatsAppOutboundStatus.READ]: 4,
  [WhatsAppOutboundStatus.FAILED]: 5,
};

@Injectable()
export class WhatsAppOutboundMessageService {
  private readonly logger = new Logger(WhatsAppOutboundMessageService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(WHATSAPP_PROVIDER) private readonly provider: WhatsAppProvider,
  ) {}

  async sendText(message: WhatsAppInboundMessage, text: string): Promise<void> {
    const outbound = await this.database('whatsapp.outbound.prepare', () =>
      this.prisma.whatsAppOutboundMessage.upsert({
        where: {
          wabaId_inboundMessageId: {
            wabaId: message.wabaId,
            inboundMessageId: message.messageId,
          },
        },
        create: {
          wabaId: message.wabaId,
          inboundMessageId: message.messageId,
          webhookReceivedAt: message.webhookReceivedAt,
          ...(message.customerSentAt ? { customerSentAt: message.customerSentAt } : {}),
        },
        update: {
          status: WhatsAppOutboundStatus.PENDING,
          attemptCount: { increment: 1 },
          providerMessageId: null,
          providerAcceptedAt: null,
          sentAt: null,
          deliveredAt: null,
          readAt: null,
          failedAt: null,
          failureCode: null,
        },
      }),
    );
    const providerStartedAt = Date.now();
    let result: Awaited<ReturnType<WhatsAppProvider['sendText']>>;

    try {
      result = await this.provider.sendText({
        phoneNumberId: message.phoneNumberId,
        recipientPhoneNumber: message.recipientPhoneNumber,
        text,
      });
    } catch (error: unknown) {
      const failure =
        error instanceof WhatsAppDeliveryFailedException
          ? error
          : new WhatsAppDeliveryFailedException();
      const failedAt = new Date();
      await this.database('whatsapp.outbound.fail', () =>
        this.prisma.whatsAppOutboundMessage.update({
          where: { id: outbound.id },
          data: {
            status: WhatsAppOutboundStatus.FAILED,
            failedAt,
            failureCode: getApplicationFailureCode(failure) ?? 'WHATSAPP_DELIVERY_FAILED',
          },
        }),
      );
      this.logger.error({
        event: 'whatsapp.outbound.failed',
        failureCode: failure.failureCode,
        providerApiLatencyMs: Date.now() - providerStartedAt,
        webhookToFailureMs: this.elapsed(message.webhookReceivedAt, failedAt),
      });
      throw failure;
    }

    const acceptedAt = new Date();
    await this.database('whatsapp.outbound.accept', () =>
      this.prisma.whatsAppOutboundMessage.update({
        where: { id: outbound.id },
        data: {
          status: WhatsAppOutboundStatus.ACCEPTED,
          providerMessageId: result.providerMessageId,
          providerAcceptedAt: acceptedAt,
        },
      }),
    );

    this.logger.log({
      event: 'whatsapp.outbound.accepted',
      providerMessageTracked: true,
      providerApiLatencyMs: Date.now() - providerStartedAt,
      webhookToProviderAcceptedMs: this.elapsed(message.webhookReceivedAt, acceptedAt),
      ...(message.customerSentAt
        ? { customerToProviderAcceptedMs: this.elapsed(message.customerSentAt, acceptedAt) }
        : {}),
    });
  }

  async processStatuses(payload: unknown): Promise<WhatsAppDeliveryStatusReceipt> {
    const events = this.extractStatusEvents(payload);
    let updatedStatuses = 0;

    for (const event of events) {
      if (await this.applyStatus(event)) updatedStatuses += 1;
    }

    const receipt = {
      receivedStatuses: events.length,
      updatedStatuses,
      ignoredStatuses: events.length - updatedStatuses,
    };
    if (events.length > 0) {
      this.logger.log({ event: 'whatsapp.outbound.statuses.processed', ...receipt });
    }
    return receipt;
  }

  private async applyStatus(event: MetaDeliveryStatusEvent): Promise<boolean> {
    const targetStatus = this.toPersistenceStatus(event.status);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const outbound = await this.database('whatsapp.outbound.status.read', () =>
        this.prisma.whatsAppOutboundMessage.findUnique({
          where: { providerMessageId: event.providerMessageId },
        }),
      );
      if (!outbound || !this.canAdvance(outbound.status, targetStatus)) return false;

      const updated = await this.database('whatsapp.outbound.status.update', () =>
        this.prisma.whatsAppOutboundMessage.updateMany({
          where: { id: outbound.id, status: outbound.status },
          data: this.statusUpdate(event, targetStatus),
        }),
      );
      if (updated.count === 0) continue;

      this.logger.log({
        event: 'whatsapp.outbound.status.updated',
        status: event.status,
        webhookToStatusMs: this.elapsed(outbound.webhookReceivedAt, event.occurredAt),
        ...(outbound.providerAcceptedAt
          ? { providerToStatusMs: this.elapsed(outbound.providerAcceptedAt, event.occurredAt) }
          : {}),
        ...(event.failureCode ? { failureCode: event.failureCode } : {}),
      });
      return true;
    }

    return false;
  }

  private statusUpdate(event: MetaDeliveryStatusEvent, status: WhatsAppOutboundStatus) {
    if (status === WhatsAppOutboundStatus.SENT) {
      return { status, sentAt: event.occurredAt };
    }
    if (status === WhatsAppOutboundStatus.DELIVERED) {
      return { status, deliveredAt: event.occurredAt };
    }
    if (status === WhatsAppOutboundStatus.READ) {
      return { status, readAt: event.occurredAt };
    }
    return {
      status,
      failedAt: event.occurredAt,
      failureCode: event.failureCode ?? 'META_DELIVERY_FAILED',
    };
  }

  private canAdvance(current: WhatsAppOutboundStatus, target: WhatsAppOutboundStatus): boolean {
    if (
      current === WhatsAppOutboundStatus.READ ||
      current === WhatsAppOutboundStatus.FAILED ||
      current === target
    ) {
      return false;
    }
    if (target === WhatsAppOutboundStatus.FAILED) {
      return STATUS_RANK[current] < STATUS_RANK[WhatsAppOutboundStatus.DELIVERED];
    }
    return STATUS_RANK[target] > STATUS_RANK[current];
  }

  private toPersistenceStatus(status: MetaDeliveryStatus): WhatsAppOutboundStatus {
    const statuses: Record<MetaDeliveryStatus, WhatsAppOutboundStatus> = {
      sent: WhatsAppOutboundStatus.SENT,
      delivered: WhatsAppOutboundStatus.DELIVERED,
      read: WhatsAppOutboundStatus.READ,
      failed: WhatsAppOutboundStatus.FAILED,
    };
    return statuses[status];
  }

  private extractStatusEvents(payload: unknown): MetaDeliveryStatusEvent[] {
    if (!this.isRecord(payload) || !Array.isArray(payload.entry)) return [];

    const events: MetaDeliveryStatusEvent[] = [];
    for (const entry of payload.entry) {
      if (!this.isRecord(entry) || !Array.isArray(entry.changes)) continue;
      for (const change of entry.changes) {
        if (!this.isRecord(change) || !this.isRecord(change.value)) continue;
        const statuses = change.value.statuses;
        if (!Array.isArray(statuses)) continue;
        for (const status of statuses) {
          const event = this.toStatusEvent(status);
          if (event) events.push(event);
        }
      }
    }
    return events;
  }

  private toStatusEvent(value: unknown): MetaDeliveryStatusEvent | undefined {
    if (
      !this.isRecord(value) ||
      !this.isIdentifier(value.id, 255) ||
      !this.isMetaStatus(value.status)
    ) {
      return undefined;
    }
    const occurredAt = this.parseMetaTimestamp(value.timestamp);
    if (!occurredAt) return undefined;
    const failureCode = this.extractFailureCode(value.errors);
    return {
      providerMessageId: value.id,
      status: value.status,
      occurredAt,
      ...(failureCode ? { failureCode } : {}),
    };
  }

  private extractFailureCode(value: unknown): string | undefined {
    if (!Array.isArray(value) || !this.isRecord(value[0])) return undefined;
    const code = value[0].code;
    if (typeof code !== 'string' && typeof code !== 'number') return undefined;
    return String(code).slice(0, 100);
  }

  private parseMetaTimestamp(value: unknown): Date | undefined {
    if (typeof value !== 'string' || !/^\d{1,12}$/.test(value)) return undefined;
    const milliseconds = Number(value) * 1_000;
    if (!Number.isSafeInteger(milliseconds)) return undefined;
    const timestamp = new Date(milliseconds);
    return Number.isNaN(timestamp.getTime()) ? undefined : timestamp;
  }

  private isMetaStatus(value: unknown): value is MetaDeliveryStatus {
    return value === 'sent' || value === 'delivered' || value === 'read' || value === 'failed';
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private isIdentifier(value: unknown, maxLength: number): value is string {
    return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
  }

  private elapsed(start: Date, end: Date): number {
    return Math.max(0, end.getTime() - start.getTime());
  }

  private database<T>(operation: string, execute: () => Promise<T>): Promise<T> {
    return executeDatabaseOperation({ logger: this.logger, operation }, execute);
  }
}
