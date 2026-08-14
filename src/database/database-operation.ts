import type { Logger } from '@nestjs/common';
import { DatabaseUnavailableException } from '../common/application-error';
import type { RequestContext } from '../common/request-context';

interface DatabaseOperationOptions {
  logger: Pick<Logger, 'error'>;
  operation: string;
  context?: RequestContext;
}

export async function executeDatabaseOperation<T>(
  { logger, operation, context }: DatabaseOperationOptions,
  execute: () => Promise<T>,
): Promise<T> {
  try {
    return await execute();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown PostgreSQL error';
    logger.error({
      event: 'database.operation.failed',
      ...context,
      operation,
      failureCode: 'DATABASE_UNAVAILABLE',
      message,
    });
    throw new DatabaseUnavailableException();
  }
}
