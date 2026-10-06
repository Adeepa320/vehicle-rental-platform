import { createHash, timingSafeEqual } from 'node:crypto';

import { isAmount, normalizeAmount } from '@vrp/contracts';

import type { NotificationOutcome } from './payment-gateway';

/**
 * PayHere Checkout API primitives, verified against the official documentation
 * on 2026-10-06 (https://support.payhere.lk/api-&-mobile-sdk/checkout-api):
 *
 *   hash   = UPPER(md5(merchant_id + order_id + number_format(amount, 2, '.', '') + currency + UPPER(md5(merchant_secret))))
 *   md5sig = UPPER(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(md5(merchant_secret))))
 *
 * `hash` has been a mandatory checkout field since 2023-01-16. The notification
 * values are concatenated exactly as received (never re-formatted) and the
 * comparison is timing-safe. Pure functions: no I/O, no logging.
 */

export const PAYHERE_CHECKOUT_URL = {
  sandbox: 'https://sandbox.payhere.lk/pay/checkout',
  live: 'https://www.payhere.lk/pay/checkout',
} as const;

export const PAYHERE_MERCHANT_API_URL = {
  sandbox: 'https://sandbox.payhere.lk/merchant/v1',
  live: 'https://www.payhere.lk/merchant/v1',
} as const;

export type PayHereEnvironment = keyof typeof PAYHERE_CHECKOUT_URL;

/** Documented `status_code` values. */
export const PAYHERE_STATUS_CODES: Readonly<Record<string, NotificationOutcome>> = {
  '2': 'paid',
  '0': 'pending',
  '-1': 'cancelled',
  '-2': 'failed',
  '-3': 'chargedback',
};

export function mapPayHereStatus(code: string): NotificationOutcome {
  return PAYHERE_STATUS_CODES[code.trim()] ?? 'unknown';
}

/** `UPPER(md5(value))` as hex. */
export function md5Upper(value: string): string {
  return createHash('md5').update(value, 'utf8').digest('hex').toUpperCase();
}

/**
 * PayHere wants `number_format($amount, 2, '.', '')`: two decimals, no
 * thousands separator. Our canonical amount strings already have that shape.
 */
export function formatPayHereAmount(amount: string): string {
  if (!isAmount(amount)) throw new Error(`Invalid amount for PayHere: ${amount}`);
  return normalizeAmount(amount);
}

export interface CheckoutHashInput {
  merchantId: string;
  orderId: string;
  /** Canonical amount; formatted to two decimals here. */
  amount: string;
  currency: string;
  merchantSecret: string;
}

export function checkoutHash(input: CheckoutHashInput): string {
  return md5Upper(
    input.merchantId +
      input.orderId +
      formatPayHereAmount(input.amount) +
      input.currency +
      md5Upper(input.merchantSecret),
  );
}

export interface NotificationSignatureInput {
  merchantId: string;
  orderId: string;
  /** Exactly as received in `payhere_amount` (e.g. "5400.00"); never reformatted. */
  payhereAmount: string;
  payhereCurrency: string;
  statusCode: string;
  merchantSecret: string;
}

export function notificationSignature(input: NotificationSignatureInput): string {
  return md5Upper(
    input.merchantId +
      input.orderId +
      input.payhereAmount +
      input.payhereCurrency +
      input.statusCode +
      md5Upper(input.merchantSecret),
  );
}

/** Timing-safe comparison of the received `md5sig` with the recomputed one (case-insensitive hex). */
export function verifyNotificationSignature(
  input: NotificationSignatureInput,
  receivedSignature: string,
): boolean {
  const expected = Buffer.from(notificationSignature(input), 'utf8');
  const actual = Buffer.from(receivedSignature.trim().toUpperCase(), 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Reads a form field as a trimmed string (PayHere posts `application/x-www-form-urlencoded`). */
export function field(body: Record<string, unknown>, name: string): string {
  const value = body[name];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}
