import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminDocumentListQuerySchema,
  AdminDocumentListSchema,
  AdminDocumentSchema,
  ApproveDocumentRequestSchema,
  RejectDocumentRequestSchema,
  RequestDocumentReplacementRequestSchema,
  type AdminDocument,
  type AdminDocumentList,
  type AdminDocumentListQuery,
  type ApproveDocumentRequest,
  type RejectDocumentRequest,
  type RequestDocumentReplacementRequest,
} from '@vrp/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { DocumentsService } from '../documents/documents.service';
import { sendDocument } from '../documents/provider-documents.controller';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Document verification queue and decisions (Phase 9, PRD FR-AD1). Every file read is audited. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/documents')
export class AdminDocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Verification queue; filter by status (incl. expired / superseded), scope, provider, vehicle or expiry horizon',
  })
  @ApiZodResponse(200, AdminDocumentListSchema)
  list(
    @Query(new ZodValidationPipe(AdminDocumentListQuerySchema)) query: AdminDocumentListQuery,
  ): Promise<AdminDocumentList> {
    return this.documents.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One document with its provider, vehicle and review state (no storage key)',
  })
  @ApiZodResponse(200, AdminDocumentSchema)
  get(@Param('id', IdPipe) id: string): Promise<AdminDocument> {
    return this.documents.getForAdmin(id);
  }

  @Get(':id/content')
  @ApiOperation({
    summary:
      'Stream the private file to the reviewer (audited as document.viewed; never a shareable URL)',
  })
  async content(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    sendDocument(response, await this.documents.contentForAdmin(admin, id, requestMeta(request)));
  }

  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({
    summary: 'pending → approved (optionally recording the expiry printed on the document)',
  })
  @ApiZodBody(ApproveDocumentRequestSchema)
  @ApiZodResponse(200, AdminDocumentSchema)
  approve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ApproveDocumentRequestSchema)) body: ApproveDocumentRequest,
    @Req() request: Request,
  ): Promise<AdminDocument> {
    return this.documents.approve(admin, id, body, requestMeta(request));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'pending → rejected with a reason the provider sees' })
  @ApiZodBody(RejectDocumentRequestSchema)
  @ApiZodResponse(200, AdminDocumentSchema)
  reject(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(RejectDocumentRequestSchema)) body: RejectDocumentRequest,
    @Req() request: Request,
  ): Promise<AdminDocument> {
    return this.documents.reject(admin, id, body, requestMeta(request));
  }

  @Post(':id/request-replacement')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ask for a new version of an approved document (it stays valid meanwhile)',
  })
  @ApiZodBody(RequestDocumentReplacementRequestSchema)
  @ApiZodResponse(200, AdminDocumentSchema)
  requestReplacement(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(RequestDocumentReplacementRequestSchema))
    body: RequestDocumentReplacementRequest,
    @Req() request: Request,
  ): Promise<AdminDocument> {
    return this.documents.requestReplacement(admin, id, body, requestMeta(request));
  }
}
