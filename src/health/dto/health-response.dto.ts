import { ApiProperty } from '@nestjs/swagger';
import type { NestRuntimeState } from '../nest-runtime.service';

export class NestRuntimeStatusDto {
  @ApiProperty({
    enum: ['initializing', 'ready', 'shutting_down'],
    example: 'ready',
    description: 'NestJS application lifecycle state.',
  })
  state!: NestRuntimeState;
}

export class HealthResponseDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ type: NestRuntimeStatusDto })
  nest!: NestRuntimeStatusDto;
}
