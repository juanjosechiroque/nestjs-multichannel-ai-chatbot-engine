import type { RagService } from '../../rag/rag.service';
import { KnowledgeSearchTool } from './knowledge-search.tool';

describe('KnowledgeSearchTool', () => {
  const context = {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    channel: 'web' as const,
  };

  it('searches RAG with the current query when there is no conversation history', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"results_found","knowledge":[]}');
    const rag: Pick<RagService, 'getContext'> = { getContext };
    const tool = new KnowledgeSearchTool(rag);

    await expect(tool.execute({ query: '  ubicación del local  ', context })).resolves.toBe(
      '{"retrievalStatus":"results_found","knowledge":[]}',
    );
    expect(getContext).toHaveBeenCalledWith('ubicación del local', 5, context);
  });

  it('uses the self-contained model query without contaminating it with previous topics', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
    const tool = new KnowledgeSearchTool({ getContext });

    await tool.execute({
      query: 'métodos de pago aceptados',
      context,
    });

    expect(getContext).toHaveBeenCalledWith('métodos de pago aceptados', 5, context);
  });

  it('rejects an empty model-generated query before calling RAG', async () => {
    const getContext = jest.fn();
    const tool = new KnowledgeSearchTool({ getContext });

    await expect(tool.execute({ query: '   ', context })).rejects.toThrow(
      'Knowledge search query cannot be empty',
    );
    expect(getContext).not.toHaveBeenCalled();
  });
});
