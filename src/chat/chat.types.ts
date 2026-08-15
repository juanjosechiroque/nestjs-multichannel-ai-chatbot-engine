import type { TokenUsage } from './token-usage';

export type ChatChannel = 'web' | 'whatsapp';

/** Optional identity asserted by a channel adapter, never inferred from message text. */
export interface TrustedCustomerIdentity {
  name?: string;
  phone?: string;
}

export interface ChatRequest {
  requestId: string;
  conversationId: string;
  channel: ChatChannel;
  message: string;
  customerIdentity?: TrustedCustomerIdentity;
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
