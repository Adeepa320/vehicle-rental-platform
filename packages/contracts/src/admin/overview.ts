import { z } from 'zod';

/**
 * Operations home (Phase 9): counts of things that need a human, each with
 * the console path that opens the filtered queue. No customer PII.
 */
export const AdminOverviewItemSchema = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().min(0),
  /** Application-relative path of the queue. */
  linkPath: z.string(),
  /** `attention` items are rendered prominently when non-zero. */
  tone: z.enum(['attention', 'info']),
});
export type AdminOverviewItem = z.infer<typeof AdminOverviewItemSchema>;

export const AdminOverviewSchema = z.object({
  items: z.array(AdminOverviewItemSchema),
  generatedAt: z.iso.datetime(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;
