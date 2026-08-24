import type { TokenUsage } from '../token-usage';

export interface ModelTokenPricing {
  currency: 'USD';
  asOf: string;
  source: string;
  perMillionTokens: {
    input: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
  };
}

export interface TokenCostEstimate {
  status: 'estimated' | 'unavailable';
  currency: 'USD';
  amount: number | null;
  pricing: ModelTokenPricing | null;
  billableTokens: {
    uncachedInput: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
  };
  breakdown: {
    uncachedInput: number;
    cachedInput: number;
    cacheWrite: number;
    output: number;
  } | null;
}

const MODEL_PRICING: Readonly<Record<string, ModelTokenPricing>> = {
  'gpt-5.6-luna': {
    currency: 'USD',
    asOf: '2026-08-12',
    source: 'https://developers.openai.com/api/docs/models/gpt-5.6-luna',
    perMillionTokens: {
      input: 0.2,
      cachedInput: 0.02,
      cacheWrite: 0.25,
      output: 1.2,
    },
  },
};

export function estimateTokenCost(model: string, usage: TokenUsage): TokenCostEstimate {
  const pricing = MODEL_PRICING[model] ?? null;
  const billableTokens = {
    uncachedInput: Math.max(
      0,
      usage.inputTokens - usage.cachedInputTokens - usage.cacheWriteTokens,
    ),
    cachedInput: usage.cachedInputTokens,
    cacheWrite: usage.cacheWriteTokens,
    output: usage.outputTokens,
  };

  if (!pricing) {
    return {
      status: 'unavailable',
      currency: 'USD',
      amount: null,
      pricing: null,
      billableTokens,
      breakdown: null,
    };
  }

  const breakdown = {
    uncachedInput: tokenCost(billableTokens.uncachedInput, pricing.perMillionTokens.input),
    cachedInput: tokenCost(billableTokens.cachedInput, pricing.perMillionTokens.cachedInput),
    cacheWrite: tokenCost(billableTokens.cacheWrite, pricing.perMillionTokens.cacheWrite),
    output: tokenCost(billableTokens.output, pricing.perMillionTokens.output),
  };

  return {
    status: 'estimated',
    currency: pricing.currency,
    amount: roundCost(Object.values(breakdown).reduce((total, cost) => total + cost, 0)),
    pricing,
    billableTokens,
    breakdown,
  };
}

function tokenCost(tokens: number, pricePerMillion: number): number {
  return roundCost((tokens / 1_000_000) * pricePerMillion);
}

function roundCost(value: number): number {
  return Number(value.toFixed(8));
}
