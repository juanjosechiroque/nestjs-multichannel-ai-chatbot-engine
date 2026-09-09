import type { ChatResult } from '../../chat/chat.types';
import { WebResponseAdapter } from './web-response.adapter';

describe('WebResponseAdapter', () => {
  const adapter = new WebResponseAdapter();

  it('keeps supported bold emphasis and removes other Markdown without producing HTML', () => {
    const result: ChatResult = {
      reply: [
        '## Resumen',
        '',
        '- **3 Lattes:** `S/ 39`',
        '* ***1 Carrot cake:*** ~~S/ 16~~ S/ 15',
        '',
        '> ¿Deseas confirmar?',
      ].join('\n'),
    };

    expect(adapter.adapt(result)).toEqual({
      reply: [
        'Resumen',
        '',
        '- **3 Lattes:** S/ 39',
        '- **1 Carrot cake:** S/ 16 S/ 15',
        '',
        'Deseas confirmar?',
      ].join('\n'),
    });
  });

  it('normalizes casual Spanish punctuation, redundant currency, and masked phone wording', () => {
    expect(
      adapter.adapt({
        reply: '¡Listo! Total: S/ 22 PEN. Teléfono: 998.\n\n¿Confirmas el pedido?',
      }),
    ).toEqual({
      reply: 'Listo! Total: S/ 22. Teléfono terminado en 998.\n\nConfirmas el pedido?',
    });
  });

  it('keeps HTTPS destinations readable for web clients that turn URLs into links', () => {
    expect(
      adapter.adapt({
        reply:
          'Revisa [nuestra ubicación](https://maps.google.com/example) o https://example.com/menu.',
      }),
    ).toEqual({
      reply:
        'Revisa nuestra ubicación (https://maps.google.com/example) o https://example.com/menu.',
    });
  });

  it('does not duplicate a Markdown link whose label is already its destination', () => {
    expect(
      adapter.adapt({
        reply: '[https://example.com/menu](https://example.com/menu)',
      }),
    ).toEqual({
      reply: 'https://example.com/menu',
    });
  });

  it('passes structured content through without exposing internal token usage', () => {
    const content = [
      {
        type: 'document' as const,
        title: 'Carta de Café Nube',
        url: '/api/menu',
        mimeType: 'application/pdf' as const,
      },
    ];

    expect(
      adapter.adapt({
        reply: '**Aquí tienes nuestra carta.**',
        content,
        tokenUsage: {
          inputTokens: 100,
          cachedInputTokens: 0,
          cacheWriteTokens: 0,
          outputTokens: 10,
          reasoningTokens: 0,
          totalTokens: 110,
        },
      }),
    ).toEqual({
      reply: '**Aquí tienes nuestra carta.**',
      content,
    });
  });
});
