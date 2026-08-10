import { assertDisposableTestDatabase } from './test-database';

describe('assertDisposableTestDatabase', () => {
  const originalNodeEnvironment = process.env.NODE_ENV;

  afterEach(() => {
    if (originalNodeEnvironment === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnvironment;
    }
  });

  it('accepts the exact disposable database created for a test', async () => {
    const database = {
      $queryRawUnsafe: jest
        .fn()
        .mockResolvedValue([{ name: 'chatbot_engine_e2e_1234567890abcdef' }]),
    };

    await expect(
      assertDisposableTestDatabase(database, 'chatbot_engine_e2e_1234567890abcdef'),
    ).resolves.toBeUndefined();
  });

  it('rejects destructive setup outside the test environment', async () => {
    process.env.NODE_ENV = 'development';
    const database = { $queryRawUnsafe: jest.fn() };

    await expect(
      assertDisposableTestDatabase(database, 'chatbot_engine_e2e_1234567890abcdef'),
    ).rejects.toThrow('Refusing destructive test setup with NODE_ENV=development');
    expect(database.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects a database name without a test marker', async () => {
    const database = { $queryRawUnsafe: jest.fn() };

    await expect(assertDisposableTestDatabase(database, 'chatbot_engine')).rejects.toThrow(
      'Test database name must contain "test" or "e2e"',
    );
    expect(database.$queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('rejects a connection to a different database', async () => {
    const database = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ name: 'chatbot_engine' }]),
    };

    await expect(
      assertDisposableTestDatabase(database, 'chatbot_engine_e2e_1234567890abcdef'),
    ).rejects.toThrow('Refusing destructive test setup against database: chatbot_engine');
  });
});
