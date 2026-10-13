import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BookingReviewStateSchema,
  CreateReviewRequestSchema,
  CustomerReviewSchema,
  type BookingReviewState,
  type CreateReviewRequest,
  type CustomerReview,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ReviewsService } from './reviews.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** The customer's review of their own completed booking (anyone else's booking is 404). */
@ApiTags('reviews')
@ApiBearerAuth()
@Controller('bookings/:id/review')
export class ReviewsController {
  constructor(private readonly service: ReviewsService) {}

  @Get()
  @ApiOperation({
    summary: 'Review eligibility for my booking plus my existing review, if any',
    description:
      'Eligible when the booking is completed, the review window (platform setting `review_window_days`) is open and no review exists yet.',
  })
  @ApiZodResponse(200, BookingReviewStateSchema)
  async state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<BookingReviewState> {
    return this.service.stateForBooking(user, id);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Review my completed booking (published immediately; one per booking)',
    description:
      'Errors: 409 INVALID_STATE_TRANSITION (not completed), 409 REVIEW_WINDOW_CLOSED, 409 ALREADY_REVIEWED. Identity fields are derived from the booking; client-supplied ids are rejected.',
  })
  @ApiZodBody(CreateReviewRequestSchema)
  @ApiZodResponse(201, CustomerReviewSchema)
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(CreateReviewRequestSchema)) body: CreateReviewRequest,
    @Req() request: Request,
  ): Promise<CustomerReview> {
    return this.service.create(user, id, body, requestMeta(request));
  }

  @Put()
  @HttpCode(200)
  @ApiOperation({
    summary: 'Edit my review (ratings and comment) while the review window is open',
  })
  @ApiZodBody(CreateReviewRequestSchema)
  @ApiZodResponse(200, CustomerReviewSchema)
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(CreateReviewRequestSchema)) body: CreateReviewRequest,
    @Req() request: Request,
  ): Promise<CustomerReview> {
    return this.service.update(user, id, body, requestMeta(request));
  }
}
