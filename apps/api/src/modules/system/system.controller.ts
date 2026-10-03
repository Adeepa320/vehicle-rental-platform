import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { HealthResponse, ReadyResponse } from '@vrp/contracts';
import type { Response } from 'express';

import { SystemService } from './system.service';

/** Mounted under the global prefix and default version: `/api/v1/health`, `/api/v1/ready`. */
@Controller()
export class SystemController {
  constructor(private readonly system: SystemService) {}

  @Get('health')
  health(): HealthResponse {
    return this.system.health();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadyResponse> {
    const result = await this.system.readiness();
    response.status(result.status === 'ready' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return result;
  }
}
