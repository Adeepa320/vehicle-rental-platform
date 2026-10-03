import { Inject, Injectable } from '@nestjs/common';
import { platformSettings, type Database } from '@vrp/database';
import { inArray } from 'drizzle-orm';
import { z, type ZodType } from 'zod';

import { DATABASE } from '../../database/database.module';

/** Booking timers and the reveal stage, as configured in `platform_settings` (DATABASE_DESIGN §6.12). */
export interface BookingSettings {
  providerResponseHours: number;
  /** Hours after acceptance to confirm (pay, in Phase 7) before the hold is released. */
  paymentWindowHours: number;
  noShowGraceHours: number;
  contactRevealStage: 'accepted' | 'confirmed';
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  providerResponseHours: 24,
  paymentWindowHours: 24,
  noShowGraceHours: 3,
  contactRevealStage: 'confirmed',
};

const KEYS = [
  'provider_response_hours',
  'payment_window_hours',
  'no_show_grace_hours',
  'contact_reveal_stage',
] as const;

const Hours = z
  .number()
  .min(0.25)
  .max(24 * 30);
const Grace = z.number().min(0).max(72);
const Stage = z.enum(['accepted', 'confirmed']);

const CACHE_MS = 60_000;

function pick<T>(schema: ZodType<T>, raw: unknown, fallback: T): T {
  const parsed = schema.safeParse(raw);
  return parsed.success ? parsed.data : fallback;
}

/**
 * Reads the booking-related platform settings with validation and a short
 * cache; an invalid or missing value falls back to the seeded default so a
 * bad admin edit can never stop bookings.
 */
@Injectable()
export class BookingSettingsService {
  private cached: { value: BookingSettings; at: number } | undefined;

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async get(): Promise<BookingSettings> {
    if (this.cached && Date.now() - this.cached.at < CACHE_MS) return this.cached.value;
    const rows = await this.db
      .select({ key: platformSettings.key, value: platformSettings.value })
      .from(platformSettings)
      .where(inArray(platformSettings.key, [...KEYS]));
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const d = DEFAULT_BOOKING_SETTINGS;
    const value: BookingSettings = {
      providerResponseHours: pick(
        Hours,
        byKey.get('provider_response_hours'),
        d.providerResponseHours,
      ),
      paymentWindowHours: pick(Hours, byKey.get('payment_window_hours'), d.paymentWindowHours),
      noShowGraceHours: pick(Grace, byKey.get('no_show_grace_hours'), d.noShowGraceHours),
      contactRevealStage: pick(Stage, byKey.get('contact_reveal_stage'), d.contactRevealStage),
    };
    this.cached = { value, at: Date.now() };
    return value;
  }

  /** Forgets the cache (tests, admin settings changes). */
  invalidate(): void {
    this.cached = undefined;
  }
}
