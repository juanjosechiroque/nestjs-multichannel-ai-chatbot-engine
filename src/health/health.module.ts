import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { NestRuntimeService } from './nest-runtime.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService, NestRuntimeService],
})
export class HealthModule {}
