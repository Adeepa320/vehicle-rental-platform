import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminDisputeListQuerySchema,
  AdminDisputeListSchema,
  AdminDisputeSchema,
  DisputeInternalNoteRequestSchema,
  DisputeMessageRequestSchema,
  RejectDisputeRequestSchema,
  ResolveDisputeRequestSchema,
  StartDisputeReviewRequestSchema,
  type AdminDispute,
  type AdminDisputeList,
  type AdminDisputeListQuery,
  type DisputeInternalNoteRequest,
  type DisputeMessageRequest,
  type RejectDisputeRequest,
  type ResolveDisputeRequest,
  type StartDisputeReviewRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { DisputesService } from '../disputes/disputes.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Dispute queue and decisions (Phase 9, PRD FR-AD5). Decisions never move money. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly service: DisputesService) {}

  @Get()
  @ApiOperation({ summary: 'Disputes, newest first; filter by status or booking' })
  @ApiZodResponse(200, AdminDisputeListSchema)
  list(
    @Query(new ZodValidationPipe(AdminDisputeListQuerySchema)) query: AdminDisputeListQuery,
  ): Promise<AdminDisputeList> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full thread, both parties, payment summary and the internal note' })
  @ApiZodResponse(200, AdminDisputeSchema)
  get(@Param('id', IdPipe) id: string): Promise<AdminDispute> {
    return this.service.getForAdmin(id);
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'open → in_review, assigned to the caller (audited)' })
  @ApiZodBody(StartDisputeReviewRequestSchema)
  @ApiZodResponse(200, AdminDisputeSchema)
  startReview(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(StartDisputeReviewRequestSchema)) body: StartDisputeReviewRequest,
    @Req() request: Request,
  ): Promise<AdminDispute> {
    return this.service.startReview(admin, id, body, requestMeta(request));
  }

  @Post(':id/messages')
  @HttpCode(201)
  @ApiOperation({ summary: 'Public platform message to both parties (notified; audited)' })
  @ApiZodBody(DisputeMessageRequestSchema)
  @ApiZodResponse(201, AdminDisputeSchema)
  message(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(DisputeMessageRequestSchema)) body: DisputeMessageRequest,
    @Req() request: Request,
  ): Promise<AdminDispute> {
    return this.service.addAdminMessage(admin, id, body, requestMeta(request));
  }

  @Put(':id/internal-note')
  @ApiOperation({ summary: 'Set the admin-only note (nobody is notified; audited)' })
  @ApiZodBody(DisputeInternalNoteRequestSchema)
  @ApiZodResponse(200, AdminDisputeSchema)
  internalNote(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(DisputeInternalNoteRequestSchema)) body: DisputeInternalNoteRequest,
    @Req() request: Request,
  ): Promise<AdminDispute> {
    return this.service.setInternalNote(admin, id, body, requestMeta(request));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Resolve with a code and a public note; refund_recommended points at /admin/payments and changes no payment',
  })
  @ApiZodBody(ResolveDisputeRequestSchema)
  @ApiZodResponse(200, AdminDisputeSchema)
  resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ResolveDisputeRequestSchema)) body: ResolveDisputeRequest,
    @Req() request: Request,
  ): Promise<AdminDispute> {
    return this.service.resolve(admin, id, body, requestMeta(request));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject (not upheld) with a public note' })
  @ApiZodBody(RejectDisputeRequestSchema)
  @ApiZodResponse(200, AdminDisputeSchema)
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(RejectDisputeRequestSchema)) body: RejectDisputeRequest,
    @Req() request: Request,
  ): Promise<AdminDispute> {
    return this.service.reject(admin, id, body, requestMeta(request));
  }
}
