import { z } from 'zod';

import {
  LkrAmountSchema,
  SettlementCurrencySchema,
  amountToCents,
  centsToAmount,
  compareAmounts,
} from '../common/money';
import { PlaceKindSchema, SlugIdSchema } from '../reference/reference';
import { PhotoVariantUrlsSchema } from '../vehicles/photo';
import { FuelPolicySchema, FuelTypeSchema, TransmissionSchema } from '../vehicles/vehicle';

/**
 * Public discovery (TECH_DECISIONS D44–D46): customer-safe projections of
 * approved listings. Nothing in this file may carry exact coordinates,
 * addresses, pickup instructions, registration numbers, provider contact
 * details or internal notes.
 */

// ------------------------------------------------------------- limits

export const DEFAULT_SEARCH_RADIUS_KM = 15;
export const MAX_SEARCH_RADIUS_KM = 50;
/** Longest rental window a search may ask about. */
export const MAX_SEARCH_DAYS = 90;
/** How far ahead a search window may start. */
export const MAX_SEARCH_HORIZON_DAYS = 365;
export const SEARCH_PAGE_MAX = 50;
export const SEARCH_PAGE_DEFAULT = 20;

/**
 * Public map points are snapped to a ~0.005° grid (≈ 550 m in Sri Lanka), so
 * the exact pin of a provider location is never derivable from a public
 * response (SECURITY_AND_PRIVACY §13). Deterministic: the same location
 * always maps to the same public point.
 */
export const APPROX_GRID_DEGREES = 0.005;

const DAY_MS = 86_400_000;
const Instant = z.iso.datetime({ offset: true });
const BoolParam = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

// ------------------------------------------------------------- queries

export const SearchSortSchema = z.enum(['relevance', 'distance', 'price_asc', 'price_desc']);
export type SearchSort = z.infer<typeof SearchSortSchema>;

function refineWindow(
  v: { startsAt?: string | undefined; endsAt?: string | undefined },
  ctx: z.RefinementCtx,
  maxDays: number,
): void {
  if ((v.startsAt === undefined) !== (v.endsAt === undefined)) {
    ctx.addIssue({
      code: 'custom',
      path: [v.startsAt === undefined ? 'startsAt' : 'endsAt'],
      message: 'provide both pickup and return, or neither',
    });
    return;
  }
  if (v.startsAt === undefined || v.endsAt === undefined) return;
  const start = Date.parse(v.startsAt);
  const end = Date.parse(v.endsAt);
  if (!(end > start)) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'return must be after pickup' });
  } else if (end - start > maxDays * DAY_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: `rental windows longer than ${maxDays} days are not searchable yet`,
    });
  }
  if (start > Date.now() + MAX_SEARCH_HORIZON_DAYS * DAY_MS) {
    ctx.addIssue({
      code: 'custom',
      path: ['startsAt'],
      message: `pickup cannot be more than ${MAX_SEARCH_HORIZON_DAYS} days ahead`,
    });
  }
  if (end < Date.now()) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'the window is in the past' });
  }
}

export const VehicleSearchQuerySchema = z
  .object({
    placeId: z.uuid().optional(),
    districtId: SlugIdSchema.optional(),
    radiusKm: z.coerce.number().min(1).max(MAX_SEARCH_RADIUS_KM).optional(),
    startsAt: Instant.optional(),
    endsAt: Instant.optional(),
    categoryId: SlugIdSchema.optional(),
    transmission: TransmissionSchema.optional(),
    fuelType: FuelTypeSchema.optional(),
    minSeats: z.coerce.number().int().min(1).max(60).optional(),
    hasAc: BoolParam.optional(),
    deliveryAvailable: BoolParam.optional(),
    minDailyRate: LkrAmountSchema.optional(),
    maxDailyRate: LkrAmountSchema.optional(),
    sort: SearchSortSchema.default('relevance'),
    limit: z.coerce.number().int().min(1).max(SEARCH_PAGE_MAX).default(SEARCH_PAGE_DEFAULT),
    cursor: z.string().max(512).optional(),
  })
  .superRefine((v, ctx) => {
    refineWindow(v, ctx, MAX_SEARCH_DAYS);
    if (v.minDailyRate && v.maxDailyRate && compareAmounts(v.minDailyRate, v.maxDailyRate) > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDailyRate'],
        message: 'maximum price cannot be below the minimum',
      });
    }
  });
export type VehicleSearchQuery = z.infer<typeof VehicleSearchQuerySchema>;
/** What a client sends (before coercion / defaults). */
export type VehicleSearchQueryInput = z.input<typeof VehicleSearchQuerySchema>;

export const PublicVehicleQuerySchema = z
  .object({ startsAt: Instant.optional(), endsAt: Instant.optional() })
  .superRefine((v, ctx) => refineWindow(v, ctx, MAX_SEARCH_DAYS));
export type PublicVehicleQuery = z.infer<typeof PublicVehicleQuerySchema>;

export const PlaceSuggestQuerySchema = z.object({
  q: z.string().trim().min(1).max(60),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});
export type PlaceSuggestQuery = z.infer<typeof PlaceSuggestQuerySchema>;

// ------------------------------------------------------------- views

export const ApproxPointSchema = z.object({
  lat: z.number(),
  lng: z.number(),
  /** `approximate` = provider pin snapped to the grid; `place` = the town centre (no pin). */
  source: z.enum(['approximate', 'place']),
});
export type ApproxPoint = z.infer<typeof ApproxPointSchema>;

export const PublicPlaceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  districtId: z.string(),
  districtName: z.string(),
});
export type PublicPlace = z.infer<typeof PublicPlaceSchema>;

export const PlaceSuggestionSchema = PublicPlaceSchema.extend({
  kind: PlaceKindSchema,
  isLaunchArea: z.boolean(),
});
export type PlaceSuggestion = z.infer<typeof PlaceSuggestionSchema>;

/** Minimal provider identity shown on cards. */
export const PublicProviderBadgeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  displayName: z.string(),
  /** Always true for anything public: only platform-reviewed providers are listed. */
  platformApproved: z.literal(true),
});
export type PublicProviderBadge = z.infer<typeof PublicProviderBadgeSchema>;

/** Provider card on the vehicle page. No contact details, no metrics we do not have. */
export const PublicProviderSummarySchema = PublicProviderBadgeSchema.extend({
  description: z.string().nullable(),
  yearsOperating: z.number().int().nullable(),
  /** Month of approval, e.g. "2026-10". */
  approvedSince: z.string().regex(/^\d{4}-\d{2}$/),
  primaryPlace: z.object({ slug: z.string(), name: z.string() }),
  districtId: z.string(),
  /** Listings currently discoverable. */
  vehicleCount: z.number().int().min(0),
});
export type PublicProviderSummary = z.infer<typeof PublicProviderSummarySchema>;

export const PublicPhotoSchema = z.object({
  id: z.uuid(),
  sortOrder: z.number().int(),
  width: z.number().int(),
  height: z.number().int(),
  variants: PhotoVariantUrlsSchema,
});
export type PublicPhoto = z.infer<typeof PublicPhotoSchema>;

export const PublicPricingSchema = z.object({
  currency: SettlementCurrencySchema,
  dailyRate: z.string(),
  weeklyRate: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  securityDeposit: z.string(),
  includedKmPerDay: z.number().int().nullable(),
  extraKmRate: z.string().nullable(),
  minRentalDays: z.number().int(),
  maxRentalDays: z.number().int().nullable(),
});
export type PublicPricing = z.infer<typeof PublicPricingSchema>;

/** Informational estimate from the listed rates. Explicitly not a booking quote. */
export const RentalEstimateSchema = z.object({
  days: z.number().int().positive(),
  subtotal: z.string(),
  basis: z.enum(['daily', 'weekly', 'monthly']),
  note: z.string(),
});
export type RentalEstimate = z.infer<typeof RentalEstimateSchema>;

export const PublicVehicleCardSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  categoryId: z.string(),
  make: z.string(),
  model: z.string(),
  modelYear: z.number().int(),
  transmission: TransmissionSchema.nullable(),
  fuelType: FuelTypeSchema.nullable(),
  seats: z.number().int().nullable(),
  hasAc: z.boolean(),
  deliveryAvailable: z.boolean(),
  deliveryFee: z.string().nullable(),
  photo: PublicPhotoSchema.nullable(),
  provider: PublicProviderBadgeSchema,
  place: PublicPlaceSchema,
  approxPoint: ApproxPointSchema.nullable(),
  /** Great-circle distance from the searched place centre, when both points exist. */
  distanceKm: z.number().nullable(),
  pricing: PublicPricingSchema,
  /** Present when the search carried dates. */
  estimate: RentalEstimateSchema.nullable(),
});
export type PublicVehicleCard = z.infer<typeof PublicVehicleCardSchema>;

export const SearchCriteriaSchema = z.object({
  place: PublicPlaceSchema.nullable(),
  districtId: z.string().nullable(),
  radiusKm: z.number().nullable(),
  startsAt: z.iso.datetime().nullable(),
  endsAt: z.iso.datetime().nullable(),
  days: z.number().int().nullable(),
  sort: SearchSortSchema,
});
export type SearchCriteria = z.infer<typeof SearchCriteriaSchema>;

export const VehicleSearchResponseSchema = z.object({
  data: z.array(PublicVehicleCardSchema),
  nextCursor: z.string().nullable(),
  criteria: SearchCriteriaSchema,
});
export type VehicleSearchResponse = z.infer<typeof VehicleSearchResponseSchema>;

export const PublicAvailabilitySchema = z.object({
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  days: z.number().int().positive(),
  /** No hold overlaps the window. */
  available: z.boolean(),
  /** The window respects the listing's minimum / maximum rental days. */
  meetsRentalLength: z.boolean(),
  estimate: RentalEstimateSchema.nullable(),
});
export type PublicAvailability = z.infer<typeof PublicAvailabilitySchema>;

export const PublicVehicleDetailSchema = PublicVehicleCardSchema.omit({
  photo: true,
  estimate: true,
  provider: true,
}).extend({
  description: z.string().nullable(),
  doors: z.number().int().nullable(),
  luggageCapacity: z.number().int().nullable(),
  engineCc: z.number().int().nullable(),
  color: z.string().nullable(),
  photos: z.array(PublicPhotoSchema),
  rules: z.object({
    minRenterAge: z.number().int().nullable(),
    minLicenceYears: z.number().int().nullable(),
    fuelPolicy: FuelPolicySchema.nullable(),
  }),
  provider: PublicProviderSummarySchema,
  availability: PublicAvailabilitySchema.nullable(),
});
export type PublicVehicleDetail = z.infer<typeof PublicVehicleDetailSchema>;

// ------------------------------------------------------------- helpers

/** Whole rental days for a half-open window (at least 1). */
export function rentalDays(startsAt: string | Date, endsAt: string | Date): number {
  const ms = new Date(endsAt).getTime() - new Date(startsAt).getTime();
  return Math.max(1, Math.ceil(ms / DAY_MS));
}

export const RENTAL_ESTIMATE_NOTE =
  'Estimated from the listed rates. Excludes the refundable deposit, delivery and extra kilometres. Not a booking quote.';

/**
 * Deterministic estimate from the stored daily / weekly / monthly rates:
 * whole months at the monthly rate (30 days), then whole weeks at the weekly
 * rate, then days at the daily rate. Never more than plain daily pricing.
 */
export function estimateRental(
  pricing: { dailyRate: string; weeklyRate: string | null; monthlyRate: string | null },
  days: number,
): RentalEstimate {
  const daily = amountToCents(pricing.dailyRate);
  const weekly = pricing.weeklyRate ? amountToCents(pricing.weeklyRate) : null;
  const monthly = pricing.monthlyRate ? amountToCents(pricing.monthlyRate) : null;
  const plain = daily * BigInt(days);

  const weeklyThenDaily = (n: number): bigint => {
    if (weekly !== null && n >= 7) {
      const weeks = Math.floor(n / 7);
      return weekly * BigInt(weeks) + daily * BigInt(n - weeks * 7);
    }
    return daily * BigInt(n);
  };

  let subtotal = plain;
  let basis: RentalEstimate['basis'] = 'daily';
  if (monthly !== null && days >= 30) {
    const months = Math.floor(days / 30);
    subtotal = monthly * BigInt(months) + weeklyThenDaily(days - months * 30);
    basis = 'monthly';
  } else if (weekly !== null && days >= 7) {
    subtotal = weeklyThenDaily(days);
    basis = 'weekly';
  }
  if (subtotal > plain) {
    subtotal = plain;
    basis = 'daily';
  }
  return { days, subtotal: centsToAmount(subtotal), basis, note: RENTAL_ESTIMATE_NOTE };
}

/** Snaps a precise point to the public grid (see `APPROX_GRID_DEGREES`). */
export function approximatePoint(point: { lat: number; lng: number }): {
  lat: number;
  lng: number;
} {
  const snap = (v: number) =>
    Number((Math.round(v / APPROX_GRID_DEGREES) * APPROX_GRID_DEGREES).toFixed(4));
  return { lat: snap(point.lat), lng: snap(point.lng) };
}

/** Distance in km from metres, one decimal, for display. */
export function metresToKm(metres: number): number {
  return Math.round(metres / 100) / 10;
}
