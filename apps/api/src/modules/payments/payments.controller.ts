import { Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CheckoutSessionSchema,
  PaymentListSchema,
  type CheckoutSession,
  type PaymentList,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaymentsService } from './payments.service';

const IdPipe = new ZodValidationPipe(z.uuid());

/** Customer side of the online advance. */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('bookings/:id/payments')
export class PaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Post('checkout')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Create or reuse the pending advance payment of an accepted booking and get the gateway form (amount from the booking snapshot)',
  })
  @ApiZodResponse(200, CheckoutSessionSchema)
  async checkout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<CheckoutSession> {
    return this.service.createCheckout(user, id, requestMeta(request));
  }

  @Get()
  @ApiOperation({ summary: 'Payment attempts of my booking, oldest first' })
  @ApiZodResponse(200, PaymentListSchema)
  async list(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
  ): Promise<PaymentList> {
    return { data: await this.service.listForCustomer(user, id) };
  }
}
