import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { LivenessResponseDto, ReadinessResponseDto } from './dto/health-response.dto';
import { HealthService } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check process liveness (compatibility alias)' })
  @ApiOkResponse({ type: LivenessResponseDto })
  check(): LivenessResponseDto {
    return { status: 'ok' };
  }

  @Get('live')
  @ApiOperation({ summary: 'Check process liveness' })
  @ApiOkResponse({ type: LivenessResponseDto })
  checkLiveness(): LivenessResponseDto {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Check NestJS and PostgreSQL readiness' })
  @ApiOkResponse({ type: ReadinessResponseDto })
  @ApiServiceUnavailableResponse({ type: ReadinessResponseDto })
  async checkReadiness(): Promise<ReadinessResponseDto> {
    const readiness = await this.health.checkReadiness();
    if (readiness.status === 'unavailable') {
      throw new ServiceUnavailableException(readiness);
    }
    return readiness;
  }
}
