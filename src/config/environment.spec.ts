import { validateEnvironment } from './environment';

const VALID_ENVIRONMENT: Record<string, unknown> = {
  NODE_ENV: 'development',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: ' http://localhost:4173/, https://www.example.com/ ',
  OPENAI_API_KEY: 'test-key',
  OPENAI_MODEL: 'gpt-5.6-luna',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  OPENAI_TIMEOUT_MS: '20000',
  OPENAI_MAX_RETRIES: '1',
  RAG_MIN_SIMILARITY: '0.5',
  DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot_engine',
  WHATSAPP_ENABLED: 'true',
  WHATSAPP_VERIFY_TOKEN: 'whatsapp-test-verify-token-32-chars',
  WHATSAPP_APP_SECRET: 'whatsapp-test-app-secret-32-chars',
  WHATSAPP_ACCESS_TOKEN: 'whatsapp-test-access-token-at-least-20-chars',
};

const WEB_ONLY_ENVIRONMENT: Record<string, unknown> = {
  NODE_ENV: 'development',
  PORT: '3000',
  CORS_ALLOWED_ORIGINS: 'http://localhost:4173',
  OPENAI_API_KEY: 'test-key',
  RAG_MIN_SIMILARITY: '0.5',
  DATABASE_URL: 'postgresql://chatbot:chatbot@localhost:5432/chatbot_engine',
};

describe('validateEnvironment', () => {
  it('converts numeric environment variables from strings', () => {
    const environmentInput = { ...VALID_ENVIRONMENT };
    delete environmentInput.OPENAI_EMBEDDING_MODEL;
    delete environmentInput.OPENAI_TIMEOUT_MS;
    delete environmentInput.OPENAI_MAX_RETRIES;

    const environment = validateEnvironment(environmentInput);

    expect(environment.PORT).toBe(3000);
    expect(environment.CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:4173',
      'https://www.example.com',
    ]);
    expect(environment.OPENAI_EMBEDDING_MODEL).toBe('text-embedding-3-small');
    expect(environment.OPENAI_TIMEOUT_MS).toBe(20_000);
    expect(environment.OPENAI_MAX_RETRIES).toBe(1);
    expect(environment.RAG_MIN_SIMILARITY).toBe(0.5);
    expect(environment.RATE_LIMIT_CONVERSATIONS_PER_HOUR).toBe(5);
    expect(environment.RATE_LIMIT_MESSAGES_PER_MINUTE).toBe(10);
  });

  it('uses the local widget origin when the CORS allowlist is omitted', () => {
    const environmentInput = { ...VALID_ENVIRONMENT };
    delete environmentInput.CORS_ALLOWED_ORIGINS;

    expect(validateEnvironment(environmentInput).CORS_ALLOWED_ORIGINS).toEqual([
      'http://localhost:4173',
    ]);
  });

  it.each([
    ['an unsupported NODE_ENV', { NODE_ENV: 'staging' }, 'NODE_ENV'],
    ['a port below the valid range', { PORT: '0' }, 'PORT'],
    ['a port above the valid range', { PORT: '70000' }, 'PORT'],
    ['a non-numeric port', { PORT: 'abc' }, 'PORT'],
    ['an empty CORS allowlist', { CORS_ALLOWED_ORIGINS: '' }, 'CORS_ALLOWED_ORIGINS'],
    ['an invalid CORS origin', { CORS_ALLOWED_ORIGINS: 'example.com' }, 'CORS_ALLOWED_ORIGINS'],
    ['a wildcard CORS origin', { CORS_ALLOWED_ORIGINS: '*' }, 'CORS_ALLOWED_ORIGINS'],
    ['an empty OpenAI API key', { OPENAI_API_KEY: '' }, 'OPENAI_API_KEY'],
    ['an empty database URL', { DATABASE_URL: '' }, 'DATABASE_URL'],
    [
      'a short WhatsApp verify token',
      { WHATSAPP_VERIFY_TOKEN: 'too-short' },
      'WHATSAPP_VERIFY_TOKEN',
    ],
    ['a short WhatsApp app secret', { WHATSAPP_APP_SECRET: 'too-short' }, 'WHATSAPP_APP_SECRET'],
    [
      'a short WhatsApp access token',
      { WHATSAPP_ACCESS_TOKEN: 'too-short' },
      'WHATSAPP_ACCESS_TOKEN',
    ],
    ['a similarity below zero', { RAG_MIN_SIMILARITY: '-0.1' }, 'RAG_MIN_SIMILARITY'],
    ['a similarity above one', { RAG_MIN_SIMILARITY: '1.1' }, 'RAG_MIN_SIMILARITY'],
    [
      'zero conversations per hour',
      { RATE_LIMIT_CONVERSATIONS_PER_HOUR: '0' },
      'RATE_LIMIT_CONVERSATIONS_PER_HOUR',
    ],
    [
      'zero messages per minute',
      { RATE_LIMIT_MESSAGES_PER_MINUTE: '0' },
      'RATE_LIMIT_MESSAGES_PER_MINUTE',
    ],
    ['a timeout below one second', { OPENAI_TIMEOUT_MS: '999' }, 'OPENAI_TIMEOUT_MS'],
    ['too many retries', { OPENAI_MAX_RETRIES: '6' }, 'OPENAI_MAX_RETRIES'],
    ['a negative retry count', { OPENAI_MAX_RETRIES: '-1' }, 'OPENAI_MAX_RETRIES'],
  ])('rejects %s', (_scenario, override, expectedProperty) => {
    expect(() => validateEnvironment({ ...VALID_ENVIRONMENT, ...override })).toThrow(
      expectedProperty,
    );
  });

  describe('WHATSAPP_ENABLED', () => {
    it('defaults to false when the flag is absent', () => {
      expect(validateEnvironment(WEB_ONLY_ENVIRONMENT).WHATSAPP_ENABLED).toBe(false);
    });

    it('parses the string "false" as false', () => {
      expect(
        validateEnvironment({ ...WEB_ONLY_ENVIRONMENT, WHATSAPP_ENABLED: 'false' })
          .WHATSAPP_ENABLED,
      ).toBe(false);
    });

    it('parses the string "true" as true', () => {
      expect(
        validateEnvironment({ ...VALID_ENVIRONMENT, WHATSAPP_ENABLED: 'true' }).WHATSAPP_ENABLED,
      ).toBe(true);
    });

    it.each([['yes'], ['1'], [''], ['TRUE'], ['off']])(
      'rejects the ambiguous value %j with a clear error',
      (value) => {
        expect(() =>
          validateEnvironment({ ...WEB_ONLY_ENVIRONMENT, WHATSAPP_ENABLED: value }),
        ).toThrow('WHATSAPP_ENABLED');
      },
    );
  });

  describe('Meta credentials', () => {
    it('accepts a disabled WhatsApp channel with no Meta credentials', () => {
      expect(() => validateEnvironment(WEB_ONLY_ENVIRONMENT)).not.toThrow();
    });

    it('ignores short Meta credentials while the channel is disabled', () => {
      expect(() =>
        validateEnvironment({
          ...WEB_ONLY_ENVIRONMENT,
          WHATSAPP_ENABLED: 'false',
          WHATSAPP_VERIFY_TOKEN: 'x',
          WHATSAPP_APP_SECRET: 'x',
          WHATSAPP_ACCESS_TOKEN: 'x',
        }),
      ).not.toThrow();
    });

    it('accepts an enabled WhatsApp channel with valid Meta credentials', () => {
      const environment = validateEnvironment(VALID_ENVIRONMENT);

      expect(environment.WHATSAPP_ENABLED).toBe(true);
      expect(environment.WHATSAPP_VERIFY_TOKEN).toBe(VALID_ENVIRONMENT.WHATSAPP_VERIFY_TOKEN);
    });

    it.each([
      ['verify token', 'WHATSAPP_VERIFY_TOKEN'],
      ['app secret', 'WHATSAPP_APP_SECRET'],
      ['access token', 'WHATSAPP_ACCESS_TOKEN'],
    ])('rejects an enabled WhatsApp channel missing the %s', (_scenario, property) => {
      const environmentInput = { ...VALID_ENVIRONMENT };
      delete environmentInput[property];

      expect(() => validateEnvironment(environmentInput)).toThrow(property);
    });

    it.each([['WHATSAPP_VERIFY_TOKEN'], ['WHATSAPP_APP_SECRET'], ['WHATSAPP_ACCESS_TOKEN']])(
      'rejects an enabled WhatsApp channel with a too-short %s',
      (property) => {
        expect(() => validateEnvironment({ ...VALID_ENVIRONMENT, [property]: 'short' })).toThrow(
          property,
        );
      },
    );
  });
});
