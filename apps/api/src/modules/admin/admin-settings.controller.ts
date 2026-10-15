import { Body, Controller, Get, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminSettingsResponseSchema,
  UpdateSettingsRequestSchema,
  type AdminSettingsResponse,
  type UpdateSettingsRequest,
} from '@vrp/contracts';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminSettingsService } from './admin-settings.service';

/** Platform settings: admins read, super admins change (Phase 9, TECH_DECISIONS D63). */
@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly service: AdminSettingsService) {}

  @Get()
  @Roles('admin', 'super_admin')
  @ApiOperation({
    summary: 'Editable settings with meaning, validation hint and concurrency token',
  })
  @ApiZodResponse(200, AdminSettingsResponseSchema)
  async list(): Promise<AdminSettingsResponse> {
    return this.service.list();
  }

  @Put()
  @Roles('super_admin')
  @ApiOperation({
    summary:
      'Change one or more settings atomically (super admin): per-key validation, 409 SETTING_STALE, money pair kept equal, audited with old / new values',
  })
  @ApiZodBody(UpdateSettingsRequestSchema)
  @ApiZodResponse(200, AdminSettingsResponseSchema)
  async update(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(UpdateSettingsRequestSchema)) body: UpdateSettingsRequest,
    @Req() request: Request,
  ): Promise<AdminSettingsResponse> {
    return this.service.update(admin, body, requestMeta(request));
  }
}
