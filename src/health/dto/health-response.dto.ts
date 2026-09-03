import { ApiProperty } from '@nestjs/swagger';
import type { NestRuntimeState } from '../nest-runtime.service';

export class LivenessResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';
}

export class ReadinessChecksDto {
  @ApiProperty({
    enum: ['initializing', 'ready', 'shutting_down'],
    example: 'ready',
    description: 'NestJS application lifecycle state.',
  })
  nest!: NestRuntimeState;

  @ApiProperty({ enum: ['up', 'down'], example: 'up' })
  postgresql!: 'up' | 'down';
}

export class ReadinessResponseDto {
  @ApiProperty({ enum: ['ok', 'unavailable'], example: 'ok' })
  status!: 'ok' | 'unavailable';

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}
