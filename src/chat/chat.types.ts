import type { TokenUsage } from './token-usage';

export type ChatChannel = 'web' | 'whatsapp';

export interface ChatRequest {
  requestId: string;
  conversationId: string;
  channel: ChatChannel;
  message: string;
}

export interface DocumentChatContent {
  type: 'document';
  title: string;
  url: string;
  mimeType: 'application/pdf';
}

export type ChatContent = DocumentChatContent;

export interface ChatResult {
  reply: string;
  content?: ChatContent[];
  tokenUsage?: TokenUsage;
}
