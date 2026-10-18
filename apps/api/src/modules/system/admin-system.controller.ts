import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkerStatusSchema, type WorkerStatus } from '@vrp/contracts';

import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Roles } from '../auth/decorators/roles.decorator';
import { WorkerStatusService } from './worker-status.service';

/** Protected diagnostics for operators (Phase 10); the public probes stay minimal. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/system')
export class AdminSystemController {
  constructor(private readonly workerStatus: WorkerStatusService) {}

  @Get('worker')
  @ApiOperation({
    summary: 'Worker heartbeat, registered schedules and per-queue counts from the job tables',
  })
  @ApiZodResponse(200, WorkerStatusSchema)
  worker(): Promise<WorkerStatus> {
    return this.workerStatus.status();
  }
}
