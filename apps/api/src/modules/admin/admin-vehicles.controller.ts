import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminVehicleListQuerySchema,
  AdminVehicleListSchema,
  AdminVehicleSchema,
  ReactivateVehicleRequestSchema,
  SuspendVehicleRequestSchema,
  VehicleReviewNotesRequestSchema,
  VehicleReviewReasonRequestSchema,
  type AdminVehicle,
  type AdminVehicleList,
  type AdminVehicleListQuery,
  type ReactivateVehicleRequest,
  type SuspendVehicleRequest,
  type VehicleReviewNotesRequest,
  type VehicleReviewReasonRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { toAdminVehicle, toAdminVehicleSummary } from '../catalogue/vehicle.mappers';
import { AdminVehicleReviewService } from './admin-vehicle-review.service';

const IdPipe = new ZodValidationPipe(z.uuid());

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/vehicles')
export class AdminVehiclesController {
  constructor(private readonly review: AdminVehicleReviewService) {}

  @Get()
  @ApiOperation({ summary: 'Vehicle listings, newest first; filter by status or provider' })
  @ApiZodResponse(200, AdminVehicleListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminVehicleListQuerySchema)) query: AdminVehicleListQuery,
  ): Promise<AdminVehicleList> {
    const page = await this.review.list(query);
    return {
      data: page.data.map((row) => toAdminVehicleSummary(row.vehicle, row.provider)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Full listing with provider, owner, pickup location and internal notes',
  })
  @ApiZodResponse(200, AdminVehicleSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminVehicle> {
    const d = await this.review.get(id);
    return toAdminVehicle(d.vehicle, d.provider, d.owner, d.location, d.locationVehicleCount);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'submitted → under_review' })
  @ApiZodBody(VehicleReviewNotesRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async startReview(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(VehicleReviewNotesRequestSchema)) body: VehicleReviewNotesRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.startReview(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @ApiOperation({ summary: 'submitted | under_review → changes_requested (reason e-mailed)' })
  @ApiZodBody(VehicleReviewReasonRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async requestChanges(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(VehicleReviewReasonRequestSchema))
    body: VehicleReviewReasonRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.requestChanges(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'submitted | under_review → approved (completeness re-checked)' })
  @ApiZodBody(VehicleReviewNotesRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async approve(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(VehicleReviewNotesRequestSchema)) body: VehicleReviewNotesRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.approve(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'submitted | under_review → rejected (terminal; reason e-mailed)' })
  @ApiZodBody(VehicleReviewReasonRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async reject(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(VehicleReviewReasonRequestSchema))
    body: VehicleReviewReasonRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.reject(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/suspend')
  @HttpCode(200)
  @ApiOperation({ summary: 'approved | inactive → suspended (never available while suspended)' })
  @ApiZodBody(SuspendVehicleRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async suspend(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(SuspendVehicleRequestSchema)) body: SuspendVehicleRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.suspend(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @ApiOperation({ summary: 'suspended → approved' })
  @ApiZodBody(ReactivateVehicleRequestSchema)
  @ApiZodResponse(200, AdminVehicleSchema)
  async reactivate(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReactivateVehicleRequestSchema)) body: ReactivateVehicleRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminVehicle> {
    await this.review.reactivate(id, admin, body, requestMeta(request));
    return this.get(id);
  }
}
