import { BeforeApplicationShutdown, Injectable, OnApplicationBootstrap } from '@nestjs/common';

export type NestRuntimeState = 'initializing' | 'ready' | 'shutting_down';

@Injectable()
export class NestRuntimeService implements OnApplicationBootstrap, BeforeApplicationShutdown {
  private state: NestRuntimeState = 'initializing';

  onApplicationBootstrap(): void {
    this.state = 'ready';
  }

  beforeApplicationShutdown(): void {
    this.state = 'shutting_down';
  }

  getState(): NestRuntimeState {
    return this.state;
  }
}
