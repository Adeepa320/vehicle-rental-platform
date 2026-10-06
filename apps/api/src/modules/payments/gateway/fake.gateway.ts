import type { PaymentGateway } from './payment-gateway';
import { notificationSignature } from './payhere.crypto';
import { PayHereGateway } from './payhere.gateway';

export const FAKE_MERCHANT_ID = 'FAKE-MERCHANT';
export const FAKE_MERCHANT_SECRET_DEFAULT = 'fake-merchant-secret-for-local-development-only';

export interface FakeNotificationInput {
  orderId: string;
  /** Amount exactly as the "gateway" reports it (e.g. "1500.00"). */
  amount: string;
  currency: string;
  /** PayHere status code: 2, 0, -1, -2, -3. */
  statusCode: string;
  gatewayPaymentId?: string;
  method?: string;
  statusMessage?: string;
}

/**
 * Deterministic gateway for tests and local development (TECH_DECISIONS D53):
 * the PayHere adapter with a fixed merchant id, a known secret and a checkout
 * URL that points at this API's own simulator page instead of PayHere. Every
 * signature, field and status code goes through the real PayHere code path,
 * so a test that passes here would pass against PayHere with the same inputs.
 * Never registered in production (the environment schema refuses it).
 */
export class FakeGateway extends PayHereGateway implements PaymentGateway {
  constructor(options: { merchantSecret: string; checkoutUrl: string }) {
    super({
      name: 'fake',
      environment: 'sandbox',
      merchantId: FAKE_MERCHANT_ID,
      merchantSecret: options.merchantSecret,
      checkoutUrl: options.checkoutUrl,
    });
  }

  /** A PayHere-shaped, correctly signed notification (what the simulator page sends). */
  signedNotification(input: FakeNotificationInput): Record<string, string> {
    return {
      merchant_id: FAKE_MERCHANT_ID,
      order_id: input.orderId,
      payment_id: input.gatewayPaymentId ?? `FAKE${Date.now()}${Math.floor(Math.random() * 1000)}`,
      payhere_amount: input.amount,
      payhere_currency: input.currency,
      status_code: input.statusCode,
      md5sig: notificationSignature({
        merchantId: FAKE_MERCHANT_ID,
        orderId: input.orderId,
        payhereAmount: input.amount,
        payhereCurrency: input.currency,
        statusCode: input.statusCode,
        merchantSecret: this.options.merchantSecret,
      }),
      method: input.method ?? 'TEST',
      status_message: input.statusMessage ?? `Simulated status ${input.statusCode}.`,
    };
  }
}
