export type ChatMessageRole = 'user' | 'assistant';

export interface ChatHistoryMessage {
  role: ChatMessageRole;
  content: string;
}

export interface SaveExchangeInput {
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
}
