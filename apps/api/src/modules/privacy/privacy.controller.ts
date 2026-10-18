import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateDeletionRequestSchema,
  PrivacyRequestListSchema,
  PrivacyRequestSchema,
  UserDataExportSchema,
  type CreateDeletionRequest,
  type PrivacyRequest,
  type PrivacyRequestList,
  type UserDataExport,
} from '@vrp/contracts';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { AuthThrottle } from '../auth/auth-throttle';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PrivacyRequestsService } from './privacy-requests.service';

/** Marks a JSON body as a download the browser saves rather than renders. */
export function sendJsonAttachment(response: Response, filename: string): void {
  response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
}

/**
 * Data-subject self-service (Phase 10, PRD FR-A7): download the allow-listed
 * personal-data export, ask for deletion, follow the request.
 */
@ApiTags('users')
@ApiBearerAuth()
@Controller('users/me')
export class PrivacyController {
  constructor(private readonly privacy: PrivacyRequestsService) {}

  @Get('export')
  @AuthThrottle('sensitive')
  @ApiOperation({
    summary:
      'Download the personal data the platform holds about the current user (JSON attachment)',
  })
  @ApiZodResponse(200, UserDataExportSchema)
  async exportData(
    @CurrentUser() user: AuthenticatedUser,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<UserDataExport> {
    const data = await this.privacy.exportForSelf(user, requestMeta(request));
    sendJsonAttachment(response, `my-data-${data.generatedAt.slice(0, 10)}.json`);
    return data;
  }

  @Post('delete-request')
  @HttpCode(202)
  @AuthThrottle('sensitive')
  @ApiOperation({
    summary:
      'Ask for the account to be deleted (anonymised); the request is reviewed by the operator',
  })
  @ApiZodBody(CreateDeletionRequestSchema)
  @ApiZodResponse(202, PrivacyRequestSchema)
  requestDeletion(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateDeletionRequestSchema)) body: CreateDeletionRequest,
    @Req() request: Request,
  ): Promise<PrivacyRequest> {
    return this.privacy.createDeletionRequest(user, body, requestMeta(request));
  }

  @Get('privacy-requests')
  @ApiOperation({ summary: 'The current user’s data-subject requests and their status' })
  @ApiZodResponse(200, PrivacyRequestListSchema)
  list(@CurrentUser() user: AuthenticatedUser): Promise<PrivacyRequestList> {
    return this.privacy.listForUser(user.id);
  }
}
