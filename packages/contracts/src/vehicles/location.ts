import { z } from 'zod';

import { SlugIdSchema } from '../reference/reference';

/**
 * Sri Lanka bounding box (API_DESIGN §6). Coordinates are optional in Phase 4:
 * providers pick a district and a gazetteer place; a pin can be typed in or
 * chosen on a free map later. No geocoding or paid map API is involved.
 */
export const SRI_LANKA_BOUNDS = { minLat: 5.7, maxLat: 10.0, minLng: 79.5, maxLng: 82.0 } as const;

export const GeoPointSchema = z.object({
  lat: z.number().min(SRI_LANKA_BOUNDS.minLat).max(SRI_LANKA_BOUNDS.maxLat),
  lng: z.number().min(SRI_LANKA_BOUNDS.minLng).max(SRI_LANKA_BOUNDS.maxLng),
});
export type GeoPoint = z.infer<typeof GeoPointSchema>;

const LocationNameSchema = z.string().trim().min(2).max(80);
const AddressTextSchema = z.string().trim().min(5).max(300);
const InstructionsSchema = z.string().trim().max(1000);

/** `POST /providers/me/locations`. */
export const CreateProviderLocationRequestSchema = z.strictObject({
  name: LocationNameSchema,
  districtId: SlugIdSchema,
  placeId: z.uuid(),
  addressText: AddressTextSchema,
  point: GeoPointSchema.nullable().optional(),
  pickupInstructions: InstructionsSchema.nullable().optional(),
  /** The first location of a provider becomes primary automatically. */
  isPrimary: z.boolean().optional(),
});
export type CreateProviderLocationRequest = z.infer<typeof CreateProviderLocationRequestSchema>;

/**
 * `PATCH /providers/me/locations/{id}`. `isPrimary: true` moves the primary
 * flag; `isPrimary: false` is rejected by the service (choose another primary
 * instead). `isActive: false` deactivates (refused while vehicles use the
 * location); `isActive: true` reactivates.
 */
export const UpdateProviderLocationRequestSchema = z.strictObject({
  name: LocationNameSchema.optional(),
  districtId: SlugIdSchema.optional(),
  placeId: z.uuid().optional(),
  addressText: AddressTextSchema.optional(),
  point: GeoPointSchema.nullable().optional(),
  pickupInstructions: InstructionsSchema.nullable().optional(),
  isPrimary: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateProviderLocationRequest = z.infer<typeof UpdateProviderLocationRequestSchema>;

/** Provider/admin view. Coordinates are precise here; public views (later) round them. */
export const ProviderLocationSchema = z.object({
  id: z.uuid(),
  providerId: z.uuid(),
  name: z.string(),
  districtId: z.string(),
  placeId: z.uuid(),
  addressText: z.string(),
  point: GeoPointSchema.nullable(),
  pickupInstructions: z.string().nullable(),
  isPrimary: z.boolean(),
  isActive: z.boolean(),
  /** Vehicles (not rejected) currently attached to this location. */
  vehicleCount: z.number().int().min(0),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ProviderLocation = z.infer<typeof ProviderLocationSchema>;

export const ProviderLocationListSchema = z.array(ProviderLocationSchema);
