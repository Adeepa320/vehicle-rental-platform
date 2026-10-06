import type { AdminPaymentListItem, CheckoutSession } from '@vrp/contracts';
import { describe, expect, it } from 'vitest';

import { createApiClient } from '../api-client';

const BASE = 'http://api.test/api/v1';
const ID = '0192f0a0-0000-7000-8000-000000000123';
const PAYMENT_ID = '0192f0a0-0000-7000-8000-000000000777';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeApi(status: number, body: unknown) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init: init ?? {} });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return { api: createApiClient({ baseUrl: BASE, fetchImpl }), calls };
}

const callAt = (calls: Call[], index: number): Call => {
  const call = calls[index];
  if (!call) throw new Error(`expected a recorded call #${index}`);
  return call;
};
const headersOf = (call: Call) => call.init.headers as Record<string, string>;

const session: CheckoutSession = {
  paymentId: PAYMENT_ID,
  gateway: 'fake',
  checkoutUrl: 'http://api.test/api/v1/payments/fake/checkout',
  method: 'POST',
  fields: {
    merchant_id: 'FAKE-MERCHANT',
    order_id: 'ADV-7F3K2Q-AB12',
    amount: '2250.00',
    currency: 'LKR',
    hash: 'ABCDEF0123456789ABCDEF0123456789',
  },
  amount: '2250.00',
  currency: 'LKR',
  expiresAt: '2026-11-02T04:30:00.000Z',
};

function adminPayment(overrides: Partial<AdminPaymentListItem> = {}): AdminPaymentListItem {
  return {
    id: PAYMENT_ID,
    bookingId: ID,
    bookingReference: 'SLR-7F3K2Q',
    type: 'advance',
    gateway: 'fake',
    status: 'paid',
    amount: '2250.00',
    currency: 'LKR',
    orderId: 'ADV-7F3K2Q-AB12',
    gatewayPaymentId: '320012345678',
    gatewayStatusCode: '2',
    gatewayMethod: 'VISA',
    failureReason: null,
    anomaly: null,
    requiresManualResolution: false,
    refundDueAmount: null,
    refundedAmount: null,
    refundReference: null,
    createdAt: '2026-11-01T04:30:00.000Z',
    paidAt: '2026-11-01T04:31:00.000Z',
    failedAt: null,
    cancelledAt: null,
    refundedAt: null,
    events: [],
    ...overrides,
  };
}

describe('api client (payments)', () => {
  it('creates a checkout session with an empty body and the bearer token', async () => {
    const { api, calls } = fakeApi(201, session);
    const result = await api.bookings.createCheckout('token-1', ID);
    expect(result.fields.hash).toBe(session.fields.hash);
    expect(result.fields).not.toHaveProperty('merchant_secret');
    const call = callAt(calls, 0);
    expect(call.url).toBe(`${BASE}/bookings/${ID}/payments/checkout`);
    expect(call.init.method).toBe('POST');
    expect(JSON.parse(String(call.init.body))).toEqual({});
    expect(headersOf(call).authorization).toBe('Bearer token-1');
  });

  it('rejects a checkout session that is missing the signed fields', async () => {
    const { api } = fakeApi(201, { ...session, fields: 'nope' });
    await expect(api.bookings.createCheckout('t', ID)).rejects.toMatchObject({
      code: 'INTERNAL',
      message: expect.stringContaining('Unexpected response shape') as string,
    });
  });

  it('lists the customer payment attempts', async () => {
    const { api, calls } = fakeApi(200, {
      data: [(({ bookingReference: _ref, events: _events, ...p }) => p)(adminPayment())],
    });
    const list = await api.bookings.payments('t', ID);
    expect(list.data[0]?.status).toBe('paid');
    expect(callAt(calls, 0).url).toBe(`${BASE}/bookings/${ID}/payments`);
  });

  it('posts admin refund, resolve and reconcile actions to their routes', async () => {
    const { api, calls } = fakeApi(200, adminPayment({ status: 'refunded' }));
    await api.admin.recordRefund('t', PAYMENT_ID, {
      mode: 'manual',
      amount: '2250.00',
      reason: 'Provider cancelled',
      reference: 'PH-REF-1',
    });
    await api.admin.resolvePayment('t', PAYMENT_ID, { note: 'Refunded via portal' });
    expect(calls.map((c) => c.url.replace(BASE, ''))).toEqual([
      `/admin/payments/${PAYMENT_ID}/refund`,
      `/admin/payments/${PAYMENT_ID}/resolve`,
    ]);
    expect(JSON.parse(String(callAt(calls, 0).init.body))).toMatchObject({ mode: 'manual' });
  });

  it('lists payments flagged for manual resolution', async () => {
    const { api, calls } = fakeApi(200, {
      data: [adminPayment({ anomaly: 'late_success', requiresManualResolution: true })],
    });
    const list = await api.admin.listPayments('t', { limit: 20 });
    expect(list.data[0]?.anomaly).toBe('late_success');
    expect(callAt(calls, 0).url).toBe(`${BASE}/admin/payments?limit=20`);
  });
});
