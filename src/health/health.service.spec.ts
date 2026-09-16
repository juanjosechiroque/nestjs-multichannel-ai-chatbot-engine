import type { PrismaService } from '../database/prisma.service';
import { HealthService } from './health.service';
import { NestRuntimeService } from './nest-runtime.service';

describe('HealthService', () => {
  const queryRaw = jest.fn();
  let nestRuntime: NestRuntimeService;
  let service: HealthService;

  beforeEach(() => {
    queryRaw.mockReset().mockResolvedValue([{ '?column?': 1 }]);
    nestRuntime = new NestRuntimeService();
    service = new HealthService(nestRuntime, { $queryRaw: queryRaw } as unknown as PrismaService);
  });

  it('is ready when Nest and PostgreSQL are available', async () => {
    nestRuntime.onApplicationBootstrap();

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ok',
      checks: { nest: 'ready', postgresql: 'up' },
    });
    expect(queryRaw).toHaveBeenCalledTimes(1);
  });

  it('is unavailable before Nest finishes bootstrapping', async () => {
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'unavailable',
      checks: { nest: 'initializing', postgresql: 'up' },
    });
  });

  it('is unavailable while Nest is shutting down', async () => {
    nestRuntime.onApplicationBootstrap();
    nestRuntime.beforeApplicationShutdown();

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'unavailable',
      checks: { nest: 'shutting_down', postgresql: 'up' },
    });
  });

  it('is unavailable when PostgreSQL cannot answer', async () => {
    nestRuntime.onApplicationBootstrap();
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));

    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'unavailable',
      checks: { nest: 'ready', postgresql: 'down' },
    });
  });
});
