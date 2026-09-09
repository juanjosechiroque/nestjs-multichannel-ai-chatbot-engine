import { Logger } from '@nestjs/common';
import { WhatsAppDeliveryFailedException } from '../../common/application-error';
import type { PrismaService } from '../../database/prisma.service';
import { WhatsAppOutboundStatus } from '../../generated/prisma/enums';
import { WhatsAppOutboundMessageService } from './whatsapp-outbound-message.service';
import type { WhatsAppInboundMessage } from './whatsapp-webhook-receipt.service';

const WEBHOOK_RECEIVED_AT = new Date('2026-08-31T17:00:00.000Z');
const CUSTOMER_SENT_AT = new Date('2026-08-31T16:59:59.000Z');
const PROVIDER_ACCEPTED_AT = new Date('2026-08-31T17:00:03.000Z');
const MESSAGE: WhatsAppInboundMessage = {
  wabaId: 'waba-private',
  messageId: 'wamid.inbound-private',
  phoneNumberId: '1220572421149962',
  recipientPhoneNumber: '51999999999',
  messageType: 'text',
  webhookReceivedAt: WEBHOOK_RECEIVED_AT,
  customerSentAt: CUSTOMER_SENT_AT,
  text: 'Mensaje privado',
};

const upsert = jest.fn();
const update = jest.fn();
const findUnique = jest.fn();
const updateMany = jest.fn();
const sendText = jest.fn();

function createService(): WhatsAppOutboundMessageService {
  return new WhatsAppOutboundMessageService(
    {
      whatsAppOutboundMessage: { upsert, update, findUnique, updateMany },
    } as unknown as PrismaService,
    { sendText },
  );
}

function statusNotification(
  statuses: Array<{ id: string; status: string; timestamp: string; errors?: unknown[] }>,
): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [{ id: 'waba-private', changes: [{ field: 'messages', value: { statuses } }] }],
  };
}

function persistedOutbound(status: WhatsAppOutboundStatus) {
  return {
    id: 'outbound-1',
    status,
    webhookReceivedAt: WEBHOOK_RECEIVED_AT,
    providerAcceptedAt: PROVIDER_ACCEPTED_AT,
  };
}

describe('WhatsAppOutboundMessageService', () => {
  beforeEach(() => {
    upsert.mockReset().mockResolvedValue({ id: 'outbound-1' });
    update.mockReset().mockResolvedValue({});
    findUnique.mockReset();
    updateMany.mockReset().mockResolvedValue({ count: 1 });
    sendText.mockReset().mockResolvedValue({ providerMessageId: 'wamid.outbound-private' });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('persists provider acceptance and latency without storing message or phone content', async () => {
    jest.useFakeTimers().setSystemTime(PROVIDER_ACCEPTED_AT);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService();

    await service.sendText(MESSAGE, 'Respuesta segura');

    expect(upsert).toHaveBeenCalledWith({
      where: {
        wabaId_inboundMessageId: {
          wabaId: 'waba-private',
          inboundMessageId: 'wamid.inbound-private',
        },
      },
      create: {
        wabaId: 'waba-private',
        inboundMessageId: 'wamid.inbound-private',
        webhookReceivedAt: WEBHOOK_RECEIVED_AT,
        customerSentAt: CUSTOMER_SENT_AT,
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
    });
    expect(sendText).toHaveBeenCalledWith({
      phoneNumberId: '1220572421149962',
      recipientPhoneNumber: '51999999999',
      text: 'Respuesta segura',
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'outbound-1' },
      data: {
        status: WhatsAppOutboundStatus.ACCEPTED,
        providerMessageId: 'wamid.outbound-private',
        providerAcceptedAt: PROVIDER_ACCEPTED_AT,
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp.outbound.accepted',
        providerMessageTracked: true,
        webhookToProviderAcceptedMs: 3_000,
        customerToProviderAcceptedMs: 4_000,
      }),
    );
    expect(JSON.stringify(upsert.mock.calls)).not.toContain('Mensaje privado');
    expect(JSON.stringify(log.mock.calls)).not.toContain('51999999999');
  });

  it('converts an unexpected provider failure into a safe exception without leaking details', async () => {
    jest.useFakeTimers().setSystemTime(PROVIDER_ACCEPTED_AT);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    sendText.mockRejectedValueOnce(new Error('private provider response and token'));
    const service = createService();

    await expect(service.sendText(MESSAGE, 'Respuesta segura')).rejects.toEqual(
      new WhatsAppDeliveryFailedException(),
    );
    expect(update).toHaveBeenCalledWith({
      where: { id: 'outbound-1' },
      data: {
        status: WhatsAppOutboundStatus.FAILED,
        failedAt: PROVIDER_ACCEPTED_AT,
        failureCode: 'WHATSAPP_DELIVERY_FAILED',
      },
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private provider response');
    expect(JSON.stringify(error.mock.calls)).not.toContain('51999999999');
    expect(JSON.stringify(error.mock.calls)).not.toContain('Respuesta segura');
  });

  it('marks a Meta delivered event and records delivery latency', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    findUnique.mockResolvedValueOnce(persistedOutbound(WhatsAppOutboundStatus.ACCEPTED));
    const service = createService();

    await expect(
      service.processStatuses(
        statusNotification([
          { id: 'wamid.outbound-private', status: 'delivered', timestamp: '1788195605' },
        ]),
      ),
    ).resolves.toEqual({ receivedStatuses: 1, updatedStatuses: 1, ignoredStatuses: 0 });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbound-1', status: WhatsAppOutboundStatus.ACCEPTED },
      data: {
        status: WhatsAppOutboundStatus.DELIVERED,
        deliveredAt: new Date(1_788_195_605_000),
      },
    });
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'whatsapp.outbound.status.updated',
        status: 'delivered',
      }),
    );
  });

  it('ignores duplicate, unknown, and regressive delivery events', async () => {
    findUnique
      .mockResolvedValueOnce(persistedOutbound(WhatsAppOutboundStatus.DELIVERED))
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(persistedOutbound(WhatsAppOutboundStatus.DELIVERED));
    const service = createService();

    await expect(
      service.processStatuses(
        statusNotification([
          { id: 'wamid.outbound-private', status: 'delivered', timestamp: '1788195605' },
          { id: 'wamid.unknown', status: 'read', timestamp: '1788195606' },
          { id: 'wamid.outbound-private', status: 'sent', timestamp: '1788195604' },
        ]),
      ),
    ).resolves.toEqual({ receivedStatuses: 3, updatedStatuses: 0, ignoredStatuses: 3 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('persists a safe Meta failure code without provider error text', async () => {
    findUnique.mockResolvedValueOnce(persistedOutbound(WhatsAppOutboundStatus.SENT));
    const service = createService();

    await service.processStatuses(
      statusNotification([
        {
          id: 'wamid.outbound-private',
          status: 'failed',
          timestamp: '1788195605',
          errors: [{ code: 131_047, title: 'private provider detail' }],
        },
      ]),
    );

    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'outbound-1', status: WhatsAppOutboundStatus.SENT },
      data: {
        status: WhatsAppOutboundStatus.FAILED,
        failedAt: new Date(1_788_195_605_000),
        failureCode: '131047',
      },
    });
    expect(JSON.stringify(updateMany.mock.calls)).not.toContain('private provider detail');
  });
});
