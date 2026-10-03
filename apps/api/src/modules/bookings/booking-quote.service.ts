import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { normalizeAmount, type BookingPrice } from '@vrp/contracts';
import type { Vehicle } from '@vrp/database';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';

/** What a quote token binds together (API_DESIGN §8.3, PRD FR-PR3). */
export interface QuotePayload {
  v: 1;
  /** Vehicle id. */
  vid: string;
  /** Window as ISO instants. */
  s: string;
  e: string;
  /** Rental subtotal and deposit as canonical amount strings. */
  sub: string;
  dep: string;
  /** Pricing fingerprint of the vehicle when quoted. */
  fp: string;
  /** Expiry, seconds since the epoch. */
  exp: number;
}

export type VehiclePricingFields = Pick<
  Vehicle,
  | 'dailyRate'
  | 'weeklyRate'
  | 'monthlyRate'
  | 'securityDeposit'
  | 'includedKmPerDay'
  | 'extraKmRate'
  | 'minRentalDays'
  | 'maxRentalDays'
>;

const base64url = (input: Buffer | string): string => Buffer.from(input).toString('base64url');

/**
 * Signed price snapshots ("quote tokens", TECH_DECISIONS D49). HMAC-SHA256 over
 * a compact JSON payload, no JWT library: the token carries no identity and is
 * only meaningful to this API. The secret comes from `BOOKING_QUOTE_SECRET`;
 * outside production a per-process secret is generated so quotes survive only
 * while that process runs (the UI fetches a fresh quote before booking anyway).
 */
@Injectable()
export class BookingQuoteService {
  private readonly secret: Buffer;
  readonly ttlMs: number;

  constructor(config: ConfigService<Env, true>, logger: PinoLogger) {
    logger.setContext(BookingQuoteService.name);
    const configured = config.get('BOOKING_QUOTE_SECRET', { infer: true });
    if (configured) {
      this.secret = Buffer.from(configured, 'utf8');
    } else {
      this.secret = randomBytes(32);
      logger.warn(
        'BOOKING_QUOTE_SECRET is not set; quote tokens are valid for this process only (set it for stable tokens)',
      );
    }
    this.ttlMs = config.get('BOOKING_QUOTE_TTL_MINUTES', { infer: true }) * 60_000;
  }

  /** Stable hash of the fields that determine a price; changes when the provider edits pricing. */
  fingerprint(vehicle: VehiclePricingFields): string {
    const canonical = JSON.stringify([
      vehicle.dailyRate ? normalizeAmount(vehicle.dailyRate) : null,
      vehicle.weeklyRate ? normalizeAmount(vehicle.weeklyRate) : null,
      vehicle.monthlyRate ? normalizeAmount(vehicle.monthlyRate) : null,
      vehicle.securityDeposit ? normalizeAmount(vehicle.securityDeposit) : null,
      vehicle.includedKmPerDay,
      vehicle.extraKmRate ? normalizeAmount(vehicle.extraKmRate) : null,
      vehicle.minRentalDays,
      vehicle.maxRentalDays,
    ]);
    return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
  }

  issue(input: {
    vehicleId: string;
    startsAt: Date;
    endsAt: Date;
    price: BookingPrice;
    fingerprint: string;
    now?: Date;
  }): { token: string; expiresAt: Date } {
    const now = input.now ?? new Date();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const payload: QuotePayload = {
      v: 1,
      vid: input.vehicleId,
      s: input.startsAt.toISOString(),
      e: input.endsAt.toISOString(),
      sub: input.price.subtotal,
      dep: input.price.securityDeposit,
      fp: input.fingerprint,
      exp: Math.floor(expiresAt.getTime() / 1000),
    };
    const body = base64url(JSON.stringify(payload));
    return { token: `${body}.${this.sign(body)}`, expiresAt };
  }

  /**
   * Verifies the signature and expiry. Malformed or forged tokens are a
   * validation error on `quoteToken`; expired ones are `409 QUOTE_EXPIRED` so
   * the client fetches a new quote.
   */
  verify(token: string, now: Date = new Date()): QuotePayload {
    const [body, signature, ...rest] = token.split('.');
    if (!body || !signature || rest.length > 0) throw this.invalid();
    const expected = Buffer.from(this.sign(body), 'utf8');
    const actual = Buffer.from(signature, 'utf8');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw this.invalid();
    }
    let payload: QuotePayload;
    try {
      payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as QuotePayload;
    } catch {
      throw this.invalid();
    }
    if (payload.v !== 1 || typeof payload.exp !== 'number') throw this.invalid();
    if (payload.exp * 1000 <= now.getTime()) {
      throw new ApiException(
        'QUOTE_EXPIRED',
        'This quote has expired; refresh the price and try again',
        409,
      );
    }
    return payload;
  }

  private sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('base64url');
  }

  private invalid(): ApiException {
    return new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
      { field: 'quoteToken', issue: 'invalid or tampered quote token' },
    ]);
  }
}
