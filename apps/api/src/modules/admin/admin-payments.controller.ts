import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AdminPaymentListSchema,
  AdminPaymentListItemSchema,
  PaymentReconciliationSchema,
  RecordRefundRequestSchema,
  ResolvePaymentRequestSchema,
  type AdminPaymentList,
  type AdminPaymentListItem,
  type PaymentReconciliation,
  type RecordRefundRequest,
  type ResolvePaymentRequest,
} from '@vrp/contracts';
import type { Request } from 'express';
import { z } from 'zod';

import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { ApiZodBody, ApiZodResponse } from '../../openapi/zod-openapi';
import { requestMeta, type AuthenticatedUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PaymentsService } from '../payments/payments.service';

const IdPipe = new ZodValidationPipe(z.uuid());
const LimitPipe = new ZodValidationPipe(z.coerce.number().int().min(1).max(100).default(50));

/** Payment troubleshooting for operators: the manual-resolution queue, refund records, reconciliation. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('admin', 'super_admin')
@Controller('admin/payments')
export class AdminPaymentsController {
  constructor(private readonly service: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Payments flagged for manual resolution, newest first' })
  @ApiZodResponse(200, AdminPaymentListSchema)
  async list(@Query('limit', LimitPipe) limit: number): Promise<AdminPaymentList> {
    return { data: await this.service.listNeedingResolution(limit) };
  }

  @Get(':id')
  @ApiOperation({ summary: 'One payment with its full audit trail' })
  @ApiZodResponse(200, AdminPaymentListItemSchema)
  async get(@Param('id', IdPipe) id: string): Promise<AdminPaymentListItem> {
    return this.service.getForAdmin(id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Record a refund of a paid advance (manual: already done in the PayHere portal / by bank transfer; gateway: call the Refund API)',
  })
  @ApiZodBody(RecordRefundRequestSchema)
  @ApiZodResponse(200, AdminPaymentListItemSchema)
  async refund(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(RecordRefundRequestSchema)) body: RecordRefundRequest,
    @Req() request: Request,
  ): Promise<AdminPaymentListItem> {
    return this.service.recordRefund(admin, id, body, requestMeta(request));
  }

  @Post(':id/resolve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Clear the manual-resolution flag with a note (no money moves)' })
  @ApiZodBody(ResolvePaymentRequestSchema)
  @ApiZodResponse(200, AdminPaymentListItemSchema)
  async resolve(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Body(new ZodValidationPipe(ResolvePaymentRequestSchema)) body: ResolvePaymentRequest,
    @Req() request: Request,
  ): Promise<AdminPaymentListItem> {
    return this.service.resolve(admin, id, body, requestMeta(request));
  }

  @Post(':id/reconcile')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Compare our record with the gateway Retrieval API (503 when not configured)',
  })
  @ApiZodResponse(200, PaymentReconciliationSchema)
  async reconcile(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', IdPipe) id: string,
    @Req() request: Request,
  ): Promise<PaymentReconciliation> {
    return this.service.reconcile(admin, id, requestMeta(request));
  }
}
