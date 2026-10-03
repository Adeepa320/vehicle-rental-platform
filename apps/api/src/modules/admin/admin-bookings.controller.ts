import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminBookingListQuerySchema,
  AdminBookingListSchema,
  AdminBookingSchema,
  ConfirmBookingForTestingRequestSchema,
  type AdminBooking,
  type AdminBookingList,
  type AdminBookingListQuery,
  type ConfirmBookingForTestingRequest,
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

/**
 * Admin inspection of bookings plus the temporary Phase 6 confirmation bridge
 * (TECH_DECISIONS D51). No cancel / refund / payment operations yet.
 */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'All bookings, newest first; filter by status, provider, customer or reference',
  })
  @ApiZodResponse(200, AdminBookingListSchema)
  async list(
    @Query(new ZodValidationPipe(AdminBookingListQuerySchema)) query: AdminBookingListQuery,
  ): Promise<AdminBookingList> {
    return this.service.listForAdmin(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full booking with timeline, hold and both parties’ e-mail' })
  @ApiZodResponse(200, AdminBookingSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminBooking> {
    return this.service.getForAdmin(id);
  }

  @Post(':id/confirm-for-testing')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'TEMPORARY (Phase 6, non-production only): confirm an accepted booking without payment (accepted → confirmed)',
  })
  @ApiZodBody(ConfirmBookingForTestingRequestSchema)
  @ApiZodResponse(200, AdminBookingSchema)
  async confirmForTesting(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmBookingForTestingRequestSchema))
    body: ConfirmBookingForTestingRequest,
    @Req() request: Request,
  ): Promise<AdminBooking> {
    return this.service.confirmForTesting(admin, id, body, requestMeta(request));
  }
}
