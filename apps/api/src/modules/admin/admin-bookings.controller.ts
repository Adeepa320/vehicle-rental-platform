import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminBookingListQuerySchema,
  AdminBookingListSchema,
  AdminBookingSchema,
  AdminCancelBookingRequestSchema,
  AdminCancellationActorSchema,
  CancellationPreviewSchema,
  ResendNotificationRequestSchema,
  ResendNotificationResponseSchema,
  type AdminBooking,
  type AdminBookingList,
  type AdminBookingListQuery,
  type AdminCancelBookingRequest,
  type AdminCancellationActor,
  type CancellationPreview,
  type ResendNotificationRequest,
  type ResendNotificationResponse,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingsService } from '../bookings/bookings.service';

const IdPipe = new ZodValidationPipe(z.uuid());
const ActorPipe = new ZodValidationPipe(AdminCancellationActorSchema);

/**
 * Admin booking operations (Phase 9, PRD FR-AD4): search, inspection,
 * cancellation on behalf of a party or the platform (through the state
 * machine; never a generic status setter), and allow-listed re-sends. The
 * Phase 6 `confirm-for-testing` bridge stays removed (TECH_DECISIONS D56):
 * `accepted → confirmed` happens only through a verified payment.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get()
  @ApiOperation({
    summary:
      'All bookings, newest first; filter by status, provider, customer, vehicle, reference, free text or rental dates',
  })
  @ApiZodResponse(200, AdminBookingListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminBookingListQuerySchema)) query: AdminBookingListQuery,
  ): Promise<AdminBookingList> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Full booking with timeline, hold, both parties’ e-mail, payment attempts, dispute / review links and the applicable re-sends',
  })
  @ApiZodResponse(200, AdminBookingSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminBooking> {
    return this.service.getForAdmin(id);
  }

  @Get(':id/cancellation-preview')
  @ApiOperation({
    summary: 'What cancelling on behalf of customer / provider / platform would do (no change)',
  })
  @ApiZodResponse(200, CancellationPreviewSchema)
  async preview(
    @Param('id', IdPipe) id: string,
    @Query('actor', ActorPipe) actor: AdminCancellationActor,
  ): Promise<CancellationPreview> {
    return this.service.cancellationPreview(id, actor);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel through the state machine on behalf of the customer, the provider or the platform (hold released; refund rule applied; audited; both parties notified)',
  })
  @ApiZodBody(AdminCancelBookingRequestSchema)
  @ApiZodResponse(200, AdminBookingSchema)
  async cancel(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AdminCancelBookingRequestSchema)) body: AdminCancelBookingRequest,
    @Req() request: Request,
  ): Promise<AdminBooking> {
    return this.service.cancelByAdmin(admin, id, body, requestMeta(request));
  }

  @Post(':id/resend')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Re-send one allow-listed transactional e-mail; recipient and wording come from the booking (audited)',
  })
  @ApiZodBody(ResendNotificationRequestSchema)
  @ApiZodResponse(200, ResendNotificationResponseSchema)
  async resend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ResendNotificationRequestSchema)) body: ResendNotificationRequest,
    @Req() request: Request,
  ): Promise<ResendNotificationResponse> {
    return this.service.resendNotification(admin, id, body.template, requestMeta(request));
  }
}
