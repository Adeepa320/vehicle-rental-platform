import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AuditEventListQuerySchema,
  AuditEventListSchema,
  type AuditEventList,
  type AuditEventListQuery,
} from '@vrp/contracts';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminAuditService } from './admin-audit.service';

/** Read-only audit trail (Phase 9). There is deliberately no write route. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/audit-events')
export class AdminAuditController {
  constructor(private readonly service: AdminAuditService) {}

  @Get()
  @ApiOperation({
    summary:
      'Audit events, newest first; filter by actor, action (or prefix), target and date range',
  })
  @ApiZodResponse(200, AuditEventListSchema)
  list(
    @Query(new ZodValidationPipe(AuditEventListQuerySchema)) query: AuditEventListQuery,
  ): Promise<AuditEventList> {
    return this.service.list(query);
  }
}
