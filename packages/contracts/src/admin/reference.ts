import { z } from 'zod';

import { PlaceKindSchema, SlugIdSchema } from '../reference/reference';

/**
 * Reference-data administration (Phase 9, super admin). Districts and
 * categories are seeded; the admin changes their operational flags and
 * display metadata. Places can be created and edited. Nothing is ever hard
 * deleted: rows referenced by locations, vehicles and bookings are
 * deactivated instead.
 */
export const AdminDistrictSchema = z.object({
  id: SlugIdSchema,
  name: z.string(),
  province: z.string(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  placeCount: z.number().int().min(0),
  providerCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type AdminDistrict = z.infer<typeof AdminDistrictSchema>;

export const UpdateDistrictRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(60).optional(),
    province: z.string().trim().min(2).max(60).optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type UpdateDistrictRequest = z.infer<typeof UpdateDistrictRequestSchema>;

export const PlaceSlugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}$/, 'lower-case letters, digits and hyphens only');

export const LatitudeSchema = z.number().min(-90).max(90);
export const LongitudeSchema = z.number().min(-180).max(180);

export const AdminPlaceSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: PlaceKindSchema,
  districtId: SlugIdSchema,
  parentId: z.uuid().nullable(),
  aliases: z.array(z.string()),
  /** Town centre used for radius search; places are public reference points, not provider pins. */
  centre: z.object({ lat: LatitudeSchema, lng: LongitudeSchema }),
  defaultRadiusKm: z.number(),
  isLaunchArea: z.boolean(),
  searchRank: z.number().int(),
  isActive: z.boolean(),
  locationCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type AdminPlace = z.infer<typeof AdminPlaceSchema>;

export const AdminPlaceListQuerySchema = z.object({
  districtId: SlugIdSchema.optional(),
  q: z.string().trim().min(1).max(60).optional(),
  includeInactive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type AdminPlaceListQuery = z.infer<typeof AdminPlaceListQuerySchema>;

export const CreatePlaceRequestSchema = z.strictObject({
  slug: PlaceSlugSchema,
  name: z.string().trim().min(2).max(80),
  kind: PlaceKindSchema,
  districtId: SlugIdSchema,
  parentId: z.uuid().nullable().optional(),
  aliases: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  centre: z.object({ lat: LatitudeSchema, lng: LongitudeSchema }),
  defaultRadiusKm: z.number().min(1).max(100).optional(),
  isLaunchArea: z.boolean().optional(),
  searchRank: z.number().int().min(0).max(1000).optional(),
});
export type CreatePlaceRequest = z.infer<typeof CreatePlaceRequestSchema>;

export const UpdatePlaceRequestSchema = CreatePlaceRequestSchema.partial()
  .extend({ isActive: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type UpdatePlaceRequest = z.infer<typeof UpdatePlaceRequestSchema>;

export const AdminVehicleCategorySchema = z.object({
  id: SlugIdSchema,
  name: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  requiresLicenceClass: z.string().nullable(),
  isActive: z.boolean(),
  /** Why activation is refused for this category, when it is protected. */
  activationBlockedReason: z.string().nullable(),
  vehicleCount: z.number().int().min(0),
  updatedAt: z.iso.datetime(),
});
export type AdminVehicleCategory = z.infer<typeof AdminVehicleCategorySchema>;

export const UpdateVehicleCategoryRequestSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(40).optional(),
    icon: z.string().trim().max(40).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1000).optional(),
    requiresLicenceClass: z.string().trim().max(40).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'nothing to change');
export type UpdateVehicleCategoryRequest = z.infer<typeof UpdateVehicleCategoryRequestSchema>;

/**
 * Categories whose launch depends on the open business / legal decision on
 * three-wheeler and scooter rentals to foreigners (PRODUCT_BRIEF §11,
 * MVP_SCOPE "decision-dependent items"). They stay inactive until that
 * decision is recorded; the admin API refuses to activate them.
 */
export const PROTECTED_INACTIVE_CATEGORY_IDS: readonly string[] = ['scooter', 'tuktuk'];
export const PROTECTED_CATEGORY_REASON =
  'Pending the product / legal decision on scooter and three-wheeler rentals (PRODUCT_BRIEF §11). Record the decision in TECH_DECISIONS before activating.';
