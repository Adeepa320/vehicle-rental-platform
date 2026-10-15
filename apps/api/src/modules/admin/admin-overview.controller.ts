import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminOverviewSchema, type AdminOverview } from '@vrp/contracts';

import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminOverviewService } from './admin-overview.service';

/** Operations home counts (Phase 9). */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/overview')
export class AdminOverviewController {
  constructor(private readonly service: AdminOverviewService) {}

  @Get()
  @ApiOperation({ summary: 'Queues that need a human, with counts and console links (no PII)' })
  @ApiZodResponse(200, AdminOverviewSchema)
  overview(): Promise<AdminOverview> {
    return this.service.overview();
  }
}
