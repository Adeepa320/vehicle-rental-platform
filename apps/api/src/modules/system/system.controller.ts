import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
  type HealthResponse,
  type ReadyResponse,
} from '@vrp/contracts';
import type { Response } from 'express';

import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Public } from '../auth/decorators/public.decorator';
import { SystemService } from './system.service';

/** Mounted under the global prefix and default version: `/api/v1/health`, `/api/v1/ready`. */
@ApiTags('system')
@Public()
@Controller()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('health')
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiZodResponse(200, HealthResponseSchema)
  health(): HealthResponse {
    return this.system.health();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe (database, PostGIS, migrations)' })
  @ApiZodResponse(200, ReadyResponseSchema)
  @ApiZodResponse(503, ReadyResponseSchema, 'Not ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadyResponse> {
    const result = await this.system.readiness();
    response.status(result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
