import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';

export interface DisposableOrderEvaluationDatabase {
  connectionString: string;
  databaseName: string;
  stop(): Promise<void>;
}

export async function startOrderEvaluationDatabase(): Promise<DisposableOrderEvaluationDatabase> {
  const databaseName = `chatbot_engine_order_evaluation_test_${Date.now()}`;
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase(databaseName)
    .withUsername('chatbot')
    .withPassword('chatbot')
    .start();
  const connectionString = container.getConnectionUri();

  try {
    await applyMigrations(connectionString);
  } catch (error: unknown) {
    await container.stop();
    throw error;
  }

  return {
    connectionString,
    databaseName,
    stop: () => container.stop().then(() => undefined),
  };
}

async function applyMigrations(connectionString: string): Promise<void> {
  const client = new Client({ connectionString });
  const migrationsPath = join(process.cwd(), 'prisma', 'migrations');
  const migrations = (await readdir(migrationsPath, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  await client.connect();

  try {
    const currentDatabase = (
      await client.query<{ currentDatabase: string }>(
        'SELECT current_database() AS "currentDatabase"',
      )
    ).rows[0]?.currentDatabase;
    if (currentDatabase !== databaseNameFromConnectionString(connectionString)) {
      throw new Error(`Unexpected evaluation database: ${currentDatabase ?? 'unknown'}`);
    }
    for (const migration of migrations) {
      const sql = await readFile(join(migrationsPath, migration.name, 'migration.sql'), 'utf8');
      await client.query(sql);
    }
  } finally {
    await client.end();
  }
}

function databaseNameFromConnectionString(connectionString: string): string {
  return decodeURIComponent(new URL(connectionString).pathname.slice(1));
}
