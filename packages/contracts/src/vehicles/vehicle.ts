import { z } from 'zod';

import type { ApiErrorDetail } from '../common/error';
import {
  LkrAmountSchema,
  SettlementCurrencySchema,
  compareAmounts,
  isAmount,
  multiplyAmount,
} from '../common/money';
import { PaginationQuerySchema } from '../providers/provider';
import { SlugIdSchema } from '../reference/reference';
import { ProviderLocationSchema } from './location';
import { MIN_VEHICLE_PHOTOS, VehiclePhotoSchema } from './photo';

// ------------------------------------------------------------------ enums

/**
 * One enum for the listing lifecycle (TECH_DECISIONS D38):
 *
 *   draft ──submit──▶ submitted ──start_review──▶ under_review
 *     ▲                  ├── request_changes ──▶ changes_requested ──submit──▶ submitted
 *     │                  ├── approve ─────────▶ approved ◀──activate── inactive (provider)
 *     │                  └── reject ──────────▶ rejected (terminal)        ▲
 *     │                                   approved | inactive ──suspend──▶ suspended ──reactivate──▶ approved
 */
export const VehicleStatusSchema = z.enum([
  'draft',
  'submitted',
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
  'inactive',
  'suspended',
]);
export type VehicleStatus = z.infer<typeof VehicleStatusSchema>;

export const TransmissionSchema = z.enum(['manual', 'automatic']);
export type Transmission = z.infer<typeof TransmissionSchema>;
export const FuelTypeSchema = z.enum(['petrol', 'diesel', 'hybrid', 'electric']);
export type FuelType = z.infer<typeof FuelTypeSchema>;
export const FuelPolicySchema = z.enum(['full_to_full', 'same_to_same', 'included']);
export type FuelPolicy = z.infer<typeof FuelPolicySchema>;

/**
 * Sri Lankan plates: `CAB-1234`, `KY-1234`, `WP CAB-1234` (province prefix),
 * legacy `15-1234` / `300-1234`. Lenient and upper-cased; never shown publicly
 * (see `maskRegistrationNumber`).
 */
export const RegistrationNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^(?:[A-Z]{2} )?(?:[A-Z]{1,3}|\d{1,3})-?\d{4}$/,
    'enter the registration number as on the plate, e.g. CAB-1234',
  );

/** "WP CAB-1234" → "WP CAB-••34": keeps the series, hides most of the number. */
export function maskRegistrationNumber(plate: string): string {
  return plate.replace(/(\d{4})$/, (digits) => `••${digits.slice(2)}`);
}

// ---------------------------------------------------------------- limits

export const CURRENT_MODEL_YEAR_MAX = new Date().getUTCFullYear() + 1;

/** Sanity bounds for transparent pricing (LKR). Not business rules; they catch typos. */
export const PRICING_LIMITS = {
  dailyRate: { min: '500', max: '1000000' },
  securityDeposit: { min: '0', max: '5000000' },
  extraKmRate: { min: '0', max: '10000' },
  deliveryFee: { min: '0', max: '100000' },
} as const;

const bounded = (field: keyof typeof PRICING_LIMITS) =>
  LkrAmountSchema.refine(
    (v) =>
      !isAmount(v) ||
      (compareAmounts(v, PRICING_LIMITS[field].min) >= 0 &&
        compareAmounts(v, PRICING_LIMITS[field].max) <= 0),
    `must be between ${PRICING_LIMITS[field].min} and ${PRICING_LIMITS[field].max} LKR`,
  );

const TitleSchema = z.string().trim().min(3).max(80);
const ShortTextSchema = z.string().trim().min(1).max(40);
const DescriptionSchema = z.string().trim().min(20).max(2000);
const NotesSchema = z.string().trim().max(1000);

// ---------------------------------------------------------------- fields

/** Every writable vehicle field with its validation. Drafts use the partial form. */
export const VehicleFieldsSchema = z.strictObject({
  categoryId: SlugIdSchema,
  /** Home pickup location (one of the provider's active locations). */
  locationId: z.uuid(),
  /** Public listing title, e.g. "Toyota Aqua 2018 – automatic hybrid". */
  title: TitleSchema,
  /** Internal reference, never public. */
  internalName: z.string().trim().max(80).nullable(),
  make: ShortTextSchema,
  model: ShortTextSchema,
  modelYear: z.number().int().min(1980).max(CURRENT_MODEL_YEAR_MAX),
  transmission: TransmissionSchema.nullable(),
  fuelType: FuelTypeSchema.nullable(),
  seats: z.number().int().min(1).max(60).nullable(),
  doors: z.number().int().min(2).max(6).nullable(),
  /** Bags. */
  luggageCapacity: z.number().int().min(0).max(30).nullable(),
  engineCc: z.number().int().min(49).max(8000).nullable(),
  hasAc: z.boolean(),
  color: z.string().trim().max(30).nullable(),
  registrationNumber: RegistrationNumberSchema,
  description: DescriptionSchema,

  // pricing (LKR, decimal strings)
  dailyRate: bounded('dailyRate'),
  weeklyRate: LkrAmountSchema.nullable(),
  monthlyRate: LkrAmountSchema.nullable(),
  securityDeposit: bounded('securityDeposit'),
  /** null = unlimited kilometres. */
  includedKmPerDay: z.number().int().min(1).max(2000).nullable(),
  extraKmRate: bounded('extraKmRate').nullable(),
  minRentalDays: z.number().int().min(1).max(90),
  maxRentalDays: z.number().int().min(1).max(365).nullable(),

  // rental rules
  minRenterAge: z.number().int().min(18).max(80).nullable(),
  minLicenceYears: z.number().int().min(0).max(50).nullable(),
  fuelPolicy: FuelPolicySchema.nullable(),
  deliveryAvailable: z.boolean(),
  /** Flat fee; null with `deliveryAvailable` = price on request. */
  deliveryFee: bounded('deliveryFee').nullable(),
  pickupNotes: NotesSchema.nullable(),
});
export type VehicleFields = z.infer<typeof VehicleFieldsSchema>;
export type VehicleField = keyof VehicleFields;

/** Locked once a vehicle has been approved (a new listing is needed to change them). */
export const VEHICLE_IDENTITY_FIELDS = [
  'categoryId',
  'make',
  'model',
  'modelYear',
  'transmission',
  'fuelType',
  'seats',
  'doors',
  'luggageCapacity',
  'engineCc',
  'hasAc',
  'color',
  'registrationNumber',
] as const satisfies readonly VehicleField[];

export type VehicleSpecField =
  'transmission' | 'fuelType' | 'seats' | 'doors' | 'luggageCapacity' | 'engineCc' | 'hasAc';

export interface VehicleCategoryRule {
  /** Must be present at submission. */
  required: readonly VehicleSpecField[];
  /** Must be empty (null / false) for this category. */
  notApplicable: readonly VehicleSpecField[];
}

/**
 * Category-specific requirements without a per-category table or a JSON blob
 * (TECH_DECISIONS D39). Unknown categories fall back to `DEFAULT_CATEGORY_RULE`.
 */
export const VEHICLE_CATEGORY_RULES: Readonly<Record<string, VehicleCategoryRule>> = {
  car: { required: ['transmission', 'fuelType', 'seats', 'doors'], notApplicable: [] },
  suv: { required: ['transmission', 'fuelType', 'seats', 'doors'], notApplicable: [] },
  van: { required: ['transmission', 'fuelType', 'seats'], notApplicable: [] },
  bike: { required: ['engineCc', 'fuelType', 'transmission'], notApplicable: ['doors', 'hasAc'] },
  scooter: { required: ['engineCc', 'fuelType'], notApplicable: ['doors', 'hasAc'] },
  tuktuk: { required: ['engineCc', 'fuelType', 'seats'], notApplicable: ['doors'] },
};
export const DEFAULT_CATEGORY_RULE: VehicleCategoryRule = {
  required: ['seats'],
  notApplicable: [],
};

export function categoryRule(categoryId: string | null | undefined): VehicleCategoryRule {
  return (categoryId && VEHICLE_CATEGORY_RULES[categoryId]) || DEFAULT_CATEGORY_RULE;
}

type Partialish = Partial<{ [K in VehicleField]: VehicleFields[K] | null | undefined }>;

const has = (v: unknown): boolean => v !== null && v !== undefined;

/** Cross-field pricing and rule checks; applied to drafts (when both sides exist) and at submission. */
export function pricingIssues(v: Partialish): ApiErrorDetail[] {
  const issues: ApiErrorDetail[] = [];
  // Refinements run even after a field failed its own checks, so only compare well-formed amounts.
  const dailyRate = isAmount(v.dailyRate) ? v.dailyRate : undefined;
  const weeklyRate = isAmount(v.weeklyRate) ? v.weeklyRate : undefined;
  const monthlyRate = isAmount(v.monthlyRate) ? v.monthlyRate : undefined;
  if (dailyRate && weeklyRate) {
    if (compareAmounts(weeklyRate, dailyRate) < 0) {
      issues.push({ field: 'weeklyRate', issue: 'weekly rate cannot be below the daily rate' });
    } else if (compareAmounts(weeklyRate, multiplyAmount(dailyRate, 7)) > 0) {
      issues.push({ field: 'weeklyRate', issue: 'weekly rate cannot exceed 7 × the daily rate' });
    }
  }
  if (dailyRate && monthlyRate) {
    const floor = weeklyRate ?? dailyRate;
    if (compareAmounts(monthlyRate, floor) < 0) {
      issues.push({
        field: 'monthlyRate',
        issue: 'monthly rate cannot be below the weekly (or daily) rate',
      });
    } else if (compareAmounts(monthlyRate, multiplyAmount(dailyRate, 30)) > 0) {
      issues.push({
        field: 'monthlyRate',
        issue: 'monthly rate cannot exceed 30 × the daily rate',
      });
    }
  }
  if (has(v.includedKmPerDay) && !has(v.extraKmRate)) {
    issues.push({ field: 'extraKmRate', issue: 'required when kilometres are limited' });
  }
  if (!has(v.includedKmPerDay) && has(v.extraKmRate)) {
    issues.push({ field: 'extraKmRate', issue: 'only applies when kilometres are limited' });
  }
  if (has(v.minRentalDays) && has(v.maxRentalDays) && v.maxRentalDays! < v.minRentalDays!) {
    issues.push({ field: 'maxRentalDays', issue: 'cannot be below the minimum rental days' });
  }
  if (v.deliveryAvailable === false && has(v.deliveryFee)) {
    issues.push({ field: 'deliveryFee', issue: 'only applies when delivery is available' });
  }
  return issues;
}

/** Category checks that apply to drafts too: fields that make no sense for the category. */
export function categoryApplicabilityIssues(v: Partialish): ApiErrorDetail[] {
  const rule = categoryRule(v.categoryId);
  const issues: ApiErrorDetail[] = [];
  for (const field of rule.notApplicable) {
    const value = v[field];
    if (value === true || (value !== null && value !== undefined && value !== false)) {
      issues.push({ field, issue: `does not apply to this vehicle category` });
    }
  }
  return issues;
}

const draftRefinement = (v: Partialish, ctx: z.RefinementCtx) => {
  for (const issue of [...pricingIssues(v), ...categoryApplicabilityIssues(v)]) {
    ctx.addIssue({ code: 'custom', path: issue.field ? [issue.field] : [], message: issue.issue });
  }
};

/** `POST /providers/me/vehicles`: a draft needs only its category. */
export const CreateVehicleRequestSchema = VehicleFieldsSchema.partial()
  .required({ categoryId: true })
  .superRefine(draftRefinement);
export type CreateVehicleRequest = z.infer<typeof CreateVehicleRequestSchema>;

/**
 * `PATCH /providers/me/vehicles/{id}`. All fields while `draft` /
 * `changes_requested`; identity fields are refused once approved (the service
 * reports them as `locked after approval`).
 */
export const UpdateVehicleRequestSchema =
  VehicleFieldsSchema.partial().superRefine(draftRefinement);
export type UpdateVehicleRequest = z.infer<typeof UpdateVehicleRequestSchema>;

/** Fields every listing needs before submission, regardless of category. */
export const VehicleRequiredSchema = z.object({
  categoryId: SlugIdSchema,
  locationId: z.uuid(),
  title: TitleSchema,
  make: ShortTextSchema,
  model: ShortTextSchema,
  modelYear: z.number().int(),
  registrationNumber: z.string().min(1),
  description: DescriptionSchema,
  dailyRate: LkrAmountSchema,
  securityDeposit: LkrAmountSchema,
  minRentalDays: z.number().int().min(1),
});

/**
 * Everything that must hold before a vehicle can be submitted or approved:
 * required fields, category-specific fields, pricing consistency. Shared by
 * the API (submit/approve) and the web form (checklist).
 */
export function vehicleSubmissionIssues(
  v: Partialish,
  options: { photoCount?: number } = {},
): ApiErrorDetail[] {
  const issues: ApiErrorDetail[] = [];
  const required = VehicleRequiredSchema.safeParse(
    Object.fromEntries(Object.entries(v).filter(([, value]) => value !== null)),
  );
  if (!required.success) {
    for (const issue of required.error.issues) {
      const field = issue.path.map(String).join('.');
      issues.push({
        field,
        issue:
          issue.code === 'invalid_type' && issue.message.includes('undefined')
            ? 'required'
            : issue.message,
      });
    }
  }
  const rule = categoryRule(v.categoryId);
  for (const field of rule.required) {
    if (!has(v[field])) issues.push({ field, issue: 'required for this vehicle category' });
  }
  issues.push(...categoryApplicabilityIssues(v), ...pricingIssues(v));
  if (options.photoCount !== undefined && options.photoCount < MIN_VEHICLE_PHOTOS) {
    issues.push({
      field: 'photos',
      issue: `at least ${MIN_VEHICLE_PHOTOS} photos are required (${options.photoCount} uploaded)`,
    });
  }
  const seen = new Set<string>();
  return issues.filter((i) => {
    const key = `${i.field}:${i.issue}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ----------------------------------------------------------------- views

export const VehicleEditabilitySchema = z.enum(['all', 'operational', 'none']);
export type VehicleEditability = z.infer<typeof VehicleEditabilitySchema>;

/** Provider's own view of a vehicle (full registration number; no admin notes). */
export const VehicleSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  status: VehicleStatusSchema,
  /** Public URL slug; null until first approval. */
  slug: z.string().nullable(),
  photos: z.array(VehiclePhotoSchema),
  categoryId: z.string(),
  locationId: z.uuid().nullable(),
  title: z.string().nullable(),
  internalName: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  modelYear: z.number().int().nullable(),
  transmission: TransmissionSchema.nullable(),
  fuelType: FuelTypeSchema.nullable(),
  seats: z.number().int().nullable(),
  doors: z.number().int().nullable(),
  luggageCapacity: z.number().int().nullable(),
  engineCc: z.number().int().nullable(),
  hasAc: z.boolean(),
  color: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  description: z.string().nullable(),
  currency: SettlementCurrencySchema,
  dailyRate: z.string().nullable(),
  weeklyRate: z.string().nullable(),
  monthlyRate: z.string().nullable(),
  securityDeposit: z.string().nullable(),
  includedKmPerDay: z.number().int().nullable(),
  extraKmRate: z.string().nullable(),
  minRentalDays: z.number().int(),
  maxRentalDays: z.number().int().nullable(),
  minRenterAge: z.number().int().nullable(),
  minLicenceYears: z.number().int().nullable(),
  fuelPolicy: FuelPolicySchema.nullable(),
  deliveryAvailable: z.boolean(),
  deliveryFee: z.string().nullable(),
  pickupNotes: z.string().nullable(),
  /** Reviewer's message for `changes_requested` / `rejected`. */
  reviewReason: z.string().nullable(),
  suspensionReason: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  reviewStartedAt: z.iso.datetime().nullable(),
  changesRequestedAt: z.iso.datetime().nullable(),
  approvedAt: z.iso.datetime().nullable(),
  rejectedAt: z.iso.datetime().nullable(),
  deactivatedAt: z.iso.datetime().nullable(),
  suspendedAt: z.iso.datetime().nullable(),
  /** What the provider may change right now. */
  editable: VehicleEditabilitySchema,
  canSubmit: z.boolean(),
  /** Outstanding submission checklist (empty when ready). */
  submissionIssues: z.array(z.object({ field: z.string().optional(), issue: z.string() })),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type Vehicle = z.infer<typeof VehicleSchema>;

export const VehicleSummarySchema = z.object({
  id: z.uuid(),
  status: VehicleStatusSchema,
  slug: z.string().nullable(),
  photoCount: z.number().int().min(0),
  thumbnailUrl: z.url().nullable(),
  categoryId: z.string(),
  locationId: z.uuid().nullable(),
  title: z.string().nullable(),
  make: z.string().nullable(),
  model: z.string().nullable(),
  modelYear: z.number().int().nullable(),
  registrationNumber: z.string().nullable(),
  dailyRate: z.string().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});
export type VehicleSummary = z.infer<typeof VehicleSummarySchema>;
export const VehicleListSchema = z.array(VehicleSummarySchema);

export const VehicleProviderSummarySchema = z.object({
  id: z.uuid(),
  displayName: z.string(),
  status: z.enum(['active', 'suspended']),
  owner: z.object({ id: z.uuid(), email: z.email(), fullName: z.string() }),
});

/** Admin view: provider identity, internal notes, reviewer and the pickup location. */
export const AdminVehicleSchema = VehicleSchema.extend({
  adminNotes: z.string().nullable(),
  reviewedBy: z.uuid().nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  provider: VehicleProviderSummarySchema,
  location: ProviderLocationSchema.nullable(),
});
export type AdminVehicle = z.infer<typeof AdminVehicleSchema>;

export const AdminVehicleSummarySchema = VehicleSummarySchema.extend({
  provider: z.object({ id: z.uuid(), displayName: z.string() }),
});
export type AdminVehicleSummary = z.infer<typeof AdminVehicleSummarySchema>;

export const AdminVehicleListQuerySchema = PaginationQuerySchema.extend({
  status: VehicleStatusSchema.optional(),
  providerId: z.uuid().optional(),
});
export type AdminVehicleListQuery = z.infer<typeof AdminVehicleListQuerySchema>;

export const AdminVehicleListSchema = z.object({
  data: z.array(AdminVehicleSummarySchema),
  nextCursor: z.string().nullable(),
});
export type AdminVehicleList = z.infer<typeof AdminVehicleListSchema>;

// -------------------------------------------------------------- requests

/** Review decisions reuse the provider-review request shapes (reason 5–1000, optional admin notes). */
export const VehicleReviewNotesRequestSchema = z
  .strictObject({ adminNotes: z.string().trim().max(2000).optional() })
  .default({});
export type VehicleReviewNotesRequest = z.infer<typeof VehicleReviewNotesRequestSchema>;

export const VehicleReviewReasonRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(1000),
  adminNotes: z.string().trim().max(2000).optional(),
});
export type VehicleReviewReasonRequest = z.infer<typeof VehicleReviewReasonRequestSchema>;

export const SuspendVehicleRequestSchema = z.strictObject({
  reason: z.string().trim().min(5).max(1000),
});
export type SuspendVehicleRequest = z.infer<typeof SuspendVehicleRequestSchema>;

export const ReactivateVehicleRequestSchema = z
  .strictObject({ note: z.string().trim().max(1000).optional() })
  .default({});
export type ReactivateVehicleRequest = z.infer<typeof ReactivateVehicleRequestSchema>;
