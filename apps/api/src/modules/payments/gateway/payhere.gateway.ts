import type { PaymentGatewayName } from '@vrp/contracts';

import { ApiException } from '../../../common/errors/api.exception';
import type {
  CheckoutInput,
  GatewayCheckout,
  GatewayNotification,
  GatewayPaymentRecord,
  GatewayRefundResult,
  PaymentGateway,
} from './payment-gateway';
import { PayHereMerchantApi } from './payhere-merchant-api';
import {
  PAYHERE_CHECKOUT_URL,
  checkoutHash,
  field,
  formatPayHereAmount,
  mapPayHereStatus,
  verifyNotificationSignature,
  type PayHereEnvironment,
} from './payhere.crypto';

export interface PayHereGatewayOptions {
  environment: PayHereEnvironment;
  merchantId: string;
  merchantSecret: string;
  /** Overrides the environment's hosted checkout URL (tests, the fake gateway). */
  checkoutUrl?: string;
  /** Merchant API (Retrieval / Refund) client; absent when no app credentials are configured. */
  merchantApi?: PayHereMerchantApi;
  /** Gateway name recorded on payments; the fake gateway reports `fake`. */
  name?: PaymentGatewayName;
}

/**
 * PayHere hosted checkout (TECH_DECISIONS D53). Holds the merchant secret;
 * nothing here is ever serialised. The fake gateway reuses this class with its
 * own credentials and checkout URL, so tests exercise the real signature path.
 */
export class PayHereGateway implements PaymentGateway {
  readonly name: PaymentGatewayName;
  private readonly checkoutUrl: string;

  constructor(protected readonly options: PayHereGatewayOptions) {
    this.name = options.name ?? 'payhere';
    this.checkoutUrl = options.checkoutUrl ?? PAYHERE_CHECKOUT_URL[options.environment];
  }

  get canRetrieve(): boolean {
    return this.options.merchantApi !== undefined;
  }

  get canRefund(): boolean {
    return this.options.merchantApi !== undefined;
  }

  createCheckout(input: CheckoutInput): GatewayCheckout {
    const amount = formatPayHereAmount(input.amount);
    const fields: Record<string, string> = {
      merchant_id: this.options.merchantId,
      return_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      notify_url: input.notifyUrl,
      order_id: input.orderId,
      items: input.items,
      currency: input.currency,
      amount,
      first_name: input.customer.firstName,
      last_name: input.customer.lastName,
      email: input.customer.email,
      phone: input.customer.phone,
      address: input.customer.address,
      city: input.customer.city,
      country: input.customer.country,
      hash: checkoutHash({
        merchantId: this.options.merchantId,
        orderId: input.orderId,
        amount,
        currency: input.currency,
        merchantSecret: this.options.merchantSecret,
      }),
    };
    if (input.custom1) fields.custom_1 = input.custom1;
    if (input.custom2) fields.custom_2 = input.custom2;
    return { gateway: this.name, checkoutUrl: this.checkoutUrl, method: 'POST', fields };
  }

  parseNotification(body: Record<string, unknown>): GatewayNotification {
    const merchantId = field(body, 'merchant_id');
    const orderId = field(body, 'order_id');
    const payhereAmount = field(body, 'payhere_amount');
    const payhereCurrency = field(body, 'payhere_currency');
    const statusCode = field(body, 'status_code');
    const md5sig = field(body, 'md5sig');
    const complete = Boolean(
      merchantId && orderId && payhereAmount && payhereCurrency && statusCode,
    );
    const signatureValid =
      complete &&
      md5sig.length > 0 &&
      verifyNotificationSignature(
        {
          merchantId,
          orderId,
          payhereAmount,
          payhereCurrency,
          statusCode,
          merchantSecret: this.options.merchantSecret,
        },
        md5sig,
      );
    return {
      gateway: this.name,
      signatureValid,
      merchantMatches: merchantId === this.options.merchantId,
      orderId,
      gatewayPaymentId: field(body, 'payment_id') || null,
      amount: payhereAmount,
      currency: payhereCurrency,
      statusCode,
      outcome: signatureValid ? mapPayHereStatus(statusCode) : 'unknown',
      method: field(body, 'method') || null,
      statusMessage: field(body, 'status_message').slice(0, 200) || null,
    };
  }

  async fetchByOrderId(orderId: string): Promise<GatewayPaymentRecord | null> {
    return this.merchantApi().searchByOrderId(orderId);
  }

  async refund(
    gatewayPaymentId: string,
    amount: string,
    description: string,
  ): Promise<GatewayRefundResult> {
    return this.merchantApi().refund(gatewayPaymentId, amount, description);
  }

  private merchantApi(): PayHereMerchantApi {
    if (!this.options.merchantApi) {
      throw new ApiException(
        'PAYMENT_GATEWAY_UNAVAILABLE',
        'The PayHere Merchant API is not configured (PAYHERE_APP_ID / PAYHERE_APP_SECRET)',
        503,
      );
    }
    return this.options.merchantApi;
  }
}
