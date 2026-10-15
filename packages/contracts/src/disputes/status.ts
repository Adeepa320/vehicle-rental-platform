import { z } from 'zod';

/** Dispute lifecycle (Phase 9). Kept import-free so booking views can reference it. */
export const DisputeStatusSchema = z.enum(['open', 'in_review', 'resolved', 'rejected']);
export type DisputeStatus = z.infer<typeof DisputeStatusSchema>;

/** Statuses in which participants may still post and admins may still decide. */
export const OPEN_DISPUTE_STATUSES: readonly DisputeStatus[] = ['open', 'in_review'];
