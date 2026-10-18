import { Inject, Injectable } from '@nestjs/common';
import { platformSettings, type Database } from '@vrp/database';
import { inArray } from 'drizzle-orm';
import { z, type ZodType } from 'zod';

import { DATABASE } from '../../database/database.module';

/** Booking timers and the reveal stage, as configured in `platform_settings` (DATABASE_DESIGN §6.12). */
export interface BookingSettings {
  providerResponseHours: number;
  /** Hours after acceptance to pay the advance before the hold is released. */
  paymentWindowHours: number;
  noShowGraceHours: number;
  contactRevealStage: 'accepted' | 'confirmed';
  /** Percent of the rental subtotal paid online as the advance (TECH_DECISIONS D8, model B). */
  advancePercentage: number;
  /** Customer cancellations at least this many hours before pickup get the advance back in full. */
  cancellationFullRefundHours: number;
  /** Days after completion during which a customer may leave (and edit) a review (Phase 8). */
  reviewWindowDays: number;
  /** One payment reminder this many hours before `confirm_by` (Phase 8). */
  paymentReminderHoursBefore: number;
  /** One pickup reminder this many hours before `starts_at` (Phase 8). */
  pickupReminderHoursBefore: number;
  /** One review reminder this many days after completion when no review exists (Phase 8). */
  reviewReminderDaysAfter: number;
  /** Days after completion / no-show / cancellation during which a dispute may be opened (Phase 9). */
  disputeWindowDays: number;
  /** Pause (suspend) a listing when an approved revenue licence / insurance expires (Phase 9). */
  autoPauseOnDocumentExpiry: boolean;
  /** Search radius when the searched place has none of its own (Phase 9 makes the setting live). */
  defaultSearchRadiusKm: number;
  /** Largest radius a client may request; larger values are clamped. */
  maxSearchRadiusKm: number;
  /** Days a rejected verification document (and its file) is kept before the retention sweep deletes it (Phase 10); 0 keeps forever. */
  documentRetentionRejectedDays: number;
  /** Days a superseded verification document is kept after replacement (Phase 10); 0 keeps forever. */
  documentRetentionSupersededDays: number;
  /** Days after a booking finishes before its driver snapshot is purged (Phase 10); 0 = disabled (pending legal review). */
  driverSnapshotRetentionDays: number;
  /** Days anonymous search logs are kept (Phase 10); 0 keeps forever. */
  searchLogRetentionDays: number;
}

export const DEFAULT_BOOKING_SETTINGS: BookingSettings = {
  providerResponseHours: 24,
  paymentWindowHours: 24,
  noShowGraceHours: 3,
  contactRevealStage: 'confirmed',
  advancePercentage: 10,
  cancellationFullRefundHours: 48,
  reviewWindowDays: 14,
  paymentReminderHoursBefore: 6,
  pickupReminderHoursBefore: 24,
  reviewReminderDaysAfter: 3,
  disputeWindowDays: 14,
  autoPauseOnDocumentExpiry: true,
  defaultSearchRadiusKm: 15,
  maxSearchRadiusKm: 50,
  documentRetentionRejectedDays: 30,
  documentRetentionSupersededDays: 90,
  driverSnapshotRetentionDays: 0,
  searchLogRetentionDays: 400,
};

const KEYS = [
  'provider_response_hours',
  'payment_window_hours',
  'no_show_grace_hours',
  'contact_reveal_stage',
  'advance_percentage',
  'cancellation_full_refund_hours',
  'review_window_days',
  'payment_reminder_hours_before',
  'pickup_reminder_hours_before',
  'review_reminder_days_after',
  'dispute_window_days',
  'auto_pause_on_document_expiry',
  'default_search_radius_km',
  'max_search_radius_km',
  'document_retention_rejected_days',
  'document_retention_superseded_days',
  'driver_snapshot_retention_days',
  'search_log_retention_days',
] as const;
const Percent = z.number().min(1).max(100);
const Km = z.number().min(1).max(200);

const Hours = z
  .number()
  .min(0.25)
  .max(24 * 30);
const Grace = z.number().min(0).max(72);
const Days = z.number().min(1).max(90);
/** Retention periods in days; 0 disables the class. */
const RetentionDays = z.number().int().min(0).max(3650);
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
      advancePercentage: pick(Percent, byKey.get('advance_percentage'), d.advancePercentage),
      cancellationFullRefundHours: pick(
        Hours,
        byKey.get('cancellation_full_refund_hours'),
        d.cancellationFullRefundHours,
      ),
      reviewWindowDays: pick(Days, byKey.get('review_window_days'), d.reviewWindowDays),
      paymentReminderHoursBefore: pick(
        Hours,
        byKey.get('payment_reminder_hours_before'),
        d.paymentReminderHoursBefore,
      ),
      pickupReminderHoursBefore: pick(
        Hours,
        byKey.get('pickup_reminder_hours_before'),
        d.pickupReminderHoursBefore,
      ),
      reviewReminderDaysAfter: pick(
        Days,
        byKey.get('review_reminder_days_after'),
        d.reviewReminderDaysAfter,
      ),
      disputeWindowDays: pick(Days, byKey.get('dispute_window_days'), d.disputeWindowDays),
      autoPauseOnDocumentExpiry: pick(
        z.boolean(),
        byKey.get('auto_pause_on_document_expiry'),
        d.autoPauseOnDocumentExpiry,
      ),
      defaultSearchRadiusKm: pick(
        Km,
        byKey.get('default_search_radius_km'),
        d.defaultSearchRadiusKm,
      ),
      maxSearchRadiusKm: pick(Km, byKey.get('max_search_radius_km'), d.maxSearchRadiusKm),
      documentRetentionRejectedDays: pick(
        RetentionDays,
        byKey.get('document_retention_rejected_days'),
        d.documentRetentionRejectedDays,
      ),
      documentRetentionSupersededDays: pick(
        RetentionDays,
        byKey.get('document_retention_superseded_days'),
        d.documentRetentionSupersededDays,
      ),
      driverSnapshotRetentionDays: pick(
        RetentionDays,
        byKey.get('driver_snapshot_retention_days'),
        d.driverSnapshotRetentionDays,
      ),
      searchLogRetentionDays: pick(
        RetentionDays,
        byKey.get('search_log_retention_days'),
        d.searchLogRetentionDays,
      ),
    };
    this.cached = { value, at: Date.now() };
    return value;
  }

  /** Forgets the cache (tests, admin settings changes). */
  invalidate(): void {
    this.cached = undefined;
  }
}
