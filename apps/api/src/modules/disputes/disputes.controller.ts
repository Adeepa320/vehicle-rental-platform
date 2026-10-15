import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  BookingDisputeStateSchema,
  DisputeMessageRequestSchema,
  DisputeSchema,
  OpenDisputeRequestSchema,
  type BookingDisputeState,
  type Dispute,
  type DisputeMessageRequest,
  type OpenDisputeRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { AuthThrottle } from '../auth/auth-throttle';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { DisputesService } from './disputes.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Participant side of disputes: the booking's customer or the vehicle's provider; anyone else is 404. */
@ApiTags('disputes')
@ApiBearerAuth()
@Controller()
export class DisputesController {
  constructor(private readonly service: DisputesService) {}

  @Get('bookings/:id/dispute')
  @ApiOperation({
    summary: 'Dispute eligibility for a booking I am party to, plus the dispute if one exists',
  })
  @ApiZodResponse(200, BookingDisputeStateSchema)
  async state(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<BookingDisputeState> {
    return this.service.stateForBooking(user, id);
  }

  @Post('bookings/:id/dispute')
  @HttpCode(201)
  @AuthThrottle('thread')
  @ApiOperation({
    summary:
      'Open the one dispute of a booking (active / completed / no-show / cancelled, within the dispute window)',
  })
  @ApiZodBody(OpenDisputeRequestSchema)
  @ApiZodResponse(201, DisputeSchema)
  async open(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(OpenDisputeRequestSchema)) body: OpenDisputeRequest,
    @Req() request: Request,
  ): Promise<Dispute> {
    return this.service.open(user, id, body, requestMeta(request));
  }

  @Get('disputes/:id')
  @ApiOperation({
    summary: 'A dispute I am party to, with the thread (never the internal admin note)',
  })
  @ApiZodResponse(200, DisputeSchema)
  async get(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<Dispute> {
    return this.service.getForParticipant(user, id);
  }

  @Post('disputes/:id/messages')
  @HttpCode(201)
  @AuthThrottle('thread')
  @ApiOperation({ summary: 'Post a message to the thread while the dispute is open or in review' })
  @ApiZodBody(DisputeMessageRequestSchema)
  @ApiZodResponse(201, DisputeSchema)
  async message(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(DisputeMessageRequestSchema)) body: DisputeMessageRequest,
    @Req() request: Request,
  ): Promise<Dispute> {
    return this.service.addMessage(user, id, body, requestMeta(request));
  }
}
