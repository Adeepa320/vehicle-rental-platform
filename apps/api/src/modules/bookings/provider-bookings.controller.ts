import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AcceptBookingRequestSchema,
  BookingListSchema,
  BookingSchema,
  CancelBookingRequestSchema,
  DeclineBookingRequestSchema,
  HandoverRequestSchema,
  NoShowBookingRequestSchema,
  ProviderBookingListQuerySchema,
  type AcceptBookingRequest,
  type Booking,
  type BookingList,
  type CancelBookingRequest,
  type DeclineBookingRequest,
  type HandoverRequest,
  type NoShowBookingRequest,
  type ProviderBookingListQuery,
} from '@vrp/contracts';
import type { ProviderProfile } from '@vrp/database';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta } from '../auth/auth.types';
import { CurrentProvider } from '../providers/decorators/current-provider.decorator';
import { ActiveProviderGuard } from '../providers/guards/active-provider.guard';
import { BookingsService } from './bookings.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Provider inbox and transitions; scoped to the caller's own bookings (others are 404). */
@ApiTags('providers')
@ApiBearerAuth()
@UseGuards(ActiveProviderGuard)
@Controller('providers/me/bookings')
export class ProviderBookingsController {
  constructor(private readonly service: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Bookings on my vehicles, newest first; filter by status, scope or vehicle',
  })
  @ApiZodResponse(200, BookingListSchema)
  async list(
    @CurrentProvider() provider: ProviderProfile,
    @Query(new ZodValidationPipe(ProviderBookingListQuerySchema)) query: ProviderBookingListQuery,
  ): Promise<BookingList> {
    return this.service.listForProvider(provider.id, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One of my bookings with the driver snapshot and timeline' })
  @ApiZodResponse(200, BookingSchema)
  async get(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
  ): Promise<Booking> {
    return this.service.getForProvider(provider.id, id);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Accept a request: creates the exclusive hold and auto-declines overlapping requests (requested → accepted)',
  })
  @ApiZodBody(AcceptBookingRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async accept(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(AcceptBookingRequestSchema)) body: AcceptBookingRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.accept(provider, id, body, requestMeta(request));
  }

  @Post(':id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Decline a request with a reason (requested → declined)' })
  @ApiZodBody(DeclineBookingRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async decline(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(DeclineBookingRequestSchema)) body: DeclineBookingRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.decline(provider, id, body, requestMeta(request));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancel an accepted or confirmed booking (hold released)' })
  @ApiZodBody(CancelBookingRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async cancel(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(CancelBookingRequestSchema)) body: CancelBookingRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.cancelByProvider(provider, id, body, requestMeta(request));
  }

  @Post(':id/pickup')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the handover (confirmed → active)' })
  @ApiZodBody(HandoverRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async pickup(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(HandoverRequestSchema)) body: HandoverRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.pickup(provider, id, body, requestMeta(request));
  }

  @Post(':id/return')
  @HttpCode(200)
  @ApiOperation({ summary: 'Record the return (active → completed; the hold stays as history)' })
  @ApiZodBody(HandoverRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async complete(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(HandoverRequestSchema)) body: HandoverRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.complete(provider, id, body, requestMeta(request));
  }

  @Post(':id/no-show')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Mark a confirmed booking as no-show after the grace period (hold released)',
  })
  @ApiZodBody(NoShowBookingRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async noShow(
    @CurrentProvider() provider: ProviderProfile,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(NoShowBookingRequestSchema)) body: NoShowBookingRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.noShow(provider, id, body, requestMeta(request));
  }
}
