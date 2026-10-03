import { Inject, Injectable } from '@nestjs/common';
import { auditEvents, type AuditEvent, type Database, type DatabaseExecutor } from '@vrp/database';
import { and, desc, eq } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module';

export type AuditActorType = 'admin' | 'provider' | 'customer' | 'system';

export interface AuditInput {
  actorUserId?: string | null;
  actorType: AuditActorType;
  /** Dotted verb, e.g. `provider_application.approved`. */
  action: string;
  targetType: string;
  targetId?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
}

/** Append-only audit trail. Pass the open transaction so the event commits with the action. */
@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async record(input: AuditInput, executor: DatabaseExecutor = this.db): Promise<void> {
    await executor.insert(auditEvents).values({
      actorUserId: input.actorUserId ?? null,
      actorType: input.actorType,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? null,
      ip: input.ip ?? null,
    });
  }

  async listForTarget(targetType: string, targetId: string, limit = 50): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, targetType), eq(auditEvents.targetId, targetId)))
      .orderBy(desc(auditEvents.createdAt))
      .limit(limit);
  }
}
