import { z } from 'zod';

import { CountryCodeSchema } from '../auth/user';
import {
  CURRENCY,
  LkrAmountSchema,
  SettlementCurrencySchema,
  normalizeAmount,
  percentOfAmount,
  subtractAmounts,
} from '../common/money';
import { AdminPaymentSchema, BookingPaymentSummarySchema } from '../payments/payment';
import {
  MAX_SEARCH_DAYS,
  MAX_SEARCH_HORIZON_DAYS,
  estimateRental,
  type PublicPricing,
} from '../discovery/public';
import { PaginationQuerySchema } from '../providers/provider';
import { VehicleHoldSchema } from '../vehicles/availability';

/**
 * Booking lifecycle (USER_FLOWS §0, TECH_DECISIONS D12). Phase 6 is the lean
 * request-to-book loop without payment: a `requested` booking never blocks the
 * vehicle; the exclusive hold is created when the provider accepts; `confirmed`
 * is reached through a temporary admin action until online payment (Phase 7).
 */
export const BookingStatusSchema = z.enum([
  'requested',
  'accepted',
  'confirmed',
  'active',
  'completed',
  'declined',
  'expired',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'no_show',
]);
export type BookingStatus = z.infer<typeof BookingStatusSchema>;

/** Statuses that still need something to happen. */
export const OPEN_BOOKING_STATUSES: readonly BookingStatus[] = [
  'requested',
  'accepted',
  'confirmed',
  'active',
];
/** Final statuses: no transition leaves them. */
export const TERMINAL_BOOKING_STATUSES: readonly BookingStatus[] = [
  'completed',
  'declined',
  'expired',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'no_show',
];
/** Statuses during which an exclusive `vehicle_holds` row exists for the booking. */
export const HELD_BOOKING_STATUSES: readonly BookingStatus[] = [
  'accepted',
  'confirmed',
  'active',
  'completed',
];

/** Reasons a provider may choose when declining. */
export const ProviderDeclineReasonSchema = z.enum([
  'vehicle_unavailable',
  'requirements_not_met',
  'schedule_conflict',
  'other',
]);
export type ProviderDeclineReason = z.infer<typeof ProviderDeclineReasonSchema>;

/** Provider reasons plus the system reason used when another request for the same period was accepted. */
export const DeclineReasonSchema = z.enum([
  ...ProviderDeclineReasonSchema.options,
  'vehicle_no_longer_available',
]);
export type DeclineReason = z.infer<typeof DeclineReasonSchema>;

/** Customer-facing wording for decline reasons (used in e-mails and both UIs). */
export const DECLINE_REASON_LABEL: Record<DeclineReason, string> = {
  vehicle_unavailable: 'The vehicle is not available for these dates',
  requirements_not_met: 'The rental requirements are not met',
  schedule_conflict: 'The provider has a schedule conflict',
  other: 'Other reason',
  vehicle_no_longer_available: 'The vehicle was booked for overlapping dates',
};

/** Who performed a booking event. */
export const BookingActorTypeSchema = z.enum(['customer', 'provider', 'admin', 'system']);
export type BookingActorType = z.infer<typeof BookingActorTypeSchema>;

/** Whose view of a booking a response is (drives which fields are present). */
export const BookingViewerSchema = z.enum(['customer', 'provider', 'admin']);
export type BookingViewer = z.infer<typeof BookingViewerSchema>;

/** Actions a client may offer; computed server-side per viewer and state. */
export const BookingActionSchema = z.enum([
  'cancel',
  'accept',
  'decline',
  'pickup',
  'return',
  'no_show',
  'reveal_contact',
  /** Customer may start (or retry) the online advance payment. */
  'pay',
]);
export type BookingAction = z.infer<typeof BookingActionSchema>;

export const QuoteUnavailableReasonSchema = z.enum([
  'not_bookable',
  'date_conflict',
  'outside_min_days',
  'outside_max_days',
  'too_soon',
  'too_far_ahead',
]);
export type QuoteUnavailableReason = z.infer<typeof QuoteUnavailableReasonSchema>;

// ------------------------------------------------------------------ limits

export const MAX_BOOKING_DAYS = MAX_SEARCH_DAYS;
export const MAX_BOOKING_HORIZON_DAYS = MAX_SEARCH_HORIZON_DAYS;
/** A request must start at least this far in the future (gives the provider time to answer). */
export const MIN_BOOKING_LEAD_HOURS = 2;
export const MAX_BOOKING_NOTE_CHARS = 1000;
export const MAX_BOOKING_REASON_NOTE_CHARS = 500;
export const MAX_ODOMETER_KM = 9_999_999;
/** Fuel gauge in eighths: 0 = empty, 8 = full. */
export const FuelLevelSchema = z.number().int().min(0).max(8);

const DAY_MS = 86_400_000;
const Instant = z.iso.datetime({ offset: true });
const Version = z.number().int().min(1);
const ShortNote = z.string().trim().max(MAX_BOOKING_REASON_NOTE_CHARS).nullable().optional();

/**
 * `Idempotency-Key` header (API_DESIGN §1): client-generated, 8–128 chars,
 * scoped to the calling customer. Same key + same request → same booking; same
 * key + different request → `409 IDEMPOTENCY_CONFLICT`.
 */
export const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
export const IdempotencyKeySchema = z
  .string()
  .regex(
    IDEMPOTENCY_KEY_PATTERN,
    'must be 8–128 characters of A–Z, a–z, 0–9, "_", ".", ":" or "-"',
  );

// ------------------------------------------------------------------- quote

export const BookingQuoteQuerySchema = z
  .object({ startsAt: Instant, endsAt: Instant })
  .superRefine((v, ctx) => {
    const start = Date.parse(v.startsAt);
    const end = Date.parse(v.endsAt);
    if (!(end > start)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'end must be after start' });
    } else if (end - start > MAX_BOOKING_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: `a rental cannot be longer than ${MAX_BOOKING_DAYS} days`,
      });
    }
  });
export type BookingQuoteQuery = z.infer<typeof BookingQuoteQuerySchema>;

export const PriceLineSchema = z.object({
  code: z.enum(['rental']),
  label: z.string(),
  amount: LkrAmountSchema,
});
export type PriceLine = z.infer<typeof PriceLineSchema>;

/**
 * The price snapshot stored on a booking and shown in a quote. Only the rental
 * itself is priced; the deposit, fuel, delivery and extra kilometres are
 * settled with the provider in person. The money split (TECH_DECISIONS D8,
 * model B): `advance` (= `advancePercentage` of `subtotal`) is paid online to
 * the platform; `balanceDue` (= `subtotal` − `advance`) is paid to the
 * provider at pickup; the deposit is separate and refundable.
 */
export const BookingPriceSchema = z.object({
  currency: SettlementCurrencySchema,
  rentalDays: z.number().int().positive(),
  basis: z.enum(['daily', 'weekly', 'monthly']),
  dailyRate: LkrAmountSchema,
  weeklyRate: LkrAmountSchema.nullable(),
  monthlyRate: LkrAmountSchema.nullable(),
  /** Rental total for the period at the provider's listed rates. */
  subtotal: LkrAmountSchema,
  /** Refundable, paid to the provider at pickup; not part of `subtotal`. */
  securityDeposit: LkrAmountSchema,
  /** Percent of `subtotal` paid online (platform setting `advance_percentage` at request time), e.g. "10.00". */
  advancePercentage: z.string().regex(/^\d{1,3}\.\d{2}$/),
  /** Paid online after acceptance; confirms the booking. */
  advance: LkrAmountSchema,
  /** Paid to the provider at pickup (`subtotal − advance`). */
  balanceDue: LkrAmountSchema,
  includedKmPerDay: z.number().int().nullable(),
  includedKmTotal: z.number().int().nullable(),
  extraKmRate: LkrAmountSchema.nullable(),
  lines: z.array(PriceLineSchema),
});
export type BookingPrice = z.infer<typeof BookingPriceSchema>;

export const BOOKING_PRICE_NOTE =
  'Rental price at the provider’s listed rates. The advance is paid online and confirms the booking; the balance, the refundable deposit, fuel, delivery and extra kilometres are settled with the provider at pickup and return.';

/** Seeded `advance_percentage` (DATABASE_DESIGN §6.12); the API reads the live setting. */
export const DEFAULT_ADVANCE_PERCENTAGE = 10;

/** `percent` as the two-decimal string stored on bookings ("10" → "10.00"). */
export function normalizePercentage(percent: string | number): string {
  const text = typeof percent === 'number' ? percent.toString() : percent.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new Error(`Invalid percentage: ${text}`);
  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

/** Deterministic price for a period from the listed rates (same tiers as the public estimate). */
export function computeBookingPrice(
  pricing: PublicPricing,
  rentalDays: number,
  advancePercentage: string | number = DEFAULT_ADVANCE_PERCENTAGE,
): BookingPrice {
  const estimate = estimateRental(pricing, rentalDays);
  const advance = percentOfAmount(estimate.subtotal, advancePercentage);
  const basisLabel =
    estimate.basis === 'daily'
      ? 'daily rate'
      : estimate.basis === 'weekly'
        ? 'weekly + daily rates'
        : 'monthly + weekly + daily rates';
  return {
    currency: CURRENCY,
    rentalDays,
    basis: estimate.basis,
    dailyRate: normalizeAmount(pricing.dailyRate),
    weeklyRate: pricing.weeklyRate ? normalizeAmount(pricing.weeklyRate) : null,
    monthlyRate: pricing.monthlyRate ? normalizeAmount(pricing.monthlyRate) : null,
    subtotal: estimate.subtotal,
    securityDeposit: normalizeAmount(pricing.securityDeposit),
    advancePercentage: normalizePercentage(advancePercentage),
    advance,
    balanceDue: subtractAmounts(estimate.subtotal, advance),
    includedKmPerDay: pricing.includedKmPerDay,
    includedKmTotal:
      pricing.includedKmPerDay === null ? null : pricing.includedKmPerDay * rentalDays,
    extraKmRate: pricing.extraKmRate ? normalizeAmount(pricing.extraKmRate) : null,
    lines: [
      {
        code: 'rental',
        label: `${rentalDays} day${rentalDays === 1 ? '' : 's'} (${basisLabel})`,
        amount: estimate.subtotal,
      },
    ],
  };
}

/** `GET /vehicles/{idOrSlug}/quote`: price for a window plus a signed token to book it. */
export const BookingQuoteSchema = z.object({
  vehicleId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** Vehicle is listed and no hold overlaps the window. */
  available: z.boolean(),
  /** `available` and the length and lead-time rules are met; a token is present only then. */
  bookable: z.boolean(),
  reasons: z.array(QuoteUnavailableReasonSchema),
  price: BookingPriceSchema,
  /** Signed snapshot (vehicle, window, price); null when not bookable. */
  quoteToken: z.string().nullable(),
  expiresAt: z.iso.datetime().nullable(),
  note: z.string(),
});
export type BookingQuote = z.infer<typeof BookingQuoteSchema>;

// ------------------------------------------------------------------ create

/**
 * Driver details as given for this booking (snapshot). No licence number and
 * no documents: the provider checks the physical licence at handover
 * (SECURITY_AND_PRIVACY §6; encryption helpers arrive with document handling).
 */
export const BookingDriverInputSchema = z.strictObject({
  fullName: z.string().trim().min(2).max(120),
  /** Country of residence / nationality (ISO 3166-1 alpha-2), optional. */
  countryCode: CountryCodeSchema.nullable().optional(),
  /** Country that issued the driving licence. */
  licenceCountry: CountryCodeSchema,
  /** `YYYY-MM-DD`; must not expire before the rental ends. */
  licenceExpiresOn: z.iso.date(),
});
export type BookingDriverInput = z.infer<typeof BookingDriverInputSchema>;

/** `POST /bookings`. Prices are never accepted from the client (strict object + server snapshot). */
export const CreateBookingRequestSchema = z
  .strictObject({
    vehicleId: z.uuid(),
    startsAt: Instant,
    endsAt: Instant,
    quoteToken: z.string().min(16).max(2048),
    driver: BookingDriverInputSchema,
    customerNote: z.string().trim().max(MAX_BOOKING_NOTE_CHARS).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const start = Date.parse(v.startsAt);
    const end = Date.parse(v.endsAt);
    if (!(end > start)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'end must be after start' });
      return;
    }
    if (end - start > MAX_BOOKING_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: `a rental cannot be longer than ${MAX_BOOKING_DAYS} days`,
      });
    }
    // The licence must still be valid at the end of the rental (end of that day in Sri Lanka).
    if (Date.parse(`${v.driver.licenceExpiresOn}T23:59:59+05:30`) < end) {
      ctx.addIssue({
        code: 'custom',
        path: ['driver', 'licenceExpiresOn'],
        message: 'the driving licence must be valid until the end of the rental',
      });
    }
  });
export type CreateBookingRequest = z.infer<typeof CreateBookingRequestSchema>;

// ------------------------------------------------------------- transitions

export const AcceptBookingRequestSchema = z.strictObject({
  version: Version,
  /** Shown to the customer (e.g. where to meet); optional. */
  providerNote: ShortNote,
});
export type AcceptBookingRequest = z.infer<typeof AcceptBookingRequestSchema>;

export const DeclineBookingRequestSchema = z
  .strictObject({
    version: Version,
    reason: ProviderDeclineReasonSchema,
    note: ShortNote,
  })
  .superRefine((v, ctx) => {
    if (v.reason === 'other' && (v.note ?? '').trim().length < 5) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: 'add a short note when the reason is "other"',
      });
    }
  });
export type DeclineBookingRequest = z.infer<typeof DeclineBookingRequestSchema>;

export const CancelBookingRequestSchema = z.strictObject({
  version: Version,
  note: ShortNote,
});
export type CancelBookingRequest = z.infer<typeof CancelBookingRequestSchema>;

/** Pickup and return records: optional odometer / fuel readings and a note. */
export const HandoverRequestSchema = z.strictObject({
  version: Version,
  odometerKm: z.number().int().min(0).max(MAX_ODOMETER_KM).nullable().optional(),
  fuelLevel: FuelLevelSchema.nullable().optional(),
  note: ShortNote,
});
export type HandoverRequest = z.infer<typeof HandoverRequestSchema>;

export const NoShowBookingRequestSchema = z.strictObject({
  version: Version,
  /** How the provider tried to reach the customer (required). */
  note: z.string().trim().min(5).max(MAX_BOOKING_REASON_NOTE_CHARS),
});
export type NoShowBookingRequest = z.infer<typeof NoShowBookingRequestSchema>;

// ------------------------------------------------------------------- lists

export const BookingScopeSchema = z.enum(['open', 'past', 'all']);
export type BookingScope = z.infer<typeof BookingScopeSchema>;

export const BookingListQuerySchema = PaginationQuerySchema.extend({
  status: BookingStatusSchema.optional(),
  scope: BookingScopeSchema.default('all'),
});
export type BookingListQuery = z.infer<typeof BookingListQuerySchema>;

export const ProviderBookingListQuerySchema = BookingListQuerySchema.extend({
  vehicleId: z.uuid().optional(),
});
export type ProviderBookingListQuery = z.infer<typeof ProviderBookingListQuerySchema>;

export const AdminBookingListQuerySchema = PaginationQuerySchema.extend({
  status: BookingStatusSchema.optional(),
  providerId: z.uuid().optional(),
  customerId: z.uuid().optional(),
  reference: z.string().trim().min(3).max(20).optional(),
});
export type AdminBookingListQuery = z.infer<typeof AdminBookingListQuerySchema>;

// ------------------------------------------------------------------- views

export const BookingVehicleSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string().nullable(),
  title: z.string(),
  make: z.string(),
  model: z.string(),
  modelYear: z.number().int(),
  categoryId: z.string(),
  thumbnailUrl: z.string().nullable(),
  /** Providers and admins always; customers only from the reveal stage. */
  registrationNumber: z.string().nullable(),
});
export type BookingVehicleSummary = z.infer<typeof BookingVehicleSummarySchema>;

export const BookingProviderSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  platformApproved: z.literal(true),
});
export type BookingProviderSummary = z.infer<typeof BookingProviderSummarySchema>;

export const BookingCustomerSummarySchema = z.object({
  id: z.uuid(),
  /** First name until the reveal stage, then the full name (provider view); full name for the customer themself. */
  name: z.string(),
  /** `YYYY-MM`. */
  memberSince: z.string(),
  emailVerified: z.boolean(),
});
export type BookingCustomerSummary = z.infer<typeof BookingCustomerSummarySchema>;

export const BookingDriverSchema = z.object({
  fullName: z.string(),
  countryCode: z.string().nullable(),
  licenceCountry: z.string(),
  licenceExpiresOn: z.iso.date(),
});
export type BookingDriver = z.infer<typeof BookingDriverSchema>;

export const BookingPickupSchema = z.object({
  locationName: z.string(),
  placeName: z.string(),
  districtName: z.string(),
  /** Exact details only from the reveal stage (customer view); always for the provider. */
  address: z.string().nullable(),
  instructions: z.string().nullable(),
  point: z.object({ lat: z.number(), lng: z.number() }).nullable(),
});
export type BookingPickup = z.infer<typeof BookingPickupSchema>;

export const BookingHandoverSchema = z.object({
  pickupOdometerKm: z.number().int().nullable(),
  pickupFuelLevel: z.number().int().nullable(),
  pickupNote: z.string().nullable(),
  returnOdometerKm: z.number().int().nullable(),
  returnFuelLevel: z.number().int().nullable(),
  returnNote: z.string().nullable(),
});
export type BookingHandover = z.infer<typeof BookingHandoverSchema>;

export const BookingEventSchema = z.object({
  id: z.uuid(),
  /** Dotted verb, e.g. `booking.requested`, `booking.accepted`, `booking.contact_revealed`. */
  action: z.string(),
  actorType: BookingActorTypeSchema,
  fromStatus: BookingStatusSchema.nullable(),
  toStatus: BookingStatusSchema.nullable(),
  /** Safe, non-personal details (reason codes, counts); never contact data or notes. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.iso.datetime(),
});
export type BookingEvent = z.infer<typeof BookingEventSchema>;

export const BookingContactStateSchema = z.object({
  available: z.boolean(),
  /** Status from which `GET /bookings/{id}/contact` works (platform setting). */
  revealStage: BookingStatusSchema,
});

export const BookingSchema = z.object({
  id: z.uuid(),
  /** Human-readable code, e.g. `SLR-7F3K2Q`. */
  reference: z.string(),
  status: BookingStatusSchema,
  version: z.number().int().min(1),
  viewer: BookingViewerSchema,
  vehicle: BookingVehicleSummarySchema,
  provider: BookingProviderSummarySchema,
  customer: BookingCustomerSummarySchema,
  driver: BookingDriverSchema.nullable(),
  pickup: BookingPickupSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  rentalDays: z.number().int().positive(),
  price: BookingPriceSchema,
  customerNote: z.string().nullable(),
  providerNote: z.string().nullable(),
  /** Provider must answer by this instant while `requested`. */
  respondBy: z.iso.datetime(),
  /** While `accepted`: confirmation (payment in Phase 7) must happen by this instant or the hold is released. */
  confirmBy: z.iso.datetime().nullable(),
  acceptedAt: z.iso.datetime().nullable(),
  confirmedAt: z.iso.datetime().nullable(),
  pickedUpAt: z.iso.datetime().nullable(),
  completedAt: z.iso.datetime().nullable(),
  declinedAt: z.iso.datetime().nullable(),
  expiredAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
  noShowAt: z.iso.datetime().nullable(),
  declineReason: DeclineReasonSchema.nullable(),
  declineNote: z.string().nullable(),
  cancellationNote: z.string().nullable(),
  noShowNote: z.string().nullable(),
  /** How the booking became `confirmed`: a verified online payment, or (legacy Phase 6 rows) the retired admin testing bridge. */
  confirmationSource: z.enum(['payment', 'admin_testing']).nullable(),
  handover: BookingHandoverSchema,
  contact: BookingContactStateSchema,
  /** The online advance, as far as this viewer may know. */
  payment: BookingPaymentSummarySchema,
  allowedActions: z.array(BookingActionSchema),
  events: z.array(BookingEventSchema),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Booking = z.infer<typeof BookingSchema>;

export const BookingSummarySchema = BookingSchema.omit({
  events: true,
  handover: true,
  pickup: true,
  driver: true,
  customerNote: true,
  providerNote: true,
});
export type BookingSummary = z.infer<typeof BookingSummarySchema>;

export const BookingListSchema = z.object({
  data: z.array(BookingSummarySchema),
  nextCursor: z.string().nullable(),
});
export type BookingList = z.infer<typeof BookingListSchema>;

/** `GET /bookings/{id}/contact`: the counterparty's contact details once revealed. */
export const BookingContactSchema = z.object({
  /** Whose details these are. */
  party: z.enum(['customer', 'provider']),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  whatsappUrl: z.string().nullable(),
});
export type BookingContact = z.infer<typeof BookingContactSchema>;

/** Admin inspection view: everything plus the hold, both parties' e-mail and the payment attempts. */
export const AdminBookingSchema = BookingSchema.extend({
  customerEmail: z.string(),
  providerEmail: z.string(),
  hold: VehicleHoldSchema.nullable(),
  payments: z.array(AdminPaymentSchema),
});
export type AdminBooking = z.infer<typeof AdminBookingSchema>;

export const AdminBookingListSchema = z.object({
  data: z.array(BookingSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminBookingList = z.infer<typeof AdminBookingListSchema>;
