import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDeliveryFailedException } from '../../common/application-error';
import { WhatsAppMessageSenderService } from './whatsapp-message-sender.service';

const MESSAGE = {
  wabaId: 'waba-123',
  messageId: 'wamid.123',
  phoneNumberId: '1220572421149962',
  recipientPhoneNumber: '51999999999',
  messageType: 'text',
  text: '¿Qué productos tienen?',
};

function createService(): WhatsAppMessageSenderService {
  return new WhatsAppMessageSenderService(
    new ConfigService({
      WHATSAPP_ACCESS_TOKEN: 'private-access-token',
      WHATSAPP_GRAPH_API_VERSION: 'v25.0',
    }),
  );
}

describe('WhatsAppMessageSenderService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends channel-neutral chatbot text to the WhatsApp customer', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'outbound-1' }] })));
    const service = createService();

    await service.sendText(MESSAGE, 'Tenemos café, bebidas frías y alimentos.');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://graph.facebook.com/v25.0/1220572421149962/messages',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer private-access-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: '51999999999',
          type: 'text',
          text: { body: 'Tenemos café, bebidas frías y alimentos.' },
        }),
      }),
    );
    expect(log).toHaveBeenCalledWith({ event: 'whatsapp.message.text.sent' });
  });

  it('returns a controlled failure without logging credentials or recipient data', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(undefined, { status: 401 }));
    const service = createService();

    await expect(service.sendText(MESSAGE, 'Respuesta segura')).rejects.toEqual(
      new WhatsAppDeliveryFailedException(),
    );
    expect(error).toHaveBeenCalledWith({
      event: 'whatsapp.message.delivery.failed',
      failureCode: 'WHATSAPP_DELIVERY_FAILED',
      message: 'Meta Graph API returned HTTP 401',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-access-token');
    expect(JSON.stringify(error.mock.calls)).not.toContain('51999999999');
  });

  it('returns a controlled failure when the Graph API request cannot complete', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));
    const service = createService();

    await expect(service.sendText(MESSAGE, 'Respuesta segura')).rejects.toBeInstanceOf(
      WhatsAppDeliveryFailedException,
    );
  });
});
