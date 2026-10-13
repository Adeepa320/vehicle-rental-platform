import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminReviewListQuerySchema,
  AdminReviewListSchema,
  AdminReviewSchema,
  HideReviewRequestSchema,
  UnhideReviewRequestSchema,
  type AdminReview,
  type AdminReviewList,
  type AdminReviewListQuery,
  type HideReviewRequest,
  type UnhideReviewRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReviewsService } from '../reviews/reviews.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Reactive review moderation: list, inspect, hide with a reason, unhide. Every decision is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/reviews')
export class AdminReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  @ApiOperation({ summary: 'All reviews, newest first; ?status=published|hidden' })
  @ApiZodResponse(200, AdminReviewListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminReviewListQuerySchema)) query: AdminReviewListQuery,
  ): Promise<AdminReviewList> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One review with customer, provider and moderation details' })
  @ApiZodResponse(200, AdminReviewSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminReview> {
    return this.service.getForAdmin(id);
  }

  @Post(':id/hide')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Hide a published review (reason required; audited; customer notified)',
  })
  @ApiZodBody(HideReviewRequestSchema)
  @ApiZodResponse(200, AdminReviewSchema)
  async hide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(HideReviewRequestSchema)) body: HideReviewRequest,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.service.hide(admin, id, body, requestMeta(request));
  }

  @Post(':id/unhide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Restore a hidden review (audited; customer notified)' })
  @ApiZodBody(UnhideReviewRequestSchema)
  @ApiZodResponse(200, AdminReviewSchema)
  async unhide(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(UnhideReviewRequestSchema)) body: UnhideReviewRequest,
    @Req() request: Request,
  ): Promise<AdminReview> {
    return this.service.unhide(admin, id, body, requestMeta(request));
  }
}
