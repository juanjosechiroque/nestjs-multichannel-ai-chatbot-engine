import { PostgreSqlContainer } from '@testcontainers/postgresql';

// One pgvector container is booted for the whole integration run. Each spec then
// carves out its own uniquely named database inside it (see
// `createIntegrationDatabase`), so suites stay isolated without paying a fresh
// container boot each.
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
