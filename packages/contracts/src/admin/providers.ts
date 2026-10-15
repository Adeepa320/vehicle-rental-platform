import { z } from 'zod';

import { UserStatusSchema } from '../auth/user';
import { DocumentVerificationSchema } from '../documents/document';
import { ProviderMetricsSchema } from '../providers/metrics';
import { AdminProviderDetailBaseSchema } from '../providers/provider';

const Count = z.number().int().min(0);

/** What an operator needs before suspending / reactivating a provider (Phase 9). */
export const AdminProviderOperationsSchema = z.object({
  ownerStatus: UserStatusSchema,
  vehicles: z.object({
    total: Count,
    approved: Count,
    awaitingReview: Count,
    suspended: Count,
    /** Approved listings that currently satisfy the public searchable predicate. */
    searchable: Count,
  }),
  bookings: z.object({
    /** requested / accepted / confirmed / active on this provider's vehicles. */
    open: Count,
    /** confirmed / active bookings that a suspension would NOT cancel but would strand. */
    confirmedOrActive: Count,
    completed: Count,
  }),
  /** Phase 8 trust metrics, same formulas (TECH_DECISIONS D59). */
  metrics: ProviderMetricsSchema,
  documents: DocumentVerificationSchema,
  openDisputes: Count,
});
export type AdminProviderOperations = z.infer<typeof AdminProviderOperationsSchema>;

export const AdminProviderDetailSchema = AdminProviderDetailBaseSchema.extend({
  operations: AdminProviderOperationsSchema,
});
export type AdminProviderDetail = z.infer<typeof AdminProviderDetailSchema>;
