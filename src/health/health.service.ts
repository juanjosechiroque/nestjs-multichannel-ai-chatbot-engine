import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import type { ReadinessResponseDto } from './dto/health-response.dto';
import { NestRuntimeService } from './nest-runtime.service';

@Injectable()
export class HealthService {
  constructor(
    private readonly nestRuntime: NestRuntimeService,
    private readonly prisma: PrismaService,
  ) {}

  async checkReadiness(): Promise<ReadinessResponseDto> {
    const nest = this.nestRuntime.getState();
    let postgresql: 'up' | 'down' = 'up';

    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      postgresql = 'down';
    }

    return {
      status: nest === 'ready' && postgresql === 'up' ? 'ok' : 'unavailable',
      checks: { nest, postgresql },
    };
  }
}
