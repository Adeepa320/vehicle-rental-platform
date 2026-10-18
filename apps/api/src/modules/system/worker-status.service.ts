import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { WorkerStatus } from '@vrp/contracts';
import type { Database } from '@vrp/database';
import { sql } from 'drizzle-orm';

import type { Env } from '../../config/env.schema';
import { DATABASE } from '../../database/database.module';

/** The minute schedule that proves the worker is alive. */
export const HEARTBEAT_QUEUE = 'reminders.sweep';
/** Three missed minutes = down. */
export const HEARTBEAT_STALE_SECONDS = 180;

interface ScheduleRow extends Record<string, unknown> {
  name: string;
  cron: string;
  updated_on: Date | string | null;
}

interface QueueRow extends Record<string, unknown> {
  name: string;
  last_completed: Date | string | null;
  completed_24h: number;
  failed_24h: number;
  active: number;
  queued: number;
}

/** Raw rows come back from `db.execute` without Drizzle's column mapping, so timestamps may be strings. */
function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** PostgreSQL `undefined_table`: pg-boss has not created its schema yet (the worker never started). */
const UNDEFINED_TABLE = '42P01';

function isUndefinedTable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === UNDEFINED_TABLE
  );
}

/**
 * Operator view of the job queue (Phase 10, ARCHITECTURE §12): reads the
 * pg-boss tables directly (schedules, per-queue counts over the last 24 hours,
 * last completion) so an administrator can tell whether the worker runs,
 * whether its schedules are registered and whether jobs fail repeatedly —
 * without an unauthenticated endpoint that exposes queue internals.
 */
@Injectable()
export class WorkerStatusService {
  private readonly schema: string;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    config: ConfigService<Env, true>,
  ) {
    // Validated by the env schema as a lowercase SQL identifier, so it is safe to interpolate.
    this.schema = config.get('PGBOSS_SCHEMA', { infer: true });
  }

  async status(now = new Date()): Promise<WorkerStatus> {
    const schema = sql.raw(`"${this.schema}"`);
    let schedules: ScheduleRow[] = [];
    let queues: QueueRow[] = [];
    try {
      schedules = await this.db.execute<ScheduleRow>(
        sql`select name, cron, updated_on from ${schema}.schedule order by name`,
      );
      queues = await this.db.execute<QueueRow>(sql`
      select name,
             max(completed_on) filter (where state = 'completed') as last_completed,
             count(*) filter (where state = 'completed' and completed_on > now() - interval '24 hours')::int as completed_24h,
             count(*) filter (where state = 'failed' and completed_on > now() - interval '24 hours')::int as failed_24h,
             count(*) filter (where state = 'active')::int as active,
             count(*) filter (where state in ('created', 'retry'))::int as queued
      from ${schema}.job
      group by name
      order by name`);
    } catch (error) {
      // No pg-boss schema yet: the worker has never started. Report "down" instead of failing.
      if (!isUndefinedTable(error)) throw error;
    }
    const heartbeat = toDate(queues.find((q) => q.name === HEARTBEAT_QUEUE)?.last_completed);
    const healthy =
      heartbeat !== null && now.getTime() - heartbeat.getTime() <= HEARTBEAT_STALE_SECONDS * 1000;
    return {
      healthy,
      checkedAt: now.toISOString(),
      heartbeatQueue: HEARTBEAT_QUEUE,
      staleAfterSeconds: HEARTBEAT_STALE_SECONDS,
      heartbeatLastCompletedAt: heartbeat?.toISOString() ?? null,
      schedules: schedules.map((s) => ({
        name: s.name,
        cron: s.cron,
        updatedAt: toDate(s.updated_on)?.toISOString() ?? null,
      })),
      queues: queues.map((q) => ({
        name: q.name,
        lastCompletedAt: toDate(q.last_completed)?.toISOString() ?? null,
        completedLast24h: q.completed_24h,
        failedLast24h: q.failed_24h,
        active: q.active,
        queued: q.queued,
      })),
    };
  }
}
