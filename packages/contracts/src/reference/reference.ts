import { z } from 'zod';

/** Slug identifiers used by districts and vehicle categories (`matara`, `car`). */
export const SlugIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,40}$/, 'invalid identifier');

export const DistrictSchema = z.object({
  id: SlugIdSchema,
  name: z.string(),
  province: z.string(),
  /** Providers may only operate from active districts (phased rollout). */
  isActive: z.boolean(),
});
export type District = z.infer<typeof DistrictSchema>;

export const PlaceKindSchema = z.enum(['city', 'town', 'area', 'landmark', 'airport']);

export const PlaceSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  kind: PlaceKindSchema,
  districtId: SlugIdSchema,
  parentId: z.uuid().nullable(),
  isLaunchArea: z.boolean(),
});
export type PlaceSummary = z.infer<typeof PlaceSummarySchema>;

export const PlacesQuerySchema = z.object({
  districtId: SlugIdSchema.optional(),
});
export type PlacesQuery = z.infer<typeof PlacesQuerySchema>;

export const VehicleCategorySchema = z.object({
  id: SlugIdSchema,
  name: z.string(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type VehicleCategory = z.infer<typeof VehicleCategorySchema>;
