import type { ChatHistoryMessage } from '../memory/memory.types';

export function buildRetrievalQuery(currentMessage: string, history: ChatHistoryMessage[]): string {
  const previousUserMessage = [...history]
    .reverse()
    .find((historyMessage) => historyMessage.role === 'user');

  if (!previousUserMessage) {
    return currentMessage;
  }

  return [
    'Previous customer message:',
    previousUserMessage.content,
    'Current customer message:',
    currentMessage,
  ].join('\n');
}
