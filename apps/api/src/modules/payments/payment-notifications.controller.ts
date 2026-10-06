import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { requestMeta } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { PaymentsService } from './payments.service';

/**
 * PayHere `notify_url` (server-to-server, `application/x-www-form-urlencoded`).
 * Public by necessity; authenticity comes from the `md5sig` check inside the
 * service, which happens before any database change. Always answers 200 so a
 * forged or replayed message cannot trigger a retry storm; the outcome is
 * recorded in `payment_events`, never revealed to the caller.
 */
@ApiTags('payments')
@Controller('payments')
export class PaymentNotificationsController {
  constructor(private readonly service: PaymentsService) {}

  // Public: called by the gateway, which has no user session; verified by signature.
  @Public()
  @Post('payhere/notify')
  @HttpCode(200)
  @ApiOperation({ summary: 'PayHere payment notification (signature-verified; not for browsers)' })
  async notify(
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
  ): Promise<{ received: true }> {
    await this.service.handleNotification(
      body && typeof body === 'object' ? body : {},
      requestMeta(request),
    );
    return { received: true };
  }
}
