import { describe, expect, it } from 'vitest';

import { FAKE_MERCHANT_ID, FakeGateway } from './fake.gateway';
import { PayHereMerchantApi } from './payhere-merchant-api';
import { checkoutHash, notificationSignature } from './payhere.crypto';
import { PayHereGateway } from './payhere.gateway';

const SECRET = 'test-merchant-secret';
const checkoutInput = {
  orderId: 'ADV-7F3K2Q-AB12',
  amount: '2250.00',
  currency: 'LKR',
  items: 'Booking SLR-7F3K2Q advance',
  customer: {
    firstName: 'Nimal',
    lastName: 'Perera',
    email: 'nimal@example.com',
    phone: '+94771234567',
    address: 'Not provided',
    city: 'Mirissa',
    country: 'Sri Lanka',
  },
  returnUrl: 'http://localhost:3000/bookings/x/payment?result=return',
  cancelUrl: 'http://localhost:3000/bookings/x/payment?result=cancel',
  notifyUrl: 'https://example.test/api/v1/payments/payhere/notify',
  custom1: 'booking-id',
  custom2: 'payment-id',
};

function notification(
  overrides: Record<string, string> = {},
  secret = SECRET,
  merchant = '1211149',
) {
  const fields: Record<string, string> = {
    merchant_id: merchant,
    order_id: 'ADV-7F3K2Q-AB12',
    payment_id: '320025071278',
    payhere_amount: '2250.00',
    payhere_currency: 'LKR',
    status_code: '2',
    method: 'VISA',
    status_message: 'Successfully completed the payment.',
    card_holder_name: 'N Perera',
    card_no: '************1234',
    ...overrides,
  };
  fields.md5sig =
    overrides.md5sig ??
    notificationSignature({
      merchantId: fields.merchant_id as string,
      orderId: fields.order_id as string,
      payhereAmount: fields.payhere_amount as string,
      payhereCurrency: fields.payhere_currency as string,
      statusCode: fields.status_code as string,
      merchantSecret: secret,
    });
  return fields;
}

describe('PayHereGateway', () => {
  const gateway = new PayHereGateway({
    environment: 'sandbox',
    merchantId: '1211149',
    merchantSecret: SECRET,
  });

  it('builds the hosted-checkout form with every required field and the hash, never the secret', () => {
    const checkout = gateway.createCheckout(checkoutInput);
    expect(checkout.checkoutUrl).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(checkout.method).toBe('POST');
    for (const required of [
      'merchant_id',
      'return_url',
      'cancel_url',
      'notify_url',
      'order_id',
      'items',
      'currency',
      'amount',
      'first_name',
      'last_name',
      'email',
      'phone',
      'address',
      'city',
      'country',
      'hash',
    ]) {
      expect(checkout.fields[required], required).toBeTruthy();
    }
    expect(checkout.fields.amount).toBe('2250.00');
    expect(checkout.fields.hash).toBe(
      checkoutHash({
        merchantId: '1211149',
        orderId: 'ADV-7F3K2Q-AB12',
        amount: '2250.00',
        currency: 'LKR',
        merchantSecret: SECRET,
      }),
    );
    expect(checkout.fields.custom_1).toBe('booking-id');
    expect(JSON.stringify(checkout)).not.toContain(SECRET);
    expect(
      new PayHereGateway({
        environment: 'live',
        merchantId: '1',
        merchantSecret: SECRET,
      }).createCheckout(checkoutInput).checkoutUrl,
    ).toBe('https://www.payhere.lk/pay/checkout');
  });

  it('accepts a correctly signed notification and maps its outcome', () => {
    const parsed = gateway.parseNotification(notification());
    expect(parsed).toMatchObject({
      gateway: 'payhere',
      signatureValid: true,
      merchantMatches: true,
      orderId: 'ADV-7F3K2Q-AB12',
      gatewayPaymentId: '320025071278',
      amount: '2250.00',
      currency: 'LKR',
      statusCode: '2',
      outcome: 'paid',
      method: 'VISA',
    });
    expect(gateway.parseNotification(notification({ status_code: '-2' })).outcome).toBe('failed');
    expect(gateway.parseNotification(notification({ status_code: '-1' })).outcome).toBe(
      'cancelled',
    );
    expect(gateway.parseNotification(notification({ status_code: '-3' })).outcome).toBe(
      'chargedback',
    );
    expect(gateway.parseNotification(notification({ status_code: '0' })).outcome).toBe('pending');
  });

  it('rejects forged, tampered, wrong-secret and incomplete notifications without throwing', () => {
    expect(gateway.parseNotification(notification({ md5sig: 'DEADBEEF' })).signatureValid).toBe(
      false,
    );
    const tampered = notification();
    tampered.payhere_amount = '1.00';
    expect(gateway.parseNotification(tampered).signatureValid).toBe(false);
    expect(gateway.parseNotification(notification({}, 'other-secret')).signatureValid).toBe(false);
    expect(gateway.parseNotification({}).signatureValid).toBe(false);
    expect(gateway.parseNotification({ order_id: 'x' }).outcome).toBe('unknown');
    // A valid signature from a different merchant id is flagged, not accepted.
    const other = gateway.parseNotification(notification({}, SECRET, '999'));
    expect(other.signatureValid).toBe(true);
    expect(other.merchantMatches).toBe(false);
  });

  it('refuses merchant-API operations when no app credentials are configured', async () => {
    expect(gateway.canRetrieve).toBe(false);
    expect(gateway.canRefund).toBe(false);
    await expect(gateway.fetchByOrderId('x')).rejects.toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
    await expect(gateway.refund('1', '1.00', 'test')).rejects.toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
  });
});

describe('FakeGateway', () => {
  it('is the PayHere adapter with a fixed merchant and a local checkout page', () => {
    const fake = new FakeGateway({
      merchantSecret: SECRET,
      checkoutUrl: 'http://localhost:4000/api/v1/payments/fake/checkout',
    });
    const checkout = fake.createCheckout(checkoutInput);
    expect(fake.name).toBe('fake');
    expect(checkout.gateway).toBe('fake');
    expect(checkout.checkoutUrl).toBe('http://localhost:4000/api/v1/payments/fake/checkout');
    expect(checkout.fields.merchant_id).toBe(FAKE_MERCHANT_ID);
    const parsed = fake.parseNotification(notification({}, SECRET, FAKE_MERCHANT_ID));
    expect(parsed.signatureValid && parsed.merchantMatches).toBe(true);
    expect(fake.parseNotification(notification({}, 'wrong', FAKE_MERCHANT_ID)).signatureValid).toBe(
      false,
    );
  });
});

describe('PayHereMerchantApi', () => {
  function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init: init ?? {} });
      const route = Object.entries(routes).find(([key]) => url.includes(key));
      if (!route) return new Response('{}', { status: 404 });
      return new Response(JSON.stringify(route[1].body), {
        status: route[1].status,
        headers: { 'content-type': 'application/json' },
      });
    }) as typeof fetch;
    return { impl, calls };
  }

  it('obtains a client-credentials token once and searches by order id', async () => {
    const { impl, calls } = fakeFetch({
      '/oauth/token': {
        status: 200,
        body: { access_token: 'tok', token_type: 'bearer', expires_in: 599 },
      },
      '/payment/search': {
        status: 200,
        body: {
          status: 1,
          msg: 'ok',
          data: [
            {
              payment_id: 320025071278,
              order_id: 'ADV-1',
              status: 'RECEIVED',
              currency: 'LKR',
              amount: 2250,
              payment_method: { method: 'VISA', card_no: '************1234' },
            },
          ],
        },
      },
    });
    const api = new PayHereMerchantApi({
      environment: 'sandbox',
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: impl,
    });
    const first = await api.searchByOrderId('ADV-1');
    const second = await api.searchByOrderId('ADV-1');
    expect(first).toEqual({
      gatewayPaymentId: '320025071278',
      orderId: 'ADV-1',
      status: 'RECEIVED',
      amount: '2250.00',
      currency: 'LKR',
      method: 'VISA',
    });
    expect(second).toEqual(first);
    const tokenCalls = calls.filter((c) => c.url.includes('/oauth/token'));
    expect(tokenCalls).toHaveLength(1);
    expect((tokenCalls[0]?.init.headers as Record<string, string>).authorization).toBe(
      `Basic ${Buffer.from('app:secret').toString('base64')}`,
    );
    expect(tokenCalls[0]?.init.body).toBe('grant_type=client_credentials');
    expect(calls[1]?.url).toBe(
      'https://sandbox.payhere.lk/merchant/v1/payment/search?order_id=ADV-1',
    );
    expect((calls[1]?.init.headers as Record<string, string>).authorization).toBe('Bearer tok');
  });

  it('returns null for unknown orders and refunds through the Refund API', async () => {
    const { impl, calls } = fakeFetch({
      '/oauth/token': { status: 200, body: { access_token: 'tok', expires_in: 599 } },
      '/payment/search': { status: 200, body: { status: -1, msg: 'No records found', data: null } },
      '/payment/refund': {
        status: 200,
        body: { status: 1, msg: 'Successfully processed the refund', data: 560034010257 },
      },
    });
    const api = new PayHereMerchantApi({
      environment: 'live',
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: impl,
    });
    expect(await api.searchByOrderId('ADV-404')).toBeNull();
    expect(
      await api.refund('320025071278', '2250.00', 'Customer cancelled 72 h before pickup'),
    ).toEqual({ reference: '560034010257' });
    const refund = calls.find((c) => c.url.endsWith('/payment/refund'));
    expect(refund?.url).toBe('https://www.payhere.lk/merchant/v1/payment/refund');
    expect(JSON.parse(String(refund?.init.body))).toEqual({
      payment_id: '320025071278',
      description: 'Customer cancelled 72 h before pickup',
      amount: '2250.00',
    });
  });

  it('turns gateway failures into PAYMENT_GATEWAY_UNAVAILABLE without leaking secrets', async () => {
    const { impl } = fakeFetch({
      '/oauth/token': { status: 200, body: { access_token: 'tok', expires_in: 599 } },
      '/payment/refund': { status: 200, body: { status: -1, msg: 'Refund failed' } },
    });
    const api = new PayHereMerchantApi({
      environment: 'sandbox',
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: impl,
    });
    await expect(api.refund('1', '1.00', 'x')).rejects.toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
      message: expect.not.stringContaining('secret'),
    });
    const denied = fakeFetch({
      '/oauth/token': { status: 401, body: { error: 'invalid_client' } },
    });
    const api2 = new PayHereMerchantApi({
      environment: 'sandbox',
      appId: 'app',
      appSecret: 'secret',
      fetchImpl: denied.impl,
    });
    await expect(api2.searchByOrderId('x')).rejects.toMatchObject({
      code: 'PAYMENT_GATEWAY_UNAVAILABLE',
    });
  });
});
