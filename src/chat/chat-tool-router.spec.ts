import { routeToolChoice } from './chat-tool-router';

describe('routeToolChoice', () => {
  it('lets the model choose for an ordinary message', () => {
    expect(routeToolChoice('¿Cuál es la bebida más barata?')).toEqual({ toolChoice: 'auto' });
  });

  it('forces the promotion tool for a promotion question without a knowledge override', () => {
    expect(routeToolChoice('¿Qué promociones tienen hoy?')).toEqual({
      toolChoice: { type: 'function', name: 'search_promotions' },
    });
  });

  it('forces knowledge search and rewrites the query for a location question', () => {
    expect(routeToolChoice('¿Dónde queda el local?')).toEqual({
      toolChoice: { type: 'function', name: 'search_knowledge' },
      knowledgeQueryOverride:
        'dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ¿Dónde queda el local?',
    });
  });

  it('forces knowledge search with the original query for an explicit services question', () => {
    expect(routeToolChoice('¿Qué servicios ofrecen?')).toEqual({
      toolChoice: { type: 'function', name: 'search_knowledge' },
      knowledgeQueryOverride: '¿Qué servicios ofrecen?',
    });
  });

  it('keeps the promotion tool choice even when a promotion message also mentions a location', () => {
    // The knowledge override is still computed from the location terms, but it is inert
    // because the forced promotion tool choice means knowledge search never runs.
    expect(routeToolChoice('¿Hay promociones en la sucursal de Miraflores?')).toEqual({
      toolChoice: { type: 'function', name: 'search_promotions' },
      knowledgeQueryOverride:
        'dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ¿Hay promociones en la sucursal de Miraflores?',
    });
  });
});
