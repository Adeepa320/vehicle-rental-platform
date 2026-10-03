import { z } from 'zod';

/**
 * Vehicle listing photos (TECH_DECISIONS D43). Providers upload originals
 * through the API; the API validates the real image format, strips metadata
 * and stores WebP variants in the public bucket. Only variants are ever
 * exposed; originals stay in the private bucket.
 */
export const MIN_VEHICLE_PHOTOS = 3;
export const MAX_VEHICLE_PHOTOS = 12;
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const MIN_PHOTO_WIDTH = 320;
export const MIN_PHOTO_HEIGHT = 240;
/** Formats accepted after sniffing the bytes (never by extension or declared MIME type). */
export const ACCEPTED_PHOTO_FORMATS = ['jpeg', 'png', 'webp'] as const;
export type AcceptedPhotoFormat = (typeof ACCEPTED_PHOTO_FORMATS)[number];

/** Longest-side pixel size of each generated WebP variant. */
export const PHOTO_VARIANTS = { thumb: 400, medium: 1000, large: 1600 } as const;
export type PhotoVariant = keyof typeof PHOTO_VARIANTS;

export const PhotoVariantUrlsSchema = z.object({
  thumb: z.url(),
  medium: z.url(),
  large: z.url(),
});
export type PhotoVariantUrls = z.infer<typeof PhotoVariantUrlsSchema>;

export const VehiclePhotoSchema = z.object({
  id: z.uuid(),
  /** 0 = primary. */
  sortOrder: z.number().int().min(0),
  isPrimary: z.boolean(),
  /** Pixel size of the stored original (after orientation is applied). */
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  variants: PhotoVariantUrlsSchema,
  createdAt: z.iso.datetime(),
});
export type VehiclePhoto = z.infer<typeof VehiclePhotoSchema>;
export const VehiclePhotoListSchema = z.array(VehiclePhotoSchema);

/** `PATCH /providers/me/vehicles/{id}/photos/order`: every active photo id, in display order. */
export const ReorderVehiclePhotosRequestSchema = z
  .strictObject({ photoIds: z.array(z.uuid()).min(1).max(MAX_VEHICLE_PHOTOS) })
  .refine((v) => new Set(v.photoIds).size === v.photoIds.length, {
    path: ['photoIds'],
    message: 'photo ids must be unique',
  });
export type ReorderVehiclePhotosRequest = z.infer<typeof ReorderVehiclePhotosRequestSchema>;
