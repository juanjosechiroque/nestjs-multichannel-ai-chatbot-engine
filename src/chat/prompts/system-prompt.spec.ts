import { buildSystemPrompt } from './system-prompt';

describe('buildSystemPrompt', () => {
  it('does not advertise a human handoff capability that the application has not confirmed', () => {
    const prompt = buildSystemPrompt({ businessName: 'Café Nube' });

    expect(prompt).toContain('say clearly that the information is not confirmed');
    expect(prompt).toContain('do not suggest unverified related products or services');
    expect(prompt).toContain(
      'do not tell the user to contact or consult the business unless the provided context contains a supported contact method',
    );
    expect(prompt).toContain('offer help only with explicitly supported topics');
    expect(prompt).toContain(
      'Do not offer or claim to transfer, escalate, notify, or contact a person',
    );
    expect(prompt).toContain('automatic transfer is not available');
    expect(prompt).not.toContain('offer to refer the question to a person');
  });
});
