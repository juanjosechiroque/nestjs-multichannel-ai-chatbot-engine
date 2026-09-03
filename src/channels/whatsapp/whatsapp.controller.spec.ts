import { ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';

const VERIFY_TOKEN = 'whatsapp-test-verify-token-32-chars';

function createController(): WhatsAppController {
  return new WhatsAppController(
    new ConfigService({
      WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    }),
  );
}

describe('WhatsAppController', () => {
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
});
