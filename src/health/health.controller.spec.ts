import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import type { HealthService } from './health.service';

describe('HealthController', () => {
  const checkReadiness = jest.fn();
  const controller = new HealthController({ checkReadiness } as unknown as HealthService);

  beforeEach(() => {
    checkReadiness.mockReset();
  });

  it('returns liveness through the main and explicit endpoints', () => {
    expect(controller.check()).toEqual({ status: 'ok' });
    expect(controller.checkLiveness()).toEqual({ status: 'ok' });
  });

  it('returns readiness when every check passes', async () => {
    const readiness = {
      status: 'ok',
      checks: { nest: 'ready', postgresql: 'up' },
    } as const;
    checkReadiness.mockResolvedValueOnce(readiness);

    await expect(controller.checkReadiness()).resolves.toEqual(readiness);
  });

  it('returns 503 with component states when readiness fails', async () => {
    const readiness = {
      status: 'unavailable',
      checks: { nest: 'ready', postgresql: 'down' },
    } as const;
    checkReadiness.mockResolvedValueOnce(readiness);

    await expect(controller.checkReadiness()).rejects.toEqual(
      new ServiceUnavailableException(readiness),
    );
  });
});
