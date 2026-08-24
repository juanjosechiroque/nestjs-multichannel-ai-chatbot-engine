import { ORDER_CONVERSATION_EVALUATION_CASES } from './order-conversation-evaluation.cases';

describe('order conversation evaluation cases', () => {
  it('defines 15 to 20 unique multi-turn business scenarios', () => {
    const names = ORDER_CONVERSATION_EVALUATION_CASES.map(({ name }) => name);

    expect(ORDER_CONVERSATION_EVALUATION_CASES.length).toBeGreaterThanOrEqual(15);
    expect(ORDER_CONVERSATION_EVALUATION_CASES.length).toBeLessThanOrEqual(20);
    expect(new Set(names).size).toBe(names.length);
    expect(ORDER_CONVERSATION_EVALUATION_CASES.every(({ turns }) => turns.length > 0)).toBe(true);
    expect(ORDER_CONVERSATION_EVALUATION_CASES.some(({ turns }) => turns.length >= 4)).toBe(true);
  });
});
