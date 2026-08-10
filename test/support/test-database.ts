interface DatabaseInspector {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

const TEST_DATABASE_NAME_PATTERN = /(?:^|_)(?:e2e|test)(?:_|$)/;

export async function assertDisposableTestDatabase(
  database: DatabaseInspector,
  expectedDatabaseName: string,
): Promise<void> {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(`Refusing destructive test setup with NODE_ENV=${process.env.NODE_ENV}`);
  }

  if (!TEST_DATABASE_NAME_PATTERN.test(expectedDatabaseName)) {
    throw new Error(`Test database name must contain "test" or "e2e": ${expectedDatabaseName}`);
  }

  const [connectedDatabase] = await database.$queryRawUnsafe<Array<{ name: string }>>(
    'SELECT current_database() AS "name"',
  );

  if (connectedDatabase?.name !== expectedDatabaseName) {
    throw new Error(
      `Refusing destructive test setup against database: ${connectedDatabase?.name ?? 'unknown'}`,
    );
  }
}
