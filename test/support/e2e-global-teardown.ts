import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

export default async function globalTeardown(): Promise<void> {
  const container = (globalThis as { __E2E_PG_CONTAINER__?: StartedPostgreSqlContainer })
    .__E2E_PG_CONTAINER__;
  await container?.stop();
}
