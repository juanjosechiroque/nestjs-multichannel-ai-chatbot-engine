import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { NestRuntimeService } from './nest-runtime.service';

@Module({
  controllers: [HealthController],
  providers: [NestRuntimeService],
})
export class HealthModule {}
