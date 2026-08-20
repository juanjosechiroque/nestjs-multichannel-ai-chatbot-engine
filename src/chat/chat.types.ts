export type ChatChannel = 'web' | 'whatsapp';

export interface ChatRequest {
  requestId: string;
  conversationId: string;
  channel: ChatChannel;
  message: string;
}

export interface ChatResult {
  reply: string;
}
