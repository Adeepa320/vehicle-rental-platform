import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Booking, CheckoutSession } from '@vrp/contracts';
import request, { type Response } from 'supertest';

import { FAKE_MERCHANT_ID } from '../../src/modules/payments/gateway/fake.gateway';
import { notificationSignature } from '../../src/modules/payments/gateway/payhere.crypto';
import { TEST_ENV_DEFAULTS } from './create-app';

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The fake gateway's secret as configured by `TEST_ENV_DEFAULTS`. */
export const FAKE_SECRET = TEST_ENV_DEFAULTS.PAYHERE_MERCHANT_SECRET as string;

export async function createCheckout(
  app: NestExpressApplication,
  token: string,
  bookingId: string,
  expected?: number,
): Promise<Response> {
  const response = await request(app.getHttpServer())
    .post(`/api/v1/bookings/${bookingId}/payments/checkout`)
    .set(auth(token))
    .send();
  if (expected !== undefined && response.status !== expected) {
    throw new Error(
      `checkout ${bookingId}: expected ${expected}, got ${response.status} ${JSON.stringify(response.body)}`,
    );
  }
  return response;
}

export interface NotificationInput {
  orderId: string;
  amount: string;
  currency?: string;
  statusCode?: string;
  gatewayPaymentId?: string;
  merchantId?: string;
  secret?: string;
  method?: string;
  statusMessage?: string;
  /** Overrides applied after signing (to forge or tamper). */
  tamper?: Record<string, string>;
}

/** A PayHere-shaped notification signed like PayHere would (with the fake secret by default). */
export function signedNotification(input: NotificationInput): Record<string, string> {
  const merchantId = input.merchantId ?? FAKE_MERCHANT_ID;
  const currency = input.currency ?? 'LKR';
  const statusCode = input.statusCode ?? '2';
  const fields: Record<string, string> = {
    merchant_id: merchantId,
    order_id: input.orderId,
    payment_id: input.gatewayPaymentId ?? `PH${Date.now()}${Math.floor(Math.random() * 10_000)}`,
    payhere_amount: input.amount,
    payhere_currency: currency,
    status_code: statusCode,
    md5sig: notificationSignature({
      merchantId,
      orderId: input.orderId,
      payhereAmount: input.amount,
      payhereCurrency: currency,
      statusCode,
      merchantSecret: input.secret ?? FAKE_SECRET,
    }),
    method: input.method ?? 'VISA',
    status_message: input.statusMessage ?? 'Successfully completed the payment.',
    card_holder_name: 'N Perera',
    card_no: '************1234',
    card_expiry: '1229',
  };
  return { ...fields, ...(input.tamper ?? {}) };
}

/** Posts a notification the way PayHere does (form-encoded, no session). */
export async function notify(
  app: NestExpressApplication,
  fields: Record<string, string>,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .post('/api/v1/payments/payhere/notify')
    .type('form')
    .send(fields)
    .expect(expected);
}

/** Checkout + verified success notification; returns the booking as the customer sees it afterwards. */
export async function payAdvance(
  app: NestExpressApplication,
  token: string,
  bookingId: string,
): Promise<{ booking: Booking; checkout: CheckoutSession; gatewayPaymentId: string }> {
  const checkout = (await createCheckout(app, token, bookingId, 200)).body as CheckoutSession;
  const gatewayPaymentId = `PH${Date.now()}${Math.floor(Math.random() * 10_000)}`;
  await notify(
    app,
    signedNotification({
      orderId: checkout.fields.order_id as string,
      amount: checkout.fields.amount as string,
      gatewayPaymentId,
    }),
  );
  const booking = (
    await request(app.getHttpServer())
      .get(`/api/v1/bookings/${bookingId}`)
      .set(auth(token))
      .expect(200)
  ).body as Booking;
  return { booking, checkout, gatewayPaymentId };
}

export async function customerPayments(
  app: NestExpressApplication,
  token: string,
  bookingId: string,
  expected = 200,
): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/bookings/${bookingId}/payments`)
    .set(auth(token))
    .expect(expected);
}
