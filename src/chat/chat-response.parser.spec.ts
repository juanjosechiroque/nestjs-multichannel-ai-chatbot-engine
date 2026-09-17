import { getAvailableSources, getContent, parseResponse } from './chat-response.parser';

describe('chat-response.parser', () => {
  describe('parseResponse', () => {
    it('parses a valid structured response and normalizes literal newline escapes', () => {
      expect(
        parseResponse(
          JSON.stringify({
            answer: 'Pedido confirmado.\\nTotal: S/ 30.',
            usedSourceIds: ['faq-1'],
          }),
        ),
      ).toEqual({
        answer: 'Pedido confirmado.\nTotal: S/ 30.',
        usedSourceIds: ['faq-1'],
      });
    });

    it.each([
      { name: 'a missing usedSourceIds array', payload: { answer: 'Hola' } },
      { name: 'a non-string answer', payload: { answer: 1, usedSourceIds: [] } },
      { name: 'non-string source identifiers', payload: { answer: 'Hola', usedSourceIds: [1] } },
    ])('throws for $name', ({ payload }) => {
      expect(() => parseResponse(JSON.stringify(payload))).toThrow(
        'OpenAI returned an invalid structured response',
      );
    });
  });

  describe('getContent', () => {
    it('returns the document content when the business context exposes an available PDF', () => {
      const businessContext = JSON.stringify({
        documentStatus: 'available',
        document: {
          type: 'document',
          title: 'Carta de Aurora Bistró',
          url: '/api/menu',
          mimeType: 'application/pdf',
        },
      });

      expect(getContent(businessContext)).toEqual({
        content: [
          {
            type: 'document',
            title: 'Carta de Aurora Bistró',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      });
    });

    it.each([
      { name: 'no document status', payload: { retrievalStatus: 'no_results', knowledge: [] } },
      { name: 'an unavailable document', payload: { documentStatus: 'unavailable' } },
      {
        name: 'a non-PDF document descriptor',
        payload: {
          documentStatus: 'available',
          document: { type: 'document', title: 'x', url: '/x', mimeType: 'text/plain' },
        },
      },
    ])('returns an empty object for $name', ({ payload }) => {
      expect(getContent(JSON.stringify(payload))).toEqual({});
    });
  });

  describe('getAvailableSources', () => {
    it('indexes knowledge, product, and promotion references by source id', () => {
      const businessContext = JSON.stringify({
        knowledge: [
          { sourceId: 'faq-hours', sourceKey: 'horario', type: 'faq', content: 'x' },
          { sourceId: 'missing-key', type: 'faq' },
        ],
        products: [{ sourceId: 'product-1', sourceKey: 'latte', type: 'product' }],
        currentPromotions: [{ sourceId: 'promo-1', sourceKey: 'viernes', type: 'promotion' }],
        otherPromotions: [{ sourceId: 'promo-2', sourceKey: 'sabado', type: 'promotion' }],
      });

      const sources = getAvailableSources(businessContext);

      expect([...sources.keys()]).toEqual(['faq-hours', 'product-1', 'promo-1', 'promo-2']);
      expect(sources.get('faq-hours')).toEqual({
        sourceId: 'faq-hours',
        sourceKey: 'horario',
        sourceType: 'faq',
      });
    });

    it('returns an empty map for an order operation result without reference items', () => {
      expect(getAvailableSources(JSON.stringify({ orderOperationStatus: 'completed' })).size).toBe(
        0,
      );
    });

    it('throws when the business context has an unrecognized structure', () => {
      expect(() => getAvailableSources(JSON.stringify({ unexpected: true }))).toThrow(
        'Business context has an invalid structure',
      );
    });
  });
});
