import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppDeliveryFailedException } from '../../../common/application-error';
import { MetaWhatsAppClient } from './meta-whatsapp.client';

const MESSAGE = {
  phoneNumberId: '1220572421149962',
  recipientPhoneNumber: '51999999999',
  text: 'Tenemos café, bebidas frías y alimentos.',
};

function createClient(): MetaWhatsAppClient {
  return new MetaWhatsAppClient(
    new ConfigService({
      WHATSAPP_ACCESS_TOKEN: 'private-access-token',
      WHATSAPP_GRAPH_API_VERSION: 'v25.0',
    }),
  );
}

describe('MetaWhatsAppClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('translates provider-neutral text to Meta Graph API and returns its message ID', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ messages: [{ id: 'outbound-1' }] })));
    const client = createClient();

    await expect(client.sendText(MESSAGE)).resolves.toEqual({
      providerMessageId: 'outbound-1',
    });

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
    expect(log).toHaveBeenCalledWith({
      event: 'whatsapp.provider.message.accepted',
      provider: 'meta',
    });
  });

  it('accepts a successful provider response without a readable message ID', async () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(undefined, { status: 200 }));
    const client = createClient();

    await expect(client.sendText(MESSAGE)).resolves.toEqual({});
  });

  it('returns a controlled failure without logging credentials or recipient data', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockResolvedValue(new Response(undefined, { status: 401 }));
    const client = createClient();

    await expect(client.sendText(MESSAGE)).rejects.toEqual(new WhatsAppDeliveryFailedException());
    expect(error).toHaveBeenCalledWith({
      event: 'whatsapp.provider.delivery.failed',
      provider: 'meta',
      failureCode: 'WHATSAPP_DELIVERY_FAILED',
      message: 'Meta Graph API returned HTTP 401',
    });
    expect(JSON.stringify(error.mock.calls)).not.toContain('private-access-token');
    expect(JSON.stringify(error.mock.calls)).not.toContain('51999999999');
  });

  it('returns a controlled failure when the Graph API request cannot complete', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network failure'));
    const client = createClient();

    await expect(client.sendText(MESSAGE)).rejects.toBeInstanceOf(WhatsAppDeliveryFailedException);
  });
});
