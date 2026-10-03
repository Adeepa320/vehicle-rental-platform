import {
  Body,
  Controller,
  Get,
  Headers as HeaderParam,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BookingContactSchema,
  BookingListQuerySchema,
  BookingListSchema,
  BookingSchema,
  CancelBookingRequestSchema,
  CreateBookingRequestSchema,
  IdempotencyKeySchema,
  type Booking,
  type BookingContact,
  type BookingList,
  type BookingListQuery,
  type CancelBookingRequest,
  type CreateBookingRequest,
} from '@vrp/contracts';
import type { Request, Response } from 'express';
import { z } from 'zod';

import { ApiException } from '../../common/errors/api.exception';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingsService } from './bookings.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Customer side of bookings, plus the participant-aware detail and contact routes. */
@ApiTags('bookings')
@ApiBearerAuth()
@Controller('bookings')
export class BookingsController {
  constructor(private readonly service: BookingsService) {}

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Create a booking request (no hold is created; the provider accepts or declines). Requires Idempotency-Key.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: '8–128 chars, unique per request',
  })
  @ApiZodBody(CreateBookingRequestSchema)
  @ApiZodResponse(201, BookingSchema)
  @ApiZodResponse(200, BookingSchema, 'Replay of an earlier request with the same Idempotency-Key')
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(CreateBookingRequestSchema)) body: CreateBookingRequest,
    @HeaderParam('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<Booking> {
    const key = IdempotencyKeySchema.safeParse(idempotencyKey ?? '');
    if (!key.success) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request headers', 400, [
        {
          field: 'Idempotency-Key',
          issue:
            idempotencyKey === undefined ? 'required' : (key.error.issues[0]?.message ?? 'invalid'),
        },
      ]);
    }
    const result = await this.service.create(user, body, key.data, requestMeta(request));
    if (result.replayed) {
      response.status(200);
      response.setHeader('Idempotency-Replayed', 'true');
    }
    return result.booking;
  }

  @Get()
  @ApiOperation({ summary: 'My bookings as a customer, newest first' })
  @ApiZodResponse(200, BookingListSchema)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(BookingListQuerySchema)) query: BookingListQuery,
  ): Promise<BookingList> {
    return this.service.listForCustomer(user.id, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'One booking, as seen by the caller (customer or the vehicle’s provider); others get 404',
  })
  @ApiZodResponse(200, BookingSchema)
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<Booking> {
    return this.service.getForParticipant(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Customer cancels a requested, accepted or confirmed booking (hold released)',
  })
  @ApiZodBody(CancelBookingRequestSchema)
  @ApiZodResponse(200, BookingSchema)
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(CancelBookingRequestSchema)) body: CancelBookingRequest,
    @Req() request: Request,
  ): Promise<Booking> {
    return this.service.cancelByCustomer(user, id, body, requestMeta(request));
  }

  @Get(':id/contact')
  @ApiOperation({
    summary: 'Counterparty contact details once the booking reaches the reveal stage (logged)',
  })
  @ApiZodResponse(200, BookingContactSchema)
  async contact(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<BookingContact> {
    return this.service.contact(id, user);
  }
}
