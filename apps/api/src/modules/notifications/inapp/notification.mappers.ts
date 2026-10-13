import { NotificationTypeSchema, type Notification } from '@vrp/contracts';
import type { NotificationRow } from '@vrp/database';

/**
 * Allow-list projection of a notification row. `metadata` and `dedupeKey` are
 * internal (deduplication, safe ids) and never leave the API.
 */
export function toNotification(row: NotificationRow): Notification {
  const type = NotificationTypeSchema.safeParse(row.type);
  return {
    id: row.id,
    type: type.success ? type.data : 'booking.requested',
    title: row.title,
    body: row.body,
    linkPath: row.linkPath,
    readAt: row.readAt ? row.readAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}
