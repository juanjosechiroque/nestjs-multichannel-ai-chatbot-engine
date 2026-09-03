import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from './dto/health-response.dto';
import { NestRuntimeService } from './nest-runtime.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly nestRuntime: NestRuntimeService) {}

  @Get()
  @ApiOperation({ summary: 'Check application health' })
  @ApiOkResponse({ type: HealthResponseDto })
  check(): HealthResponseDto {
    return { status: 'ok', nest: { state: this.nestRuntime.getState() } };
  }
}
