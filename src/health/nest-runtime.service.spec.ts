import { NestRuntimeService } from './nest-runtime.service';

describe('NestRuntimeService', () => {
  it('advances from initializing to ready to shutting_down', () => {
    const service = new NestRuntimeService();
    expect(service.getState()).toBe('initializing');

    service.onApplicationBootstrap();
    expect(service.getState()).toBe('ready');

    service.beforeApplicationShutdown();
    expect(service.getState()).toBe('shutting_down');
  });
});
