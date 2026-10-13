import { Inject, Injectable } from '@nestjs/common';
import {
  isSafeNotificationLink,
  type MarkAllReadResponse,
  type Notification,
  type NotificationList,
  type NotificationListQuery,
  type NotificationType,
  type UnreadCount,
} from '@vrp/contracts';
import {
  notifications,
  type Database,
  type DatabaseExecutor,
  type NotificationRow,
} from '@vrp/database';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../../common/errors/api.exception';
import { decodeCursor, paginate } from '../../../common/pagination';
import { DATABASE } from '../../../database/database.module';
import { toNotification } from './notification.mappers';

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  /** Platform-written plain text (user-supplied strings are never interpolated raw into HTML; the UI renders text). */
  title: string;
  body: string;
  /** Application-relative path, validated; never an absolute URL. */
  linkPath?: string | null;
  /** Safe ids only (booking / review ids). Payment, gateway and contact identifiers are refused. */
  metadata?: Record<string, unknown>;
  /** Unique per event and recipient; a second insert with the same key is a silent no-op. */
  dedupeKey?: string;
}

const TITLE_MAX = 200;
const BODY_MAX = 1000;
/** Defensive guard so no caller can ever put payment or contact material into the feed. */
const FORBIDDEN_METADATA_KEYS = /payment|gateway|order|hash|sig|secret|token|email|phone|card/i;

/**
 * Persistent in-app notification feed (TECH_DECISIONS D58). Rows are written
 * inside the transaction of the business change they describe, next to the
 * e-mail job, so a notification exists if and only if the change committed.
 * The unique partial index on `dedupe_key` makes retries and reminder sweeps
 * idempotent at the database level.
 */
@Injectable()
export class NotificationsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(NotificationsService.name);
  }

  /** Inserts one notification; returns null when the dedupe key already exists. */
  async create(
    executor: DatabaseExecutor,
    input: CreateNotificationInput,
  ): Promise<NotificationRow | null> {
    if (input.linkPath && !isSafeNotificationLink(input.linkPath)) {
      throw new Error(`Refusing unsafe notification link: ${input.linkPath}`);
    }
    for (const key of Object.keys(input.metadata ?? {})) {
      if (FORBIDDEN_METADATA_KEYS.test(key)) {
        throw new Error(`Refusing notification metadata key "${key}"`);
      }
    }
    const [row] = await executor
      .insert(notifications)
      .values({
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, TITLE_MAX),
        body: input.body.slice(0, BODY_MAX),
        linkPath: input.linkPath ?? null,
        metadata: input.metadata ?? null,
        dedupeKey: input.dedupeKey ?? null,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) {
      this.logger.debug(
        { type: input.type, dedupeKey: input.dedupeKey },
        'Notification deduplicated',
      );
      return null;
    }
    return row;
  }

  async list(userId: string, query: NotificationListQuery): Promise<NotificationList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          query.unreadOnly ? isNull(notifications.readAt) : undefined,
          cursor
            ? or(
                lt(notifications.createdAt, cursor.createdAt),
                and(eq(notifications.createdAt, cursor.createdAt), lt(notifications.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(query.limit + 1);
    const page = paginate(rows, query.limit);
    return { data: page.data.map(toNotification), nextCursor: page.nextCursor };
  }

  async unreadCount(userId: string): Promise<UnreadCount> {
    const [row] = await this.db
      .select({ unread: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return { unread: row?.unread ?? 0 };
  }

  /** Marks one of the caller's notifications read; idempotent; another user's id is 404. */
  async markRead(userId: string, id: string, now = new Date()): Promise<Notification> {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: sql`coalesce(${notifications.readAt}, ${now.toISOString()}::timestamptz)` })
      .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
      .returning();
    if (!row) throw new ApiException('NOT_FOUND', 'Notification not found', 404);
    return toNotification(row);
  }

  async markAllRead(userId: string, now = new Date()): Promise<MarkAllReadResponse> {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: now })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { marked: rows.length };
  }
}
