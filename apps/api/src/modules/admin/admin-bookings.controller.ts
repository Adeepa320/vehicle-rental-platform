import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminBookingListQuerySchema,
  AdminBookingListSchema,
  AdminBookingSchema,
  type AdminBooking,
  type AdminBookingList,
  type AdminBookingListQuery,
} from '@vrp/contracts';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { Roles } from '../auth/decorators/roles.decorator';
import { BookingsService } from '../bookings/bookings.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/**
 * Admin inspection of bookings. The Phase 6 `confirm-for-testing` bridge was
 * removed in Phase 7 (TECH_DECISIONS D56): bookings are confirmed only by a
 * verified payment. Refunds and resolution live under `/admin/payments`.
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
  @ApiOperation({
    summary: 'Full booking with timeline, hold, both parties’ e-mail and payment attempts',
  })
  @ApiZodResponse(200, AdminBookingSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminBooking> {
    return this.service.getForAdmin(id);
  }
}
