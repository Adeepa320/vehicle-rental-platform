import { ApiException } from '../../../common/errors/api.exception';
import type { GatewayPaymentRecord, GatewayRefundResult } from './payment-gateway';
import { PAYHERE_MERCHANT_API_URL, type PayHereEnvironment } from './payhere.crypto';

/**
 * PayHere Merchant API client (Retrieval + Refund), verified against the
 * official pages on 2026-10-06:
 * - OAuth client credentials: `POST {base}/oauth/token` with
 *   `Authorization: Basic base64(app_id:app_secret)` and
 *   `grant_type=client_credentials`; tokens expire (~600 s).
 * - Retrieval: `GET {base}/payment/search?order_id=…` → `{ status: 1, data: [...] }`;
 *   `-1` = no records, `-2` = declined. PayHere does not enforce unique order ids,
 *   so `data` may hold several records.
 * - Refund: `POST {base}/payment/refund` `{ payment_id, description, amount? }`
 *   → `{ status: 1, msg, data: <refund id> }`; `0` / `-1` are failures.
 * - Rate limit: 20 requests per 10 seconds; live use needs IP allow-listing.
 *
 * Credentials never leave the server; the client is only constructed when
 * `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` are set.
 */
export interface PayHereMerchantApiOptions {
  environment: PayHereEnvironment;
  appId: string;
  appSecret: string;
  fetchImpl?: typeof fetch;
  /** Base URL override (tests). */
  baseUrl?: string;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
}

interface SearchResponse {
  status?: number;
  msg?: string;
  data?: Array<{
    payment_id?: number | string;
    order_id?: string;
    status?: string;
    currency?: string;
    amount?: number | string;
    payment_method?: { method?: string } | null;
  }> | null;
}

interface RefundResponse {
  status?: number;
  msg?: string;
  data?: number | string | null;
}

export class PayHereMerchantApi {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private token: { value: string; expiresAt: number } | undefined;

  constructor(private readonly options: PayHereMerchantApiOptions) {
    this.baseUrl = (options.baseUrl ?? PAYHERE_MERCHANT_API_URL[options.environment]).replace(
      /\/+$/,
      '',
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async searchByOrderId(orderId: string): Promise<GatewayPaymentRecord | null> {
    const response = await this.request<SearchResponse>(
      'GET',
      `/payment/search?order_id=${encodeURIComponent(orderId)}`,
    );
    if (response.status === -1 || !response.data || response.data.length === 0) return null;
    if (response.status !== 1) throw this.failure(`Retrieval failed: ${response.msg ?? 'unknown'}`);
    // Several records are possible when an order id was reused; ours are unique, take the first.
    const record = response.data[0];
    if (!record?.payment_id) return null;
    return {
      gatewayPaymentId: String(record.payment_id),
      orderId: record.order_id ?? orderId,
      status: record.status ?? 'UNKNOWN',
      amount: record.amount === undefined ? '' : Number(record.amount).toFixed(2),
      currency: record.currency ?? '',
      method: record.payment_method?.method ?? null,
    };
  }

  async refund(
    gatewayPaymentId: string,
    amount: string,
    description: string,
  ): Promise<GatewayRefundResult> {
    const response = await this.request<RefundResponse>('POST', '/payment/refund', {
      payment_id: gatewayPaymentId,
      description,
      amount,
    });
    if (response.status !== 1) throw this.failure(`Refund failed: ${response.msg ?? 'unknown'}`);
    return {
      reference:
        response.data === null || response.data === undefined ? 'payhere' : String(response.data),
    };
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 10_000) return this.token.value;
    const basic = Buffer.from(`${this.options.appId}:${this.options.appSecret}`, 'utf8').toString(
      'base64',
    );
    const response = await this.fetchImpl(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${basic}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: 'grant_type=client_credentials',
    });
    const json = (await response.json().catch(() => ({}))) as TokenResponse;
    if (!response.ok || !json.access_token) {
      throw this.failure(`PayHere token request failed (${response.status})`);
    }
    this.token = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 60) * 1000,
    };
    return json.access_token;
  }

  private async request<T>(method: 'GET' | 'POST', path: string, body?: object): Promise<T> {
    const token = await this.accessToken();
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw this.failure(`PayHere Merchant API responded ${response.status}`);
    return (await response.json()) as T;
  }

  private failure(message: string): ApiException {
    // Never include tokens, secrets or raw payloads in the message.
    return new ApiException('PAYMENT_GATEWAY_UNAVAILABLE', message, 503);
  }
}
