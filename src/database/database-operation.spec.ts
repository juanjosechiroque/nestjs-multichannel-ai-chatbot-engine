import { DatabaseUnavailableException } from '../common/application-error';
import { executeDatabaseOperation } from './database-operation';

describe('executeDatabaseOperation', () => {
  it('returns the database operation result', async () => {
    const logger = { error: jest.fn() };

    await expect(
      executeDatabaseOperation({ logger, operation: 'test.read' }, () => Promise.resolve('ok')),
    ).resolves.toBe('ok');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs the operation and throws a controlled database error', async () => {
    const logger = { error: jest.fn() };

    await expect(
      executeDatabaseOperation(
        {
          logger,
          operation: 'rag.vector_search',
          context: { requestId: 'request-1' },
        },
        () => Promise.reject(new Error('connection refused')),
      ),
    ).rejects.toEqual(new DatabaseUnavailableException());
    expect(logger.error).toHaveBeenCalledWith({
      event: 'database.operation.failed',
      requestId: 'request-1',
      operation: 'rag.vector_search',
      failureCode: 'DATABASE_UNAVAILABLE',
      message: 'connection refused',
    });
  });
});
