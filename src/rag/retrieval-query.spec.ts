import type { ChatHistoryMessage } from '../memory/memory.types';
import { buildRetrievalQuery } from './retrieval-query';

describe('buildRetrievalQuery', () => {
  it('uses only the current message when there is no previous customer message', () => {
    const history: ChatHistoryMessage[] = [
      { role: 'assistant', content: '¿En qué puedo ayudarte?' },
    ];

    expect(buildRetrievalQuery('¿Qué bebidas calientes tienen?', history)).toBe(
      '¿Qué bebidas calientes tienen?',
    );
  });

  it('uses the latest customer message as context and ignores assistant responses', () => {
    const history: ChatHistoryMessage[] = [
      { role: 'user', content: '¿Dónde están ubicados?' },
      { role: 'assistant', content: 'Estamos en Miraflores.' },
      { role: 'user', content: '¿Qué bebidas calientes tienen?' },
      { role: 'assistant', content: 'Tenemos espresso, americano y cappuccino.' },
    ];

    expect(buildRetrievalQuery('¿Y cuál es la más barata?', history)).toBe(
      [
        'Previous customer message:',
        '¿Qué bebidas calientes tienen?',
        'Current customer message:',
        '¿Y cuál es la más barata?',
      ].join('\n'),
    );
  });
});
