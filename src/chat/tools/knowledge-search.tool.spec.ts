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

    await expect(
      tool.execute({ query: '  ubicación del local  ', history: [], context }),
    ).resolves.toBe('{"retrievalStatus":"results_found","knowledge":[]}');
    expect(getContext).toHaveBeenCalledWith('ubicación del local', 5, context);
  });

  it('adds the latest customer message to a follow-up search', async () => {
    const getContext = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
    const tool = new KnowledgeSearchTool({ getContext });

    await tool.execute({
      query: 'la opción más barata',
      history: [
        { role: 'user', content: '¿Qué bebidas calientes tienen?' },
        { role: 'assistant', content: 'Tenemos espresso y cappuccino.' },
      ],
      context,
    });

    expect(getContext).toHaveBeenCalledWith(
      [
        'Previous customer message:',
        '¿Qué bebidas calientes tienen?',
        'Current customer message:',
        'la opción más barata',
      ].join('\n'),
      5,
      context,
    );
  });

  it('rejects an empty model-generated query before calling RAG', async () => {
    const getContext = jest.fn();
    const tool = new KnowledgeSearchTool({ getContext });

    await expect(tool.execute({ query: '   ', history: [], context })).rejects.toThrow(
      'Knowledge search query cannot be empty',
    );
    expect(getContext).not.toHaveBeenCalled();
  });
});
