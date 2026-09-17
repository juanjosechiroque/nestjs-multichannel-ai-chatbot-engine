import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as { __INTEGRATION_PG_CONTAINER__?: StartedPostgreSqlContainer })
    .__INTEGRATION_PG_CONTAINER__;
  await container?.stop();
}
