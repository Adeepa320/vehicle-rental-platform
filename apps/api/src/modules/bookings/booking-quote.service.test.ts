import type { ConfigService } from '@nestjs/config';
import type { PinoLogger } from 'nestjs-pino';
import { describe, expect, it } from 'vitest';

import { ApiException } from '../../common/errors/api.exception';
import type { Env } from '../../config/env.schema';
import { BookingQuoteService, type VehiclePricingFields } from './booking-quote.service';

function service(secret: string | undefined, ttlMinutes = 15): BookingQuoteService {
  const values: Record<string, unknown> = {
    BOOKING_QUOTE_SECRET: secret,
    BOOKING_QUOTE_TTL_MINUTES: ttlMinutes,
  };
  const config = { get: (key: string) => values[key] } as unknown as ConfigService<Env, true>;
  const logger = { setContext() {}, warn() {} } as unknown as PinoLogger;
  return new BookingQuoteService(config, logger);
}

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const price = {
  currency: 'LKR' as const,
  rentalDays: 3,
  basis: 'daily' as const,
  dailyRate: '7500.00',
  weeklyRate: null,
  monthlyRate: null,
  subtotal: '22500.00',
  securityDeposit: '25000.00',
  includedKmPerDay: 100,
  includedKmTotal: 300,
  extraKmRate: '40.00',
  lines: [],
};
const pricing: VehiclePricingFields = {
  dailyRate: '7500',
  weeklyRate: '45000.00',
  monthlyRate: null,
  securityDeposit: '25000',
  includedKmPerDay: 100,
  extraKmRate: '40',
  minRentalDays: 1,
  maxRentalDays: 30,
};
const input = {
  vehicleId: '0192f0a0-0000-7000-8000-000000000123',
  startsAt: new Date('2026-11-12T03:30:00.000Z'),
  endsAt: new Date('2026-11-15T03:30:00.000Z'),
  price,
  fingerprint: 'abc',
  now: new Date('2026-11-01T10:00:00.000Z'),
};

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    if (error instanceof ApiException) return error.code;
    throw error;
  }
  throw new Error('expected an ApiException');
}

describe('BookingQuoteService', () => {
  it('round-trips a signed payload and binds vehicle, window and price', () => {
    const quotes = service(SECRET);
    const { token, expiresAt } = quotes.issue(input);
    expect(expiresAt.getTime()).toBe(input.now.getTime() + 15 * 60_000);
    const payload = quotes.verify(token, new Date(input.now.getTime() + 60_000));
    expect(payload).toMatchObject({
      v: 1,
      vid: input.vehicleId,
      s: '2026-11-12T03:30:00.000Z',
      e: '2026-11-15T03:30:00.000Z',
      sub: '22500.00',
      dep: '25000.00',
      fp: 'abc',
    });
  });

  it('rejects tampered, forged and malformed tokens as validation errors', () => {
    const quotes = service(SECRET);
    const { token } = quotes.issue(input);
    const [body, signature] = token.split('.') as [string, string];
    const forgedBody = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), sub: '1.00' }),
    ).toString('base64url');
    expect(codeOf(() => quotes.verify(`${forgedBody}.${signature}`))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => quotes.verify(`${body}.AAAA`))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => quotes.verify('not-a-token'))).toBe('VALIDATION_ERROR');
    expect(codeOf(() => service(`${SECRET}-other`).verify(token))).toBe('VALIDATION_ERROR');
  });

  it('expires after the configured TTL', () => {
    const quotes = service(SECRET, 5);
    const { token } = quotes.issue(input);
    expect(quotes.verify(token, new Date(input.now.getTime() + 4 * 60_000)).v).toBe(1);
    expect(codeOf(() => quotes.verify(token, new Date(input.now.getTime() + 5 * 60_000)))).toBe(
      'QUOTE_EXPIRED',
    );
  });

  it('works with a generated per-process secret when none is configured', () => {
    const quotes = service(undefined);
    const { token } = quotes.issue(input);
    expect(quotes.verify(token, input.now).vid).toBe(input.vehicleId);
    expect(codeOf(() => service(undefined).verify(token, input.now))).toBe('VALIDATION_ERROR');
  });

  it('fingerprints the pricing fields only and normalises amounts', () => {
    const quotes = service(SECRET);
    const fp = quotes.fingerprint(pricing);
    expect(fp).toMatch(/^[0-9a-f]{16}$/);
    expect(quotes.fingerprint({ ...pricing, dailyRate: '7500.00' })).toBe(fp);
    expect(quotes.fingerprint({ ...pricing, dailyRate: '8000' })).not.toBe(fp);
    expect(quotes.fingerprint({ ...pricing, maxRentalDays: null })).not.toBe(fp);
  });
});
