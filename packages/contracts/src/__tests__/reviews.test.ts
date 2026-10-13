import { describe, expect, it } from 'vitest';

import {
  IndicativeRatesSettingSchema,
  convertIndicative,
  formatIndicative,
} from '../common/currency';
import {
  CATEGORY_LICENSING_GUIDANCE,
  GENERAL_LICENSING_GUIDANCE,
  LICENSING_GUIDANCE_DISCLAIMER,
  licensingGuidanceFor,
} from '../guidance/licensing';
import {
  NotificationLinkPathSchema,
  NotificationListQuerySchema,
  isSafeNotificationLink,
} from '../notifications/notification';
import {
  CreateReviewRequestSchema,
  HideReviewRequestSchema,
  RatingSummarySchema,
  ReplyReviewRequestSchema,
  reviewerDisplayName,
} from '../reviews/review';

describe('review contracts', () => {
  it('accepts ratings 1–5 and a bounded comment; rejects everything else', () => {
    expect(CreateReviewRequestSchema.safeParse({ overallRating: 5 }).success).toBe(true);
    expect(
      CreateReviewRequestSchema.safeParse({
        overallRating: 4,
        vehicleRating: 5,
        serviceRating: 3,
        communicationRating: 4,
        comment: 'Great car, friendly handover.',
      }).success,
    ).toBe(true);
    for (const bad of [0, 6, 4.5, '5', null]) {
      expect(CreateReviewRequestSchema.safeParse({ overallRating: bad }).success).toBe(false);
    }
    expect(CreateReviewRequestSchema.safeParse({ overallRating: 5, comment: '' }).success).toBe(
      false,
    );
    expect(
      CreateReviewRequestSchema.safeParse({ overallRating: 5, comment: 'x'.repeat(1001) }).success,
    ).toBe(false);
  });

  it('rejects client-supplied identity, status and aggregate fields', () => {
    for (const extra of [
      { customerUserId: '0192f0a0-0000-7000-8000-000000000123' },
      { providerId: 'x' },
      { vehicleId: 'x' },
      { status: 'hidden' },
      { hiddenReason: 'x' },
      { ratingAverage: '5.0' },
      { createdAt: '2026-01-01T00:00:00Z' },
    ]) {
      expect(CreateReviewRequestSchema.safeParse({ overallRating: 5, ...extra }).success).toBe(
        false,
      );
    }
    expect(ReplyReviewRequestSchema.safeParse({ reply: 'Thanks!', overallRating: 1 }).success).toBe(
      false,
    );
    expect(HideReviewRequestSchema.safeParse({ reason: 'spam' }).success).toBe(false);
    expect(HideReviewRequestSchema.safeParse({ reason: 'Spam link in comment' }).success).toBe(
      true,
    );
  });

  it('builds a privacy-conscious reviewer name', () => {
    expect(reviewerDisplayName('Nimal Perera')).toBe('Nimal P.');
    expect(reviewerDisplayName('  Ayesha   de Silva ')).toBe('Ayesha S.');
    expect(reviewerDisplayName('Madonna')).toBe('Madonna');
    expect(reviewerDisplayName('')).toBe('Customer');
  });

  it('rating summaries carry a one-decimal average or nothing at all', () => {
    expect(RatingSummarySchema.safeParse({ average: '4.5', count: 2 }).success).toBe(true);
    expect(RatingSummarySchema.safeParse({ average: null, count: 0 }).success).toBe(true);
    expect(RatingSummarySchema.safeParse({ average: '4.55', count: 2 }).success).toBe(false);
    expect(RatingSummarySchema.safeParse({ average: 4.5, count: 2 }).success).toBe(false);
  });
});

describe('notification contracts', () => {
  it('allows only application-relative links', () => {
    for (const ok of [
      '/bookings/abc-123',
      '/bookings/abc/review',
      '/provider/reviews',
      '/search?placeId=x',
    ]) {
      expect(isSafeNotificationLink(ok), ok).toBe(true);
      expect(NotificationLinkPathSchema.safeParse(ok).success).toBe(true);
    }
    for (const bad of [
      'https://evil.example/x',
      '//evil.example/x',
      'javascript:alert(1)',
      'bookings/x',
      '/bookings/<script>',
      '/x y',
      '',
      `/${'a'.repeat(300)}`,
    ]) {
      expect(isSafeNotificationLink(bad), bad).toBe(false);
    }
  });

  it('parses list query booleans from strings', () => {
    expect(NotificationListQuerySchema.parse({ unreadOnly: 'true' }).unreadOnly).toBe(true);
    expect(NotificationListQuerySchema.parse({}).limit).toBe(20);
    expect(NotificationListQuerySchema.safeParse({ limit: 500 }).success).toBe(false);
  });
});

describe('licensing guidance', () => {
  it('covers every seeded category conservatively and marks unconfirmed rules', () => {
    for (const id of ['car', 'suv', 'van', 'bike', 'scooter', 'tuktuk']) {
      const guidance = licensingGuidanceFor(id);
      expect(guidance, id).not.toBeNull();
      expect(guidance?.items.length).toBeGreaterThan(0);
    }
    expect(licensingGuidanceFor('spaceship')).toBeNull();
    expect(CATEGORY_LICENSING_GUIDANCE.tuktuk?.items.every((i) => i.requiresConfirmation)).toBe(
      true,
    );
    expect(
      GENERAL_LICENSING_GUIDANCE.some((i) => /International Driving Permit/.test(i.text)),
    ).toBe(true);
    expect(LICENSING_GUIDANCE_DISCLAIMER).toMatch(/not legal advice/i);
    const all = [
      ...GENERAL_LICENSING_GUIDANCE,
      ...Object.values(CATEGORY_LICENSING_GUIDANCE).flatMap((c) => c.items),
    ];
    for (const item of all) {
      expect(item.text, item.id).not.toMatch(/guaranteed|always allowed|no licence needed/i);
    }
  });
});

describe('indicative currency', () => {
  it('converts on cents and rounds once', () => {
    expect(convertIndicative('22500.00', 0.0033)).toBe('74.25');
    expect(convertIndicative('0.01', 0.0033)).toBe('0.00');
    expect(formatIndicative('2250.00', 'USD', { USD: 0.0033 })).toBe('≈ USD 7.43');
    expect(formatIndicative('2250.00', 'EUR', { USD: 0.0033 })).toBeNull();
  });

  it('accepts partial operator-maintained rate tables only', () => {
    expect(
      IndicativeRatesSettingSchema.safeParse({
        asOf: '2026-10-13T00:00:00.000Z',
        source: 'Central Bank of Sri Lanka indicative rate',
        rates: { USD: 0.0033 },
      }).success,
    ).toBe(true);
    expect(
      IndicativeRatesSettingSchema.safeParse({ asOf: null, source: null, rates: {} }).success,
    ).toBe(false);
    expect(
      IndicativeRatesSettingSchema.safeParse({
        asOf: '2026-10-13T00:00:00.000Z',
        source: 'x',
        rates: { USD: -1 },
      }).success,
    ).toBe(false);
  });
});
