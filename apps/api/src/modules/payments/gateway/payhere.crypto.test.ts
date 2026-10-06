import { describe, expect, it } from 'vitest';

import {
  PAYHERE_CHECKOUT_URL,
  PAYHERE_MERCHANT_API_URL,
  checkoutHash,
  formatPayHereAmount,
  mapPayHereStatus,
  md5Upper,
  notificationSignature,
  verifyNotificationSignature,
} from './payhere.crypto';

/**
 * Fixed vectors computed from the documented formulas with a test secret
 * ("test-merchant-secret"); they never change unless the formula does.
 */
const MERCHANT_ID = '1211149';
const ORDER_ID = 'ADV-7F3K2Q-AB12';
const SECRET = 'test-merchant-secret';

describe('PayHere primitives', () => {
  it('upper-cases the md5 of the merchant secret', () => {
    expect(md5Upper(SECRET)).toBe('413024A670C5DD96B2E6C98E88268C83');
  });

  it('formats amounts with two decimals and no thousands separator', () => {
    expect(formatPayHereAmount('2250')).toBe('2250.00');
    expect(formatPayHereAmount('2250.5')).toBe('2250.50');
    expect(formatPayHereAmount('1234567.89')).toBe('1234567.89');
    expect(() => formatPayHereAmount('2,250.00')).toThrow();
    expect(() => formatPayHereAmount('-1')).toThrow();
  });

  it('computes the checkout hash exactly as documented', () => {
    const hash = checkoutHash({
      merchantId: MERCHANT_ID,
      orderId: ORDER_ID,
      amount: '2250',
      currency: 'LKR',
      merchantSecret: SECRET,
    });
    expect(hash).toBe('51C6B664440F574972467D71FE860478');
    // Same inputs with the amount already formatted give the same hash.
    expect(
      checkoutHash({
        merchantId: MERCHANT_ID,
        orderId: ORDER_ID,
        amount: '2250.00',
        currency: 'LKR',
        merchantSecret: SECRET,
      }),
    ).toBe(hash);
    expect(
      checkoutHash({
        merchantId: MERCHANT_ID,
        orderId: ORDER_ID,
        amount: '2250.00',
        currency: 'LKR',
        merchantSecret: `${SECRET}x`,
      }),
    ).not.toBe(hash);
  });

  it('computes and verifies the notification md5sig with the raw received amount', () => {
    const base = {
      merchantId: MERCHANT_ID,
      orderId: ORDER_ID,
      payhereAmount: '2250.00',
      payhereCurrency: 'LKR',
      merchantSecret: SECRET,
    };
    expect(notificationSignature({ ...base, statusCode: '2' })).toBe(
      'E7157408DCBA79784C32187B671428D3',
    );
    expect(notificationSignature({ ...base, statusCode: '-2' })).toBe(
      '62263FC87EB330ABB48B080884295582',
    );
    // The amount string is used verbatim: "2250.0" is a different message than "2250.00".
    expect(notificationSignature({ ...base, payhereAmount: '2250.0', statusCode: '2' })).toBe(
      'E9EC3DDE07E3EFC1444E0410D760DD33',
    );
    expect(
      verifyNotificationSignature({ ...base, statusCode: '2' }, 'e7157408dcba79784c32187b671428d3'),
    ).toBe(true);
    expect(
      verifyNotificationSignature({ ...base, statusCode: '2' }, 'E7157408DCBA79784C32187B671428D4'),
    ).toBe(false);
    expect(verifyNotificationSignature({ ...base, statusCode: '2' }, '')).toBe(false);
    expect(verifyNotificationSignature({ ...base, statusCode: '2' }, 'too-short')).toBe(false);
  });

  it('maps every documented status code and nothing else', () => {
    expect(mapPayHereStatus('2')).toBe('paid');
    expect(mapPayHereStatus('0')).toBe('pending');
    expect(mapPayHereStatus('-1')).toBe('cancelled');
    expect(mapPayHereStatus('-2')).toBe('failed');
    expect(mapPayHereStatus('-3')).toBe('chargedback');
    expect(mapPayHereStatus(' 2 ')).toBe('paid');
    expect(mapPayHereStatus('1')).toBe('unknown');
    expect(mapPayHereStatus('')).toBe('unknown');
  });

  it('knows the official endpoints', () => {
    expect(PAYHERE_CHECKOUT_URL.sandbox).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(PAYHERE_CHECKOUT_URL.live).toBe('https://www.payhere.lk/pay/checkout');
    expect(PAYHERE_MERCHANT_API_URL.sandbox).toBe('https://sandbox.payhere.lk/merchant/v1');
    expect(PAYHERE_MERCHANT_API_URL.live).toBe('https://www.payhere.lk/merchant/v1');
  });
});
