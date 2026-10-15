import { Inject, Injectable } from '@nestjs/common';
import {
  AuditActorTypeSchema,
  type AuditEventList,
  type AuditEventListQuery,
  type AuditEventView,
} from '@vrp/contracts';
import { auditEvents, users, type AuditEvent, type Database } from '@vrp/database';
import { and, desc, eq, gte, like, lt, lte, or } from 'drizzle-orm';

import { decodeCursor, paginate } from '../../common/pagination';
import { DATABASE } from '../../database/database.module';

/** Metadata keys that must never reach a browser, whatever a future writer puts in. */
const SECRET_KEY = /secret|token|hash|sig|password|card|cookie|authorization/i;

export function scrubAuditMetadata(
  metadata: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (!metadata) return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY.test(key)) continue;
    out[key] =
      value && typeof value === 'object' && !Array.isArray(value)
        ? scrubAuditMetadata(value as Record<string, unknown>)
        : value;
  }
  return out;
}

/** Read-only audit trail viewer (Phase 9). Rows are immutable; only a projection leaves. */
@Injectable()
export class AdminAuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(query: AuditEventListQuery): Promise<AuditEventList> {
    const cursor = decodeCursor(query.cursor);
    const rows = await this.db
      .select({
        event: auditEvents,
        actor: { id: users.id, email: users.email, fullName: users.fullName },
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(
        and(
          query.actorUserId ? eq(auditEvents.actorUserId, query.actorUserId) : undefined,
          query.action
            ? query.action.endsWith('.')
              ? like(auditEvents.action, `${query.action}%`)
              : eq(auditEvents.action, query.action)
            : undefined,
          query.targetType ? eq(auditEvents.targetType, query.targetType) : undefined,
          query.targetId ? eq(auditEvents.targetId, query.targetId) : undefined,
          query.from ? gte(auditEvents.createdAt, new Date(query.from)) : undefined,
          query.to ? lte(auditEvents.createdAt, new Date(query.to)) : undefined,
          cursor
            ? or(
                lt(auditEvents.createdAt, cursor.createdAt),
                and(eq(auditEvents.createdAt, cursor.createdAt), lt(auditEvents.id, cursor.id)),
              )
            : undefined,
        ),
      )
      .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
      .limit(query.limit + 1);
    const page = paginate(
      rows.map((r) => ({ ...r, createdAt: r.event.createdAt, id: r.event.id })),
      query.limit,
    );
    return {
      data: page.data.map((r) => this.toView(r.event, r.actor)),
      nextCursor: page.nextCursor,
    };
  }

  private toView(
    row: AuditEvent,
    actor: { id: string; email: string; fullName: string } | null,
  ): AuditEventView {
    const actorType = AuditActorTypeSchema.safeParse(row.actorType);
    return {
      id: row.id,
      actorType: actorType.success ? actorType.data : 'system',
      actor:
        actor && actor.id ? { id: actor.id, email: actor.email, fullName: actor.fullName } : null,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      reason: row.reason,
      metadata: scrubAuditMetadata(row.metadata),
      createdAt: row.createdAt.toISOString(),
    };
  }
}
