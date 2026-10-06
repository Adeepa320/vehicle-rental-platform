import type { PaymentGatewayName } from '@vrp/contracts';

/** Everything a hosted-checkout gateway needs to start a payment (ARCHITECTURE §10). */
export interface CheckoutInput {
  /** Our unique order id for this payment attempt. */
  orderId: string;
  /** Canonical amount string ("5400.00"). */
  amount: string;
  currency: string;
  /** Short human description shown on the gateway page. */
  items: string;
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    country: string;
  };
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  /** Opaque values echoed back in the notification (booking id, payment id). */
  custom1?: string;
  custom2?: string;
}

/** What the browser needs: a form POST to the gateway's hosted page. */
export interface GatewayCheckout {
  gateway: PaymentGatewayName;
  checkoutUrl: string;
  method: 'POST';
  /** Form fields including the server-computed signature; never the merchant secret. */
  fields: Record<string, string>;
}

export type NotificationOutcome =
  'paid' | 'pending' | 'cancelled' | 'failed' | 'chargedback' | 'unknown';

/**
 * A server-to-server payment notification after signature verification. The
 * gateway adapter never throws on a bad or forged message: it reports
 * `signatureValid: false` and the service records and ignores it.
 */
export interface GatewayNotification {
  gateway: PaymentGatewayName;
  signatureValid: boolean;
  /** The notification named our merchant account. */
  merchantMatches: boolean;
  orderId: string;
  gatewayPaymentId: string | null;
  /** Amount and currency exactly as the gateway reported them. */
  amount: string;
  currency: string;
  /** Raw gateway status code (PayHere: 2, 0, -1, -2, -3). */
  statusCode: string;
  outcome: NotificationOutcome;
  /** Payment method as reported (VISA, MASTER, GENIE…); never card numbers. */
  method: string | null;
  statusMessage: string | null;
}

/** A payment as the gateway's Retrieval API reports it (reconciliation). */
export interface GatewayPaymentRecord {
  gatewayPaymentId: string;
  orderId: string;
  /** Gateway status word, e.g. PayHere `RECEIVED`, `REFUNDED`, `CHARGEBACKED`. */
  status: string;
  amount: string;
  currency: string;
  method: string | null;
}

export interface GatewayRefundResult {
  /** Gateway reference for the refund (PayHere returns a refund id in `data`). */
  reference: string;
}

/**
 * Gateway abstraction (TECH_DECISIONS D53). Bookings never see gateway
 * specifics: the payments service drives this interface, PayHere implements
 * it, and a deterministic fake implements it for tests and local development.
 */
export interface PaymentGateway {
  readonly name: PaymentGatewayName;
  createCheckout(input: CheckoutInput): GatewayCheckout;
  parseNotification(body: Record<string, unknown>): GatewayNotification;
  /** Retrieval API availability (needs merchant-API credentials). */
  readonly canRetrieve: boolean;
  fetchByOrderId(orderId: string): Promise<GatewayPaymentRecord | null>;
  /** Refund API availability (needs merchant-API credentials). */
  readonly canRefund: boolean;
  refund(
    gatewayPaymentId: string,
    amount: string,
    description: string,
  ): Promise<GatewayRefundResult>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
