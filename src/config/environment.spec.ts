import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('converts numeric environment variables from strings', () => {
    const environment = validateEnvironment({
      NODE_ENV: 'development',
      PORT: '3000',
      OPENAI_API_KEY: 'test-key',
      OPENAI_MODEL: 'gpt-5.6-luna',
      RAG_MIN_SIMILARITY: '0.5',
      OPENAI_MAX_OUTPUT_TOKENS: '500',
      DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot_engine',
      BUSINESS_NAME: 'Café Nube',
    });

    expect(environment.PORT).toBe(3000);
    expect(environment.OPENAI_MAX_OUTPUT_TOKENS).toBe(500);
    expect(environment.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(environment.RAG_MIN_SIMILARITY).toBe(0.5);
  });
});
