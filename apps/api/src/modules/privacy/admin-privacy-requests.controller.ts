import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminCreatePrivacyRequestSchema,
  AdminPrivacyRequestCompleteAccessSchema,
  AdminPrivacyRequestCompleteDeletionSchema,
  AdminPrivacyRequestListQuerySchema,
  AdminPrivacyRequestListSchema,
  AdminPrivacyRequestNoteSchema,
  AdminPrivacyRequestRejectSchema,
  AdminPrivacyRequestSchema,
  UserDataExportSchema,
  type AdminCreatePrivacyRequest,
  type AdminPrivacyRequest,
  type AdminPrivacyRequestCompleteAccess,
  type AdminPrivacyRequestCompleteDeletion,
  type AdminPrivacyRequestList,
  type AdminPrivacyRequestListQuery,
  type AdminPrivacyRequestNote,
  type AdminPrivacyRequestReject,
  type UserDataExport,
} from '@vrp/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrivacyRequestsService } from './privacy-requests.service';
import { sendJsonAttachment } from './privacy.controller';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Operator queue for data-subject requests (Phase 10); every action is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/privacy-requests')
export class AdminPrivacyRequestsController {
  constructor(private readonly privacy: PrivacyRequestsService) {}

  @Get()
  @ApiOperation({ summary: 'List data-subject requests (newest first, keyset pagination)' })
  @ApiZodResponse(200, AdminPrivacyRequestListSchema)
  list(
    @Query(new ZodValidationPipe(AdminPrivacyRequestListQuerySchema))
    query: AdminPrivacyRequestListQuery,
  ): Promise<AdminPrivacyRequestList> {
    return this.privacy.adminList(query);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Record a request received outside the product (e-mail, phone)' })
  @ApiZodBody(AdminCreatePrivacyRequestSchema)
  @ApiZodResponse(201, AdminPrivacyRequestSchema)
  create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body(new ZodValidationPipe(AdminCreatePrivacyRequestSchema)) body: AdminCreatePrivacyRequest,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.adminCreate(admin, body, requestMeta(request));
  }

  @Get(':id')
  @ApiOperation({ summary: 'One request with the requester, notes and current blockers' })
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  get(@Param('id', IdPipe) id: string): Promise<AdminPrivacyRequest> {
    return this.privacy.adminGet(id);
  }

  @Get(':id/export')
  @ApiOperation({
    summary: 'Generate the requester’s personal-data export (audited; JSON attachment)',
  })
  @ApiZodResponse(200, UserDataExportSchema)
  async exportData(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDataExport> {
    const data = await this.privacy.exportForAdmin(admin, id, requestMeta(request));
    sendJsonAttachment(response, `privacy-request-${id}-export.json`);
    return data;
  }

  @Post(':id/start-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Take the request (open → in_review)' })
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  startReview(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.startReview(admin, id, requestMeta(request));
  }

  @Put(':id/internal-note')
  @ApiOperation({ summary: 'Replace the internal note (never shown to the requester)' })
  @ApiZodBody(AdminPrivacyRequestNoteSchema)
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  internalNote(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AdminPrivacyRequestNoteSchema)) body: AdminPrivacyRequestNote,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.setInternalNote(admin, id, body.note, requestMeta(request));
  }

  @Post(':id/complete-access')
  @HttpCode(200)
  @ApiOperation({ summary: 'Close an access request as completed (the export was provided)' })
  @ApiZodBody(AdminPrivacyRequestCompleteAccessSchema)
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  completeAccess(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AdminPrivacyRequestCompleteAccessSchema))
    body: AdminPrivacyRequestCompleteAccess,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.completeAccess(admin, id, body, requestMeta(request));
  }

  @Post(':id/complete-deletion')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Anonymise the account through the Phase 9 flow (blockers and e-mail confirmation apply) and close the request',
  })
  @ApiZodBody(AdminPrivacyRequestCompleteDeletionSchema)
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  completeDeletion(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AdminPrivacyRequestCompleteDeletionSchema))
    body: AdminPrivacyRequestCompleteDeletion,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.completeDeletion(admin, id, body, requestMeta(request));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject the request with a note the requester will read' })
  @ApiZodBody(AdminPrivacyRequestRejectSchema)
  @ApiZodResponse(200, AdminPrivacyRequestSchema)
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AdminPrivacyRequestRejectSchema)) body: AdminPrivacyRequestReject,
    @Req() request: Request,
  ): Promise<AdminPrivacyRequest> {
    return this.privacy.reject(admin, id, body, requestMeta(request));
  }
}
