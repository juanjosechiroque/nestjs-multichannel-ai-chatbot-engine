import { estimateTokenCost } from './order-evaluation-cost';

const usage = {
  inputTokens: 1_000,
  cachedInputTokens: 200,
  cacheWriteTokens: 300,
  outputTokens: 100,
  reasoningTokens: 25,
  totalTokens: 1_100,
};

describe('estimateTokenCost', () => {
  it('separates uncached, cached, cache-write, and output costs for a documented model', () => {
    expect(estimateTokenCost('gpt-5.6-luna', usage)).toEqual(
      expect.objectContaining({
        status: 'estimated',
        currency: 'USD',
        amount: 0.000299,
        billableTokens: {
          uncachedInput: 500,
          cachedInput: 200,
          cacheWrite: 300,
          output: 100,
        },
        breakdown: {
          uncachedInput: 0.0001,
          cachedInput: 0.000004,
          cacheWrite: 0.000075,
          output: 0.00012,
        },
      }),
    );
  });

  it('does not guess a price for an undocumented model', () => {
    expect(estimateTokenCost('custom-model', usage)).toEqual(
      expect.objectContaining({
        status: 'unavailable',
        amount: null,
        pricing: null,
        breakdown: null,
      }),
    );
  });
});
