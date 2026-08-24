export interface TokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  totalTokens: number;
}

export function emptyTokenUsage(): TokenUsage {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
  };
}

export function addTokenUsage(usages: readonly TokenUsage[]): TokenUsage {
  return usages.reduce<TokenUsage>((total, usage) => {
    total.inputTokens += usage.inputTokens;
    total.cachedInputTokens += usage.cachedInputTokens;
    total.cacheWriteTokens += usage.cacheWriteTokens;
    total.outputTokens += usage.outputTokens;
    total.reasoningTokens += usage.reasoningTokens;
    total.totalTokens += usage.totalTokens;
    return total;
  }, emptyTokenUsage());
}
