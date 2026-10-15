import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminUserDetailSchema,
  AdminUserListQuerySchema,
  AdminUserListSchema,
  AnonymiseUserRequestSchema,
  ReactivateUserRequestSchema,
  SuspendUserRequestSchema,
  type AdminUserDetail,
  type AdminUserList,
  type AdminUserListQuery,
  type AnonymiseUserRequest,
  type ReactivateUserRequest,
  type SuspendUserRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AdminUsersService } from './admin-users.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** User administration (Phase 9, PRD FR-AD2): search, safe detail, suspend / reactivate, anonymise. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly service: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: 'Search users by e-mail / name, status, role or creation date' })
  @ApiZodResponse(200, AdminUserListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminUserListQuerySchema)) query: AdminUserListQuery,
  ): Promise<AdminUserList> {
    return this.service.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One user with provider link, booking counts, open blockers (never hashes or tokens)',
  })
  @ApiZodResponse(200, AdminUserDetailSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminUserDetail> {
    return this.service.get(id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspend an active account (reason required; every session revoked; audited)',
  })
  @ApiZodBody(SuspendUserRequestSchema)
  @ApiZodResponse(200, AdminUserDetailSchema)
  async suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(SuspendUserRequestSchema)) body: SuspendUserRequest,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.service.suspend(admin, id, body, requestMeta(request));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Lift a suspension (audited)' })
  @ApiZodBody(ReactivateUserRequestSchema)
  @ApiZodResponse(200, AdminUserDetailSchema)
  async reactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReactivateUserRequestSchema)) body: ReactivateUserRequest,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.service.reactivate(admin, id, body, requestMeta(request));
  }

  @Post(':id/anonymise')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Irreversibly anonymise an account after retention checks (409 ACCOUNT_ANONYMISATION_BLOCKED with blockers)',
  })
  @ApiZodBody(AnonymiseUserRequestSchema)
  @ApiZodResponse(200, AdminUserDetailSchema)
  async anonymise(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AnonymiseUserRequestSchema)) body: AnonymiseUserRequest,
    @Req() request: Request,
  ): Promise<AdminUserDetail> {
    return this.service.anonymise(admin, id, body, requestMeta(request));
  }
}
