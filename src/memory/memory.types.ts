export type ChatMessageRole = 'user' | 'assistant';

export interface ChatHistoryMessage {
  role: ChatMessageRole;
  content: string;
}
