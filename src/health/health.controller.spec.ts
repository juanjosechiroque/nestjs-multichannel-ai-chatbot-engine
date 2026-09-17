import { HealthController } from './health.controller';
import { NestRuntimeService } from './nest-runtime.service';

describe('HealthController', () => {
  it('reports ok with the current Nest runtime state', () => {
    const nestRuntime = new NestRuntimeService();
    const controller = new HealthController(nestRuntime);

    expect(controller.check()).toEqual({ status: 'ok', nest: { state: 'initializing' } });

    nestRuntime.onApplicationBootstrap();
    expect(controller.check()).toEqual({ status: 'ok', nest: { state: 'ready' } });
  });
});
