import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminProviderApplicationListQuerySchema,
  AdminProviderApplicationListSchema,
  AdminProviderApplicationSchema,
  ApproveApplicationRequestSchema,
  ReviewReasonRequestSchema,
  StartReviewRequestSchema,
  type AdminProviderApplication,
  type AdminProviderApplicationList,
  type AdminProviderApplicationListQuery,
  type ApproveApplicationRequest,
  type ReviewReasonRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { toAdminApplication, toAdminApplicationSummary } from '../providers/provider.mappers';
import { AdminReviewService } from './admin-review.service';

const IdPipe = new ZodValidationPipe(z.uuid());

@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/provider-applications')
export class AdminProviderApplicationsController {
  constructor(private readonly review: AdminReviewService) {}

  @Get()
  @ApiOperation({ summary: 'List provider applications (newest first, cursor paginated)' })
  @ApiZodResponse(200, AdminProviderApplicationListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminProviderApplicationListQuerySchema))
    query: AdminProviderApplicationListQuery,
  ): Promise<AdminProviderApplicationList> {
    const page = await this.review.listApplications(query);
    return {
      data: page.data.map((row) => toAdminApplicationSummary(row.application, row.applicant)),
      nextCursor: page.nextCursor,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Inspect an application with applicant details and internal notes' })
  @ApiZodResponse(200, AdminProviderApplicationSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminProviderApplication> {
    const { application, applicant } = await this.review.getApplication(id);
    return toAdminApplication(application, applicant);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a submitted application as under review' })
  @ApiZodBody(StartReviewRequestSchema)
  @ApiZodResponse(200, AdminProviderApplicationSchema)
  async startReview(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(StartReviewRequestSchema)) body: { adminNotes?: string },
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderApplication> {
    await this.review.startReview(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/request-changes')
  @HttpCode(200)
  @ApiOperation({ summary: 'Send the application back to the applicant with a reason' })
  @ApiZodBody(ReviewReasonRequestSchema)
  @ApiZodResponse(200, AdminProviderApplicationSchema)
  async requestChanges(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReviewReasonRequestSchema)) body: ReviewReasonRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderApplication> {
    await this.review.requestChanges(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Approve: creates the provider profile and grants the provider role atomically',
  })
  @ApiZodBody(ApproveApplicationRequestSchema)
  @ApiZodResponse(200, AdminProviderApplicationSchema)
  async approve(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ApproveApplicationRequestSchema)) body: ApproveApplicationRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderApplication> {
    await this.review.approve(id, admin, body, requestMeta(request));
    return this.get(id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject an application with a reason (terminal)' })
  @ApiZodBody(ReviewReasonRequestSchema)
  @ApiZodResponse(200, AdminProviderApplicationSchema)
  async reject(
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ReviewReasonRequestSchema)) body: ReviewReasonRequest,
    @CurrentUser() admin: AuthenticatedUser,
    @Req() request: Request,
  ): Promise<AdminProviderApplication> {
    await this.review.reject(id, admin, body, requestMeta(request));
    return this.get(id);
  }
}
