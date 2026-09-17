import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Client } from 'pg';

interface DatabaseInspector {
  $queryRawUnsafe<T>(query: string): Promise<T>;
}

export async function applyMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  const migrationsPath = join(process.cwd(), 'prisma', 'migrations');
  const migrations = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  await client.connect();

  try {
    for (const migration of migrations) {
      const migrationPath = join(migrationsPath, migration.name, 'migration.sql');
      const sql = await readFile(migrationPath, 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

const TEST_DATABASE_NAME_PATTERN = /(?:^|_)(?:e2e|test)(?:_|$)/;

/**
 * Creates a fresh, uniquely named database inside the shared integration
 * container (booted once by `integration-global-setup.ts`) and returns its
 * connection URI. Cheap compared to starting a new container per suite.
 */
export async function createIntegrationDatabase(databaseName: string): Promise<string> {
  if (!TEST_DATABASE_NAME_PATTERN.test(databaseName)) {
    throw new Error(`Test database name must contain "test" or "e2e": ${databaseName}`);
  }

  const baseUri = process.env.INTEGRATION_PG_URI;
  if (!baseUri) {
    throw new Error(
      'INTEGRATION_PG_URI is not set; is test/support/integration-global-setup.ts wired as globalSetup?',
    );
  }

  const client = new Client({ connectionString: baseUri });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }

  const uri = new URL(baseUri);
  uri.pathname = `/${databaseName}`;
  return uri.toString();
}

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
