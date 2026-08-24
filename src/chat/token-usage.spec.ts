import { addTokenUsage, emptyTokenUsage } from './token-usage';

describe('token usage', () => {
  it('returns a fresh zero-valued usage object', () => {
    expect(emptyTokenUsage()).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    });
  });

  it('adds every usage field across multiple OpenAI calls', () => {
    expect(
      addTokenUsage([
        {
          inputTokens: 100,
          cachedInputTokens: 10,
          cacheWriteTokens: 20,
          outputTokens: 30,
          reasoningTokens: 5,
          totalTokens: 130,
        },
        {
          inputTokens: 200,
          cachedInputTokens: 15,
          cacheWriteTokens: 25,
          outputTokens: 40,
          reasoningTokens: 7,
          totalTokens: 240,
        },
      ]),
    ).toEqual({
      inputTokens: 300,
      cachedInputTokens: 25,
      cacheWriteTokens: 45,
      outputTokens: 70,
      reasoningTokens: 12,
      totalTokens: 370,
    });
  });
});
