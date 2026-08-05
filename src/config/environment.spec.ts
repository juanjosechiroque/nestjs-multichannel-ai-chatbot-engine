import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('converts numeric environment variables from strings', () => {
    const environment = validateEnvironment({
      NODE_ENV: 'development',
      PORT: '3000',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-5.6-luna',
      OPENAI_MAX_OUTPUT_TOKENS: '500',
      DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot_engine',
    });

    expect(environment.PORT).toBe(3000);
    expect(environment.OPENAI_MAX_OUTPUT_TOKENS).toBe(500);
  });
});
