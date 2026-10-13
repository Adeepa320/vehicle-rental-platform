import { z } from 'zod';

/**
 * In-app notifications (Phase 8, TECH_DECISIONS D58). Titles and bodies are
 * platform-written plain text; `linkPath` is an application-relative path.
 * Internal metadata (safe ids used for deduplication) is never exposed.
 */
export const NotificationTypeSchema = z.enum([
  'booking.requested',
  'booking.accepted',
  'booking.declined',
  'booking.expired',
  'booking.confirmed',
  'booking.cancelled',
  'booking.picked_up',
  'booking.completed',
  'booking.no_show',
  'payment.reminder',
  'payment.failed',
  'payment.late_success',
  'payment.refund_recorded',
  'pickup.reminder',
  'review.request',
  'review.reminder',
  'review.received',
  'review.replied',
  'review.hidden',
  'review.unhidden',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

export const NOTIFICATION_LINK_MAX = 200;

/**
 * Only application-relative paths are allowed as notification links: a
 * leading slash, no scheme, no protocol-relative `//`, and a conservative
 * character set. Anything else is refused at creation time.
 */
export function isSafeNotificationLink(path: string): boolean {
  if (path.length === 0 || path.length > NOTIFICATION_LINK_MAX) return false;
  if (!path.startsWith('/') || path.startsWith('//')) return false;
  return /^\/[A-Za-z0-9\-_./]*(\?[A-Za-z0-9\-_=&.%]*)?$/.test(path);
}

export const NotificationLinkPathSchema = z
  .string()
  .max(NOTIFICATION_LINK_MAX)
  .refine(isSafeNotificationLink, 'must be an application-relative path');

export const NotificationSchema = z.object({
  id: z.uuid(),
  type: NotificationTypeSchema,
  title: z.string(),
  body: z.string(),
  linkPath: NotificationLinkPathSchema.nullable(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type Notification = z.infer<typeof NotificationSchema>;

const BooleanParam = z.union([
  z.boolean(),
  z.enum(['true', 'false']).transform((value) => value === 'true'),
]);

export const NotificationListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  unreadOnly: BooleanParam.optional(),
});
export type NotificationListQuery = z.infer<typeof NotificationListQuerySchema>;

export const NotificationListSchema = z.object({
  data: z.array(NotificationSchema),
  nextCursor: z.string().nullable(),
});
export type NotificationList = z.infer<typeof NotificationListSchema>;

export const UnreadCountSchema = z.object({ unread: z.number().int().min(0) });
export type UnreadCount = z.infer<typeof UnreadCountSchema>;

export const MarkAllReadResponseSchema = z.object({ marked: z.number().int().min(0) });
export type MarkAllReadResponse = z.infer<typeof MarkAllReadResponseSchema>;
