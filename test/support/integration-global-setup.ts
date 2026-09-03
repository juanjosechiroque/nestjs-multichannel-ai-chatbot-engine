import { PostgreSqlContainer } from '@testcontainers/postgresql';

// Suites share the container but use separate databases.
export default async function globalSetup(): Promise<void> {
  process.env.NODE_ENV = 'test';

  const container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('integration_root_test')
    .withUsername('chatbot')
    .withPassword('chatbot')
    .start();

  process.env.INTEGRATION_PG_URI = container.getConnectionUri();
  (globalThis as { __INTEGRATION_PG_CONTAINER__?: unknown }).__INTEGRATION_PG_CONTAINER__ =
    container;
}
