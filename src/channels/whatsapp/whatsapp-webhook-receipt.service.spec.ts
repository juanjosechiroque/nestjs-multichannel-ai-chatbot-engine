import { Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../../common/application-error';
import type { PrismaService } from '../../database/prisma.service';
import { WhatsAppWebhookReceiptService } from './whatsapp-webhook-receipt.service';

const create = jest.fn();
const deleteMany = jest.fn();
const RECEIVED_AT = new Date('2026-08-31T17:00:01.000Z');
const CUSTOMER_SENT_AT = new Date(1_788_195_600_000);

function createService(): WhatsAppWebhookReceiptService {
  return new WhatsAppWebhookReceiptService({
    whatsAppWebhookMessage: { create, deleteMany },
  } as unknown as PrismaService);
}

function notification(messageIds: string[]): unknown {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba-123',
        changes: [
          {
            field: 'messages',
            value: {
              metadata: { phone_number_id: '1220572421149962' },
              contacts: [
                {
                  wa_id: '51999999999',
                  profile: { name: 'Ana Cliente' },
                },
              ],
              messages: messageIds.map((id) => ({
                id,
                from: '51999999999',
                timestamp: '1788195600',
                type: 'text',
                text: { body: '¿Qué productos tienen?' },
              })),
            },
          },
        ],
      },
    ],
  };
}

describe('WhatsAppWebhookReceiptService', () => {
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ receivedAt: RECEIVED_AT });
    deleteMany.mockReset().mockResolvedValue({ count: 1 });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('reserves each incoming message using the WABA and Meta message IDs', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService();

    await expect(service.reserve(notification(['wamid.1', 'wamid.2']))).resolves.toEqual({
      acceptedMessages: [
        {
          wabaId: 'waba-123',
          messageId: 'wamid.1',
          phoneNumberId: '1220572421149962',
          recipientPhoneNumber: '51999999999',
          messageType: 'text',
          webhookReceivedAt: RECEIVED_AT,
          customerSentAt: CUSTOMER_SENT_AT,
          text: '¿Qué productos tienen?',
          customerName: 'Ana Cliente',
        },
        {
          wabaId: 'waba-123',
          messageId: 'wamid.2',
          phoneNumberId: '1220572421149962',
          recipientPhoneNumber: '51999999999',
          messageType: 'text',
          webhookReceivedAt: RECEIVED_AT,
          customerSentAt: CUSTOMER_SENT_AT,
          text: '¿Qué productos tienen?',
          customerName: 'Ana Cliente',
        },
      ],
      duplicateMessages: 0,
    });
    expect(create).toHaveBeenNthCalledWith(1, {
      data: { wabaId: 'waba-123', messageId: 'wamid.1' },
    });
    expect(create).toHaveBeenNthCalledWith(2, {
      data: { wabaId: 'waba-123', messageId: 'wamid.2' },
    });
  });

  it('acknowledges a repeated message as a duplicate without failing', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    create.mockRejectedValueOnce({ code: 'P2002' });
    const service = createService();

    await expect(service.reserve(notification(['wamid.duplicate']))).resolves.toEqual({
      acceptedMessages: [],
      duplicateMessages: 1,
    });
  });

  it('deduplicates repeated IDs contained in the same notification', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    create
      .mockResolvedValueOnce({ receivedAt: RECEIVED_AT })
      .mockRejectedValueOnce({ code: 'P2002' });
    const service = createService();

    await expect(
      service.reserve(notification(['wamid.repeated', 'wamid.repeated'])),
    ).resolves.toEqual({
      acceptedMessages: [
        {
          wabaId: 'waba-123',
          messageId: 'wamid.repeated',
          phoneNumberId: '1220572421149962',
          recipientPhoneNumber: '51999999999',
          messageType: 'text',
          webhookReceivedAt: RECEIVED_AT,
          customerSentAt: CUSTOMER_SENT_AT,
          text: '¿Qué productos tienen?',
          customerName: 'Ana Cliente',
        },
      ],
      duplicateMessages: 1,
    });
  });

  it('keeps unsupported message types so the channel can return a text fallback', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-123',
          changes: [
            {
              field: 'messages',
              value: {
                metadata: { phone_number_id: '1220572421149962' },
                contacts: [
                  {
                    wa_id: '51999999999',
                    profile: { name: 'Ana Cliente' },
                  },
                ],
                messages: [
                  {
                    id: 'wamid.image',
                    from: '51999999999',
                    type: 'image',
                    image: { id: 'media-123' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const service = createService();

    await expect(service.reserve(payload)).resolves.toEqual({
      acceptedMessages: [
        {
          wabaId: 'waba-123',
          messageId: 'wamid.image',
          phoneNumberId: '1220572421149962',
          recipientPhoneNumber: '51999999999',
          messageType: 'image',
          webhookReceivedAt: RECEIVED_AT,
          customerName: 'Ana Cliente',
        },
      ],
      duplicateMessages: 0,
    });
  });

  it.each([
    ['a status-only notification', { entry: [{ id: 'waba-123', changes: [{ value: {} }] }] }],
    ['a malformed payload', { entry: [{ id: 123, changes: 'invalid' }] }],
    ['an empty payload', undefined],
  ])('does not reserve messages for %s', async (_scenario, payload) => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = createService();

    await expect(service.reserve(payload)).resolves.toEqual({
      acceptedMessages: [],
      duplicateMessages: 0,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('returns a controlled failure when the receipt cannot be persisted', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    create.mockRejectedValueOnce(new Error('connection refused'));
    const service = createService();

    await expect(service.reserve(notification(['wamid.private']))).rejects.toEqual(
      new DatabaseUnavailableException(),
    );
    expect(log).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith({
      event: 'database.operation.failed',
      operation: 'whatsapp.webhook_message.reserve',
      failureCode: 'DATABASE_UNAVAILABLE',
      message: 'connection refused',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('wamid.private');
  });

  it('releases a reservation without logging message or phone identifiers', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const service = createService();

    await service.release({
      wabaId: 'waba-private',
      messageId: 'wamid.private',
      phoneNumberId: '1220572421149962',
      recipientPhoneNumber: '51999999999',
      messageType: 'text',
      webhookReceivedAt: RECEIVED_AT,
      text: 'Mensaje privado',
    });

    expect(deleteMany).toHaveBeenCalledWith({
      where: { wabaId: 'waba-private', messageId: 'wamid.private' },
    });
    expect(warn).toHaveBeenCalledWith({
      event: 'whatsapp.webhook.message.reservation.released',
    });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('wamid.private');
    expect(JSON.stringify(warn.mock.calls)).not.toContain('51999999999');
  });

  it('returns a controlled failure when a reservation cannot be released', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    deleteMany.mockRejectedValueOnce(new Error('connection refused'));
    const service = createService();

    await expect(
      service.release({
        wabaId: 'waba-123',
        messageId: 'wamid.123',
        phoneNumberId: '1220572421149962',
        recipientPhoneNumber: '51999999999',
        messageType: 'text',
        webhookReceivedAt: RECEIVED_AT,
        text: 'Mensaje privado',
      }),
    ).rejects.toEqual(new DatabaseUnavailableException());
  });
});
