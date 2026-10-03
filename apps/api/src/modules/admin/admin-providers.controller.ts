import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminProviderDetailSchema,
  AdminProviderListQuerySchema,
  AdminProviderListSchema,
  ReactivateProviderRequestSchema,
  SuspendProviderRequestSchema,
  type AdminProviderDetail,
  type AdminProviderList,
  type AdminProviderListQuery,
  type ReactivateProviderRequest,
  type SuspendProviderRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { toAdminProviderDetail, toAdminProviderSummary } from '../providers/provider.mappers';
import { AdminReviewService } from './admin-review.service';

const IdPipe = new ZodValidationPipe(z.uuid());

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly review: AdminReviewService) {}

  @Get()
  @ApiOperation({ summary: 'List approved providers (active and suspended)' })
  @ApiZodResponse(200, AdminProviderListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminProviderListQuerySchema)) query: AdminProviderListQuery,
  ): Promise<AdminProviderList> {
    const page = await this.review.listProviders(query);
    return {
      data: page.data.map((row) => toAdminProviderSummary(row.profile, row.owner)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Provider profile with owner and application reference' })
  @ApiZodResponse(200, AdminProviderDetailSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminProviderDetail> {
    const { profile, relations, owner } = await this.review.getProvider(id);
    return toAdminProviderDetail(profile, relations, owner);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'Suspend an active provider (keeps the role; blocks provider actions)' })
  @ApiZodBody(SuspendProviderRequestSchema)
  @ApiZodResponse(200, AdminProviderDetailSchema)
  async suspend(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(SuspendProviderRequestSchema)) body: SuspendProviderRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderDetail> {
    await this.review.suspend(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reactivate a suspended provider' })
  @ApiZodBody(ReactivateProviderRequestSchema)
  @ApiZodResponse(200, AdminProviderDetailSchema)
  async reactivate(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReactivateProviderRequestSchema)) body: ReactivateProviderRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderDetail> {
    await this.review.reactivate(id, admin, body, requestMeta(request));
    return this.get(id);
  }
}
