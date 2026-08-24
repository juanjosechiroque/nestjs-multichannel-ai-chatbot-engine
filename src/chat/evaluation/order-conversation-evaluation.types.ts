import type { OrderStatus } from '../../order/order.types';
import type { TokenUsage } from '../token-usage';

export interface ExpectedOrderItem {
  productName: string;
  quantity: number;
}

export interface ExpectedOrderSnapshot {
  status: OrderStatus;
  total: number;
  items: readonly ExpectedOrderItem[];
}

export interface OrderConversationEvaluationTurn {
  message: string;
  expectedStatus: OrderStatus | null;
  expectedReplyTerms?: readonly string[];
}

export interface OrderConversationEvaluationCase {
  name: string;
  category:
    'add' | 'review' | 'confirm' | 'modify' | 'cancel' | 'clarification' | 'safety' | 'continuity';
  turns: readonly OrderConversationEvaluationTurn[];
  expectedOrder: ExpectedOrderSnapshot | null;
  expectedOrderCount: number;
}

export interface OrderConversationEvaluationTurnResult {
  message: string;
  answer: string;
  expectedStatus: OrderStatus | null;
  actualStatus: OrderStatus | null;
  durationMs: number;
  tokenUsage: TokenUsage;
  passed: boolean;
  failures: string[];
}

export interface OrderConversationEvaluationResult {
  name: string;
  category: OrderConversationEvaluationCase['category'];
  conversationId: string;
  turns: OrderConversationEvaluationTurnResult[];
  expectedOrder: ExpectedOrderSnapshot | null;
  actualOrder: ExpectedOrderSnapshot | null;
  expectedOrderCount: number;
  actualOrderCount: number;
  tokenUsage: TokenUsage;
  passed: boolean;
  failures: string[];
}

export interface OrderConversationEvaluationReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  totalTurns: number;
  totalDurationMs: number;
  tokenUsage: TokenUsage;
  results: OrderConversationEvaluationResult[];
}
