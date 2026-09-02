import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { applyMigrations } from './test-database';

// Name must match the assertDisposableTestDatabase guard pattern.
const E2E_DATABASE_NAME = 'chatbot_engine_e2e';

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase(E2E_DATABASE_NAME)
    .withUsername('chatbot')
    .withPassword('chatbot')
    .start();

  const connectionUri = container.getConnectionUri();
  await applyMigrations(connectionUri);

  process.env.DATABASE_URL = connectionUri;
  process.env.E2E_DATABASE_NAME = E2E_DATABASE_NAME;
  (globalThis as { __E2E_PG_CONTAINER__?: unknown }).__E2E_PG_CONTAINER__ = container;
}
