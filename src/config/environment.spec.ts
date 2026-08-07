import { validateEnvironment } from './environment';

const VALID_ENVIRONMENT: Record<string, unknown> = {
  NODE_ENV: 'development',
  PORT: '3000',
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL: 'gpt-5.6-luna',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  RAG_MIN_SIMILARITY: '0.5',
  OPENAI_MAX_OUTPUT_TOKENS: '500',
  DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot_engine',
  BUSINESS_NAME: 'Café Nube',
};

describe('validateEnvironment', () => {
  it('converts numeric environment variables from strings', () => {
    const environmentInput = { ...VALID_ENVIRONMENT };
    delete environmentInput.OPENAI_EMBEDDING_MODEL;

    const environment = validateEnvironment(environmentInput);

    expect(environment.PORT).toBe(3000);
    expect(environment.OPENAI_MAX_OUTPUT_TOKENS).toBe(500);
    expect(environment.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(environment.RAG_MIN_SIMILARITY).toBe(0.5);
  });

  it.each([
    ['an unsupported NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['a port below the valid range', { PORT: '0' }, 'PORT'],
    ['a port above the valid range', { PORT: '70000' }, 'PORT'],
    ['a non-numeric port', { PORT: 'abc' }, 'PORT'],
    ['an empty OpenAI API key', { OPENAI_API_KEY: '' }, 'OPENAI_API_KEY'],
    ['an empty database URL', { DATABASE_URL: '' }, 'DATABASE_URL'],
    ['a similarity below zero', { RAG_MIN_SIMILARITY: '-0.1' }, 'RAG_MIN_SIMILARITY'],
    ['a similarity above one', { RAG_MIN_SIMILARITY: '1.1' }, 'RAG_MIN_SIMILARITY'],
    ['zero output tokens', { OPENAI_MAX_OUTPUT_TOKENS: '0' }, 'OPENAI_MAX_OUTPUT_TOKENS'],
  ])('rejects %s', (_scenario, override, expectedProperty) => {
    expect(() => validateEnvironment({ ...VALID_ENVIRONMENT, ...override })).toThrow(
      expectedProperty,
    );
  });
});
