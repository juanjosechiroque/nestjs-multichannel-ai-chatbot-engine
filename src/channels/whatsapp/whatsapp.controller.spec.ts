import { createHmac } from 'node:crypto';
import { ForbiddenException, Logger, type RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDeliveryFailedException } from '../../common/application-error';
import type { WhatsAppChatService } from './whatsapp-chat.service';
import { WhatsAppController } from './whatsapp.controller';
import type {
  WhatsAppInboundMessage,
  WhatsAppWebhookReceiptService,
} from './whatsapp-webhook-receipt.service';

const VERIFY_TOKEN = 'whatsapp-test-verify-token-32-chars';
const APP_SECRET = 'whatsapp-test-app-secret-32-chars';
const PAYLOAD = { object: 'whatsapp_business_account', entry: [] };
const ACCEPTED_MESSAGE: WhatsAppInboundMessage = {
  wabaId: 'waba-123',
  messageId: 'wamid.123',
  phoneNumberId: '1220572421149962',
  recipientPhoneNumber: '51999999999',
  messageType: 'text',
  text: '¿Qué productos tienen?',
  customerName: 'Ana',
};
const reserve = jest.fn();
const release = jest.fn();
const handle = jest.fn();

function createController(): WhatsAppController {
  return new WhatsAppController(
    new ConfigService({
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
      WHATSAPP_APP_SECRET: APP_SECRET,
    }),
    { reserve, release } as unknown as WhatsAppWebhookReceiptService,
    { handle } as unknown as WhatsAppChatService,
  );
}

function rawRequest(rawBody: Buffer): RawBodyRequest<Record<string, unknown>> {
  return { rawBody };
}

function sign(rawBody: Buffer): string {
  return `sha256=${createHmac('sha256', APP_SECRET).update(rawBody).digest('hex')}`;
}

describe('WhatsAppController', () => {
  beforeEach(() => {
    reserve
      .mockReset()
      .mockResolvedValue({ acceptedMessages: [ACCEPTED_MESSAGE], duplicateMessages: 0 });
    release.mockReset().mockResolvedValue(undefined);
    handle.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the exact Meta challenge when mode and token are valid', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const controller = createController();

    expect(
      controller.verify({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '123456789',
      }),
    ).toBe('123456789');
  });

  it.each([
    ['an invalid token', 'subscribe', 'different-token'],
    ['an invalid mode', 'unsubscribe', VERIFY_TOKEN],
  ])('rejects %s without logging credentials', (_scenario, mode, token) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const controller = createController();

    expect(() =>
      controller.verify({
        'hub.mode': mode,
        'hub.verify_token': token,
        'hub.challenge': '123456789',
      }),
    ).toThrow(ForbiddenException);
    expect(warn).toHaveBeenCalledWith({ event: 'whatsapp.webhook.verification.failed' });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
  });

  it('acknowledges a notification with a valid Meta signature', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const controller = createController();
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');

    await expect(controller.receive(rawRequest(rawBody), sign(rawBody), PAYLOAD)).resolves.toBe(
      undefined,
    );
    expect(reserve).toHaveBeenCalledWith(PAYLOAD);
    expect(handle).toHaveBeenCalledWith(ACCEPTED_MESSAGE);
    expect(log).toHaveBeenCalledWith({
      event: 'whatsapp.webhook.notification.acknowledged',
      acceptedMessages: 1,
      duplicateMessages: 0,
    });
  });

  it('does not send a second response for a duplicate notification', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    reserve.mockResolvedValueOnce({ acceptedMessages: [], duplicateMessages: 1 });
    const controller = createController();
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');

    await expect(controller.receive(rawRequest(rawBody), sign(rawBody), PAYLOAD)).resolves.toBe(
      undefined,
    );
    expect(handle).not.toHaveBeenCalled();
  });

  it('releases the reservation when delivery through Meta fails', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    handle.mockRejectedValueOnce(new WhatsAppDeliveryFailedException());
    const controller = createController();
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');

    await expect(
      controller.receive(rawRequest(rawBody), sign(rawBody), PAYLOAD),
    ).rejects.toBeInstanceOf(WhatsAppDeliveryFailedException);
    expect(release).toHaveBeenCalledWith(ACCEPTED_MESSAGE);
  });

  it.each([
    ['a missing signature', undefined],
    ['an invalid prefix', 'md5=invalid'],
    ['an invalid digest', `sha256=${'0'.repeat(64)}`],
  ])('rejects %s without logging the signature', async (_scenario, signature) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const controller = createController();
    const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');

    await expect(controller.receive(rawRequest(rawBody), signature, PAYLOAD)).rejects.toThrow(
      ForbiddenException,
    );
    expect(reserve).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith({ event: 'whatsapp.webhook.signature.invalid' });
    if (signature) expect(JSON.stringify(warn.mock.calls)).not.toContain(signature);
  });

  it('rejects a valid signature when the request body was modified', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const controller = createController();
    const originalBody = Buffer.from('{"object":"whatsapp_business_account"}');
    const modifiedBody = Buffer.from('{"object":"different"}');

    await expect(
      controller.receive(rawRequest(modifiedBody), sign(originalBody), PAYLOAD),
    ).rejects.toThrow(ForbiddenException);
    expect(reserve).not.toHaveBeenCalled();
    expect(handle).not.toHaveBeenCalled();
  });
});
