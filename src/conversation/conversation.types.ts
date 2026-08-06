import type { ChatChannel } from '../chat/chat.types';

export interface ConversationReference {
  id: string;
  sessionId: string;
}

export interface FindConversationInput {
  sessionId: string;
  channel: ChatChannel;
}
