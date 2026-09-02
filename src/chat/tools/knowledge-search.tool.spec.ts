import type { RagService } from '../../rag/rag.service';
import type { ToolInvocationContext } from './chat-tool';
import { KnowledgeSearchTool } from './knowledge-search.tool';

const requestContext = {
  requestId: 'request-1',
  conversationId: 'conversation-1',
  channel: 'web' as const,
};

function invocation(overrides: Partial<ToolInvocationContext> = {}): ToolInvocationContext {
  return {
    requestContext,
    conversationId: 'conversation-1',
    orderContext: { activeOrder: null, confirmationReplayAvailable: false },
    message: '¿Cuál es la ubicación?',
    ...overrides,
  };
}

describe('KnowledgeSearchTool', () => {
  it('searches RAG with the current query when there is no conversation history', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"results_found","knowledge":[]}');
    const rag: Pick<RagService, 'getContext'> = { getContext };
    const tool = new KnowledgeSearchTool(rag);

    await expect(tool.execute({ query: '  ubicación del local  ' }, invocation())).resolves.toBe(
      '{"retrievalStatus":"results_found","knowledge":[]}',
    );
    expect(getContext).toHaveBeenCalledWith('ubicación del local', 5, requestContext);
  });

  it('uses the self-contained model query without contaminating it with previous topics', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
    const tool = new KnowledgeSearchTool({ getContext });

    await tool.execute({ query: 'métodos de pago aceptados' }, invocation());

    expect(getContext).toHaveBeenCalledWith('métodos de pago aceptados', 5, requestContext);
  });

  it('prefers the application-supplied argument override when present', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
    const tool = new KnowledgeSearchTool({ getContext });

    await tool.execute(
      { query: 'ubicación' },
      invocation({ argumentOverride: 'dirección exacta y enlace de mapa' }),
    );

    expect(getContext).toHaveBeenCalledWith('dirección exacta y enlace de mapa', 5, requestContext);
  });

  it('rejects an empty model-generated query before calling RAG', async () => {
    const getContext = jest.fn();
    const tool = new KnowledgeSearchTool({ getContext });

    await expect(tool.execute({ query: '   ' }, invocation())).rejects.toThrow(
      'Knowledge search query cannot be empty',
    );
    expect(getContext).not.toHaveBeenCalled();
  });

  describe('buildDefinition', () => {
    it('describes a strict single-string-query function tool', () => {
      const definition = new KnowledgeSearchTool({ getContext: jest.fn() }).buildDefinition();

      expect(definition).toEqual(
        expect.objectContaining({ type: 'function', name: 'search_knowledge', strict: true }),
      );
      expect(definition.parameters).toEqual(
        expect.objectContaining({
          required: ['query'],
          additionalProperties: false,
        }),
      );
    });
  });

  describe('parseArguments', () => {
    const tool = new KnowledgeSearchTool({ getContext: jest.fn() });

    it('trims a valid query', () => {
      expect(tool.parseArguments('{"query":"  horario de atención  "}')).toEqual({
        query: 'horario de atención',
      });
    });

    it.each([
      { name: 'a blank query', payload: '{"query":"   "}' },
      { name: 'a non-string query', payload: '{"query":5}' },
      { name: 'an extra property', payload: '{"query":"hola","extra":1}' },
      { name: 'a query above 500 characters', payload: `{"query":"${'a'.repeat(501)}"}` },
    ])('throws for $name', ({ payload }) => {
      expect(() => tool.parseArguments(payload)).toThrow(
        'OpenAI returned invalid search_knowledge arguments',
      );
    });
  });
});
