import { Body, Controller, Inject, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { requestMeta } from '../auth/auth.types';
import { Public } from '../auth/decorators/public.decorator';
import { escapeHtml } from '../notifications/email/templates';
import { FakeGateway } from './gateway/fake.gateway';
import { PAYMENT_GATEWAY, type PaymentGateway } from './gateway/payment-gateway';
import { field } from './gateway/payhere.crypto';
import { PaymentsService } from './payments.service';

/**
 * Local stand-in for PayHere's hosted page (TECH_DECISIONS D53): shows the
 * order and offers "pay", "cancel" and "fail" buttons. Completing an outcome
 * builds a PayHere-shaped notification, signs it with the fake merchant secret
 * and feeds it through the exact same `handleNotification` path as the real
 * `notify_url`, then redirects the browser to the return/cancel URL.
 * Answers 404 unless the fake gateway is configured; never in production.
 */
@ApiExcludeController()
@Controller('payments/fake')
export class FakeGatewayController {
  private readonly enabled: boolean;

  constructor(
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    private readonly service: PaymentsService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled =
      gateway.name === 'fake' && config.get('NODE_ENV', { infer: true }) !== 'production';
  }

  // Public: this is the (simulated) gateway's own page; it acts only on signed notifications it creates itself.
  @Public()
  @Post('checkout')
  checkout(@Body() body: Record<string, unknown>, @Res() res: Response): void {
    this.assertEnabled();
    const f = (name: string) => escapeHtml(field(body, name));
    const hidden = ['order_id', 'amount', 'currency', 'return_url', 'cancel_url', 'items']
      .map((name) => `<input type="hidden" name="${name}" value="${f(name)}">`)
      .join('');
    const button = (outcome: string, label: string, colour: string) =>
      `<form method="post" action="complete" style="display:inline">${hidden}<input type="hidden" name="outcome" value="${outcome}"><button type="submit" style="padding:10px 16px;margin:4px;border:0;border-radius:6px;background:${colour};color:#fff;font-size:15px;cursor:pointer">${label}</button></form>`;
    res.status(200).type('html')
      .send(`<!doctype html><html><head><meta charset="utf-8"><title>Fake payment gateway</title></head>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;color:#111">
<h1 style="font-size:20px">Fake payment gateway (local development)</h1>
<p style="color:#666;font-size:14px">No real payment happens here. This page stands in for PayHere’s hosted checkout and sends a signed notification to the API exactly like PayHere would.</p>
<table style="font-size:15px;border-collapse:collapse"><tr><td style="padding:4px 12px 4px 0;color:#666">Order</td><td>${f('order_id')}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">Item</td><td>${f('items')}</td></tr><tr><td style="padding:4px 12px 4px 0;color:#666">Amount</td><td><strong>${f('currency')} ${f('amount')}</strong></td></tr></table>
<p>${button('success', 'Pay successfully', '#111')}${button('cancel', 'Cancel payment', '#666')}${button('fail', 'Simulate a failed payment', '#b91c1c')}</p>
</body></html>`);
  }

  // Public: see above.
  @Public()
  @Post('complete')
  async complete(
    @Body() body: Record<string, unknown>,
    @Req() request: Request,
    @Res() res: Response,
  ): Promise<void> {
    this.assertEnabled();
    const outcome = field(body, 'outcome');
    const statusCode = outcome === 'success' ? '2' : outcome === 'cancel' ? '-1' : '-2';
    const notification = (this.gateway as FakeGateway).signedNotification({
      orderId: field(body, 'order_id'),
      amount: field(body, 'amount'),
      currency: field(body, 'currency'),
      statusCode,
      statusMessage:
        outcome === 'success' ? 'Successfully completed the payment.' : `Simulated ${outcome}.`,
    });
    await this.service.handleNotification(notification, requestMeta(request));
    const target = field(body, outcome === 'success' ? 'return_url' : 'cancel_url');
    res.redirect(303, target || '/');
  }

  private assertEnabled(): void {
    if (!this.enabled || !(this.gateway instanceof FakeGateway)) {
      throw new ApiException('NOT_FOUND', 'Not found', 404);
    }
  }
}
