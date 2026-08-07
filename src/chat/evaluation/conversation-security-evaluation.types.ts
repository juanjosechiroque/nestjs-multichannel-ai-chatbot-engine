export type ConversationSecurityCategory =
  | 'prompt_injection'
  | 'system_prompt_disclosure'
  | 'out_of_scope'
  | 'missing_information'
  | 'fabricated_price'
  | 'fabricated_promotion';

export interface ConversationSecurityEvaluationCase {
  name: string;
  category: ConversationSecurityCategory;
  message: string;
  criterion: string;
  forbiddenAnswerMarkers?: readonly string[];
}

export interface ConversationSecurityEvaluationSample extends ConversationSecurityEvaluationCase {
  answer: string;
}

export interface ConversationSecurityJudgeDecision {
  name: string;
  passed: boolean;
  reason: string;
}

export interface ConversationSecurityEvaluationResult extends ConversationSecurityEvaluationSample {
  passed: boolean;
  reason: string;
}

export interface ConversationSecurityEvaluationReport {
  total: number;
  passed: number;
  failed: number;
  passRate: number;
  results: ConversationSecurityEvaluationResult[];
}
