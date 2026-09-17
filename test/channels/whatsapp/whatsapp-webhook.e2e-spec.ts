import { createHmac } from 'node:crypto';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { ProductCategory, WhatsAppOutboundStatus } from '../../../src/generated/prisma/enums';
import { E2E_ENVIRONMENT, setupHttpE2E } from '../../support/e2e-app';

/** Polls until `predicate` holds: the webhook acknowledges Meta before the chatbot turn runs. */
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeoutMs = 5_000, intervalMs = 25 }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) {
      throw new Error('waitFor: condition was not met before the timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe('WhatsApp webhook HTTP flow', () => {
  const harness = setupHttpE2E();

  it('returns the exact challenge for a valid WhatsApp webhook verification', async () => {
    await request(harness.server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': E2E_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        'hub.challenge': '123456789',
      })
      .expect(200, '123456789');
  });

  it('accepts the redundant underscore aliases sent by the Meta developer dashboard', async () => {
    await request(harness.server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': E2E_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        'hub.challenge': '123456789',
        hub_mode: 'subscribe',
        hub_verify_token: E2E_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
        hub_challenge: '123456789',
      })
      .expect(200, '123456789');
  });

  it('acknowledges a WhatsApp notification with a valid Meta signature', async () => {
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const signature = `sha256=${createHmac('sha256', E2E_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(payload)
      .digest('hex')}`;

    await request(harness.server)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', signature)
      .send(payload)
      .expect(200, '');
    expect(harness.sendWhatsAppText).not.toHaveBeenCalled();
  });

  it('routes a WhatsApp text through the shared chatbot and suppresses a duplicate delivery', async () => {
    harness.sendWhatsAppText.mockResolvedValueOnce({ providerMessageId: 'wamid.outbound-e2e' });
    await harness.prisma.product.create({
      data: {
        slug: 'espresso-e2e',
        name: 'Espresso',
        description: 'Café intenso de prueba.',
        price: 8,
        currency: 'PEN',
        category: ProductCategory.HOT_DRINK,
        active: true,
        availableForOrdering: true,
      },
    });
    harness.generate.mockImplementationOnce(async (input) => {
      expect(input.message).toBe('¿Qué productos tienen?');
      expect(input.context.channel).toBe('whatsapp');
      const catalog = JSON.parse(
        await harness.toolBag(input).searchCatalog({
          productName: null,
          category: null,
          maxPrice: null,
          maxPriceExclusive: false,
          dietaryTags: [],
          excludedAllergens: [],
          containsCoffee: null,
          decaffeinated: null,
          caffeineFree: null,
        }),
      ) as { products: Array<{ name: string; price: string }> };
      expect(catalog.products).toEqual([expect.objectContaining({ name: 'Espresso', price: '8' })]);
      return {
        answer: 'Tenemos Espresso y otras bebidas calientes.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      };
    });
    const payload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e',
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
                    id: 'wamid.e2e-duplicate',
                    from: '51999999999',
                    timestamp: '1788195600',
                    type: 'text',
                    text: { body: '¿Qué productos tienen?' },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const signature = `sha256=${createHmac('sha256', E2E_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(payload)
      .digest('hex')}`;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(harness.server)
        .post('/api/webhook/whatsapp')
        .set('Content-Type', 'application/json')
        .set('X-Hub-Signature-256', signature)
        .send(payload)
        .expect(200, '');
    }

    // The 200 is returned before the chatbot turn runs; wait for its side effect.
    await waitFor(async () => {
      const accepted = await harness.prisma.whatsAppOutboundMessage.count({
        where: { providerMessageId: 'wamid.outbound-e2e' },
      });
      return accepted === 1;
    });

    await expect(
      harness.prisma.whatsAppWebhookMessage.count({
        where: { wabaId: 'waba-e2e', messageId: 'wamid.e2e-duplicate' },
      }),
    ).resolves.toBe(1);
    expect(harness.generate).toHaveBeenCalledTimes(1);
    expect(harness.sendWhatsAppText).toHaveBeenCalledTimes(1);
    expect(harness.sendWhatsAppText).toHaveBeenCalledWith({
      phoneNumberId: '1220572421149962',
      recipientPhoneNumber: '51999999999',
      text: 'Tenemos Espresso y otras bebidas calientes.',
    });
    const acceptedOutbound = await harness.prisma.whatsAppOutboundMessage.findUniqueOrThrow({
      where: { providerMessageId: 'wamid.outbound-e2e' },
    });
    expect(acceptedOutbound.wabaId).toBe('waba-e2e');
    expect(acceptedOutbound.inboundMessageId).toBe('wamid.e2e-duplicate');
    expect(acceptedOutbound.status).toBe(WhatsAppOutboundStatus.ACCEPTED);
    expect(acceptedOutbound.attemptCount).toBe(1);
    expect(acceptedOutbound.providerAcceptedAt).toBeInstanceOf(Date);

    const statusPayload = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'waba-e2e',
          changes: [
            {
              field: 'messages',
              value: {
                statuses: [
                  {
                    id: 'wamid.outbound-e2e',
                    status: 'delivered',
                    timestamp: '1788195605',
                  },
                  {
                    id: 'wamid.outbound-e2e',
                    status: 'sent',
                    timestamp: '1788195604',
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const statusSignature = `sha256=${createHmac('sha256', E2E_ENVIRONMENT.WHATSAPP_APP_SECRET)
      .update(statusPayload)
      .digest('hex')}`;

    await request(harness.server)
      .post('/api/webhook/whatsapp')
      .set('Content-Type', 'application/json')
      .set('X-Hub-Signature-256', statusSignature)
      .send(statusPayload)
      .expect(200, '');

    await expect(
      harness.prisma.whatsAppOutboundMessage.findUniqueOrThrow({
        where: { providerMessageId: 'wamid.outbound-e2e' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        status: WhatsAppOutboundStatus.DELIVERED,
        deliveredAt: new Date(1_788_195_605_000),
        sentAt: null,
      }),
    );
    await expect(
      harness.prisma.conversation.count({ where: { channel: 'whatsapp' } }),
    ).resolves.toBe(1);
    await expect(
      harness.prisma.conversationMessage.count({
        where: { conversation: { channel: 'whatsapp' } },
      }),
    ).resolves.toBe(2);
  });

  it('rejects an invalid WhatsApp webhook verification token', async () => {
    await request(harness.server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'invalid-token',
        'hub.challenge': '123456789',
      })
      .expect(403);
  });

  it('validates required WhatsApp webhook verification parameters', async () => {
    await request(harness.server)
      .get('/api/webhook/whatsapp')
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': E2E_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN,
      })
      .expect(400);
  });
});
