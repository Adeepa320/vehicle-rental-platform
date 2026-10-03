import { z } from 'zod';

import { VehicleStatusSchema } from './vehicle';

/**
 * Availability in Phase 4 is "approved unless blocked" (TECH_DECISIONS D40):
 * providers add manual blocks; bookings add holds in a later phase. Both are
 * rows of `vehicle_holds` with a half-open period `[startsAt, endsAt)`; the
 * database forbids overlapping holds per vehicle (exclusion constraint).
 */
export const BlockReasonSchema = z.enum([
  'maintenance',
  'provider_unavailable',
  'rented_offline',
  'reserved_offline',
  'other',
]);
export type BlockReason = z.infer<typeof BlockReasonSchema>;

export const HoldKindSchema = z.enum(['booking', 'block']);
export type HoldKind = z.infer<typeof HoldKindSchema>;

export const MAX_BLOCK_DAYS = 366;
export const MAX_AVAILABILITY_QUERY_DAYS = 400;

const Instant = z.iso.datetime({ offset: true });
const DAY_MS = 86_400_000;

export const CreateAvailabilityBlockRequestSchema = z
  .strictObject({
    startsAt: Instant,
    endsAt: Instant,
    reason: BlockReasonSchema,
    note: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    const start = Date.parse(v.startsAt);
    const end = Date.parse(v.endsAt);
    if (!(end > start)) {
      ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'end must be after start' });
    } else if (end - start > MAX_BLOCK_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: `a block cannot be longer than ${MAX_BLOCK_DAYS} days`,
      });
    }
  });
export type CreateAvailabilityBlockRequest = z.infer<typeof CreateAvailabilityBlockRequestSchema>;

export const VehicleHoldSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  kind: HoldKindSchema,
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  /** Set for manual blocks; null for booking holds (later phase). */
  reason: BlockReasonSchema.nullable(),
  note: z.string().nullable(),
  createdBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type VehicleHold = z.infer<typeof VehicleHoldSchema>;
export const VehicleHoldListSchema = z.array(VehicleHoldSchema);

export const AvailabilityRangeQuerySchema = z
  .object({ from: Instant, to: Instant })
  .superRefine((v, ctx) => {
    const from = Date.parse(v.from);
    const to = Date.parse(v.to);
    if (!(to > from)) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'to must be after from' });
    } else if (to - from > MAX_AVAILABILITY_QUERY_DAYS * DAY_MS) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: `range cannot exceed ${MAX_AVAILABILITY_QUERY_DAYS} days`,
      });
    }
  });
export type AvailabilityRangeQuery = z.infer<typeof AvailabilityRangeQuerySchema>;

/** Optional window for listing blocks; defaults to "current and upcoming". */
export const HoldListQuerySchema = z.object({
  from: Instant.optional(),
  to: Instant.optional(),
});
export type HoldListQuery = z.infer<typeof HoldListQuerySchema>;

export const VehicleAvailabilitySchema = z.object({
  vehicleId: z.uuid(),
  status: VehicleStatusSchema,
  /** Only `approved` vehicles can ever be available. */
  bookable: z.boolean(),
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  /** `bookable` and no hold overlaps the window. */
  available: z.boolean(),
  /** Holds overlapping the window (empty when available). */
  holds: z.array(VehicleHoldSchema),
});
export type VehicleAvailability = z.infer<typeof VehicleAvailabilitySchema>;
