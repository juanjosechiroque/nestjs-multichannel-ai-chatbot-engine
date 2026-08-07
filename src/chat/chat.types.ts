export type ChatChannel = 'web' | 'whatsapp';

export interface ChatRequest {
  conversationId: string;
  message: string;
}
