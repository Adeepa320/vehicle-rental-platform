import { Inject, Injectable } from '@nestjs/common';
import {
  bookingDrivers,
  bookings,
  disputes,
  oneTimeTokens,
  refreshTokens,
  searchLogs,
  verificationDocuments,
  type Database,
} from '@vrp/database';
import { and, eq, inArray, isNotNull, lt, ne, notExists, or, sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import { BookingSettingsService } from '../bookings/booking-settings.service';
import { StorageService } from '../storage/storage.service';

/** Rows handled per statement; the sweep loops until a class is drained or the batch cap is hit. */
export const RETENTION_BATCH_SIZE = 1000;
/** Upper bound of batches per class per run so one sweep can never run away. */
export const RETENTION_MAX_BATCHES = 20;
/** Documents also delete an object each, so their batches are smaller. */
export const DOCUMENT_BATCH_SIZE = 200;
/** Consumed or expired e-mail tokens are kept this long for rate limiting and support questions. */
export const ONE_TIME_TOKEN_GRACE_DAYS = 7;
/** Revoked / expired session records are kept this long after expiry (SECURITY_AND_PRIVACY §8). */
export const REFRESH_TOKEN_GRACE_DAYS = 30;
/** Replacement text written over a purged driver snapshot. */
export const DRIVER_DETAILS_REMOVED = 'Driver details removed';

const TERMINAL_BOOKING_STATUSES = [
  'completed',
  'cancelled_by_customer',
  'cancelled_by_provider',
  'cancelled_by_platform',
  'declined',
  'expired',
  'no_show',
] as const;

export interface RetentionSweepSummary {
  dryRun: boolean;
  now: string;
  settings: {
    documentRetentionRejectedDays: number;
    documentRetentionSupersededDays: number;
    driverSnapshotRetentionDays: number;
    searchLogRetentionDays: number;
  };
  oneTimeTokens: number;
  refreshTokens: number;
  documentsRejected: number;
  documentsSuperseded: number;
  /** Document rows kept because their object could not be deleted this run. */
  documentsSkipped: number;
  searchLogs: number;
  driverSnapshots: number;
  /** True when a class still had candidates after `RETENTION_MAX_BATCHES`. */
  truncated: string[];
}

const daysAgo = (now: Date, days: number): Date => new Date(now.getTime() - days * 86_400_000);

/**
 * Retention sweep (Phase 10, docs/security/DATA_RETENTION.md, TECH_DECISIONS
 * D71). Deletes only what the retention policy allows and the settings
 * configure: expired or consumed e-mail tokens, dead session records,
 * rejected and superseded verification documents (object first, row second,
 * so a failed object delete keeps the row for the next run), old anonymous
 * search logs and — only when enabled — driver snapshots of long-finished
 * bookings without an open dispute. Bookings, payments, reviews, disputes and
 * audit events are never touched. Every statement is bounded; `dryRun`
 * counts without deleting; the run is summarised in the log and audited.
 */
@Injectable()
export class RetentionService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: BookingSettingsService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(RetentionService.name);
  }

  async sweep(
    now = new Date(),
    options: { dryRun?: boolean } = {},
  ): Promise<RetentionSweepSummary> {
    const dryRun = options.dryRun === true;
    const s = await this.settings.get();
    const summary: RetentionSweepSummary = {
      dryRun,
      now: now.toISOString(),
      settings: {
        documentRetentionRejectedDays: s.documentRetentionRejectedDays,
        documentRetentionSupersededDays: s.documentRetentionSupersededDays,
        driverSnapshotRetentionDays: s.driverSnapshotRetentionDays,
        searchLogRetentionDays: s.searchLogRetentionDays,
      },
      oneTimeTokens: 0,
      refreshTokens: 0,
      documentsRejected: 0,
      documentsSuperseded: 0,
      documentsSkipped: 0,
      searchLogs: 0,
      driverSnapshots: 0,
      truncated: [],
    };

    summary.oneTimeTokens = await this.purgeOneTimeTokens(now, dryRun, summary);
    summary.refreshTokens = await this.purgeRefreshTokens(now, dryRun, summary);
    const documents = await this.purgeDocuments(now, s, dryRun, summary);
    summary.documentsRejected = documents.rejected;
    summary.documentsSuperseded = documents.superseded;
    summary.documentsSkipped = documents.skipped;
    summary.searchLogs = await this.purgeSearchLogs(now, s.searchLogRetentionDays, dryRun, summary);
    summary.driverSnapshots = await this.purgeDriverSnapshots(
      now,
      s.driverSnapshotRetentionDays,
      dryRun,
      summary,
    );

    const total =
      summary.oneTimeTokens +
      summary.refreshTokens +
      summary.documentsRejected +
      summary.documentsSuperseded +
      summary.searchLogs +
      summary.driverSnapshots;
    this.logger.info({ ...summary }, dryRun ? 'Retention preview' : 'Retention sweep');
    if (!dryRun && total > 0) {
      await this.audit.record({
        actorType: 'system',
        action: 'retention.sweep_completed',
        targetType: 'system',
        metadata: { ...summary },
      });
    }
    return summary;
  }

  // ---------------------------------------------------------------- classes

  private async purgeOneTimeTokens(
    now: Date,
    dryRun: boolean,
    summary: RetentionSweepSummary,
  ): Promise<number> {
    const cutoff = daysAgo(now, ONE_TIME_TOKEN_GRACE_DAYS);
    const where = and(
      or(isNotNull(oneTimeTokens.consumedAt), lt(oneTimeTokens.expiresAt, now)),
      lt(oneTimeTokens.createdAt, cutoff),
    );
    return this.drain('oneTimeTokens', RETENTION_BATCH_SIZE, dryRun, summary, async () => {
      const ids = await this.db
        .select({ id: oneTimeTokens.id })
        .from(oneTimeTokens)
        .where(where)
        .limit(RETENTION_BATCH_SIZE);
      if (dryRun || ids.length === 0) return ids.length;
      const deleted = await this.db
        .delete(oneTimeTokens)
        .where(
          inArray(
            oneTimeTokens.id,
            ids.map((r) => r.id),
          ),
        )
        .returning({ id: oneTimeTokens.id });
      return deleted.length;
    });
  }

  private async purgeRefreshTokens(
    now: Date,
    dryRun: boolean,
    summary: RetentionSweepSummary,
  ): Promise<number> {
    const cutoff = daysAgo(now, REFRESH_TOKEN_GRACE_DAYS);
    const where = and(
      or(isNotNull(refreshTokens.revokedAt), lt(refreshTokens.expiresAt, now)),
      lt(refreshTokens.expiresAt, cutoff),
    );
    return this.drain('refreshTokens', RETENTION_BATCH_SIZE, dryRun, summary, async () => {
      const ids = await this.db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(where)
        .limit(RETENTION_BATCH_SIZE);
      if (dryRun || ids.length === 0) return ids.length;
      // Rotation chains reference each other; clear the links inside the batch before deleting.
      const idList = ids.map((r) => r.id);
      await this.db
        .update(refreshTokens)
        .set({ replacedById: null })
        .where(inArray(refreshTokens.replacedById, idList));
      const deleted = await this.db
        .delete(refreshTokens)
        .where(inArray(refreshTokens.id, idList))
        .returning({ id: refreshTokens.id });
      return deleted.length;
    });
  }

  private async purgeDocuments(
    now: Date,
    settings: {
      documentRetentionRejectedDays: number;
      documentRetentionSupersededDays: number;
    },
    dryRun: boolean,
    summary: RetentionSweepSummary,
  ): Promise<{ rejected: number; superseded: number; skipped: number }> {
    const result = { rejected: 0, superseded: 0, skipped: 0 };
    const classes: Array<{
      key: 'rejected' | 'superseded';
      days: number;
      where: ReturnType<typeof and>;
    }> = [
      {
        key: 'rejected',
        days: settings.documentRetentionRejectedDays,
        where: and(
          eq(verificationDocuments.status, 'rejected'),
          sql`coalesce(${verificationDocuments.reviewedAt}, ${verificationDocuments.updatedAt}) < ${daysAgo(now, settings.documentRetentionRejectedDays).toISOString()}::timestamptz`,
        ),
      },
      {
        key: 'superseded',
        days: settings.documentRetentionSupersededDays,
        where: and(
          isNotNull(verificationDocuments.supersededAt),
          lt(
            verificationDocuments.supersededAt,
            daysAgo(now, settings.documentRetentionSupersededDays),
          ),
        ),
      },
    ];
    for (const cls of classes) {
      if (cls.days <= 0) continue; // 0 disables the class
      result[cls.key] = await this.drain(
        `documents.${cls.key}`,
        DOCUMENT_BATCH_SIZE,
        dryRun,
        summary,
        async () => {
          const rows = await this.db
            .select({ id: verificationDocuments.id, storageKey: verificationDocuments.storageKey })
            .from(verificationDocuments)
            .where(cls.where)
            .limit(DOCUMENT_BATCH_SIZE);
          if (dryRun || rows.length === 0) return rows.length;
          let deleted = 0;
          for (const row of rows) {
            try {
              await this.storage.delete('private', [row.storageKey]);
            } catch (error) {
              result.skipped += 1;
              this.logger.warn(
                {
                  documentId: row.id,
                  error: error instanceof Error ? error.message : String(error),
                },
                'Retention: object delete failed; row kept for the next run',
              );
              continue;
            }
            const gone = await this.db
              .delete(verificationDocuments)
              .where(eq(verificationDocuments.id, row.id))
              .returning({ id: verificationDocuments.id });
            deleted += gone.length;
          }
          // Skipped rows would be selected again immediately; stop this class for the run.
          return deleted === rows.length ? deleted : -deleted;
        },
      );
    }
    return result;
  }

  private async purgeSearchLogs(
    now: Date,
    days: number,
    dryRun: boolean,
    summary: RetentionSweepSummary,
  ): Promise<number> {
    if (days <= 0) return 0;
    const cutoff = daysAgo(now, days);
    return this.drain('searchLogs', RETENTION_BATCH_SIZE, dryRun, summary, async () => {
      const ids = await this.db
        .select({ id: searchLogs.id })
        .from(searchLogs)
        .where(lt(searchLogs.createdAt, cutoff))
        .limit(RETENTION_BATCH_SIZE);
      if (dryRun || ids.length === 0) return ids.length;
      const deleted = await this.db
        .delete(searchLogs)
        .where(
          inArray(
            searchLogs.id,
            ids.map((r) => r.id),
          ),
        )
        .returning({ id: searchLogs.id });
      return deleted.length;
    });
  }

  /**
   * Driver snapshots of bookings finished more than `days` ago, unless the
   * booking has an open dispute (evidence): the driver's name is replaced; the
   * licence country and expiry (not identifying on their own, NOT NULL in the
   * schema) stay. Disabled while `days` is 0 (the retention period is pending
   * legal review, DATA_RETENTION.md).
   */
  private async purgeDriverSnapshots(
    now: Date,
    days: number,
    dryRun: boolean,
    summary: RetentionSweepSummary,
  ): Promise<number> {
    if (days <= 0) return 0;
    const cutoff = daysAgo(now, days);
    const finishedAt = sql`coalesce(${bookings.completedAt}, ${bookings.cancelledAt}, ${bookings.expiredAt}, ${bookings.noShowAt}, ${bookings.declinedAt}, ${bookings.endsAt})`;
    return this.drain('driverSnapshots', RETENTION_BATCH_SIZE, dryRun, summary, async () => {
      const rows = await this.db
        .select({ id: bookingDrivers.id })
        .from(bookingDrivers)
        .innerJoin(bookings, eq(bookings.id, bookingDrivers.bookingId))
        .where(
          and(
            ne(bookingDrivers.fullName, DRIVER_DETAILS_REMOVED),
            inArray(bookings.status, [...TERMINAL_BOOKING_STATUSES]),
            sql`${finishedAt} < ${cutoff.toISOString()}::timestamptz`,
            notExists(
              this.db
                .select({ one: sql`1` })
                .from(disputes)
                .where(
                  and(
                    eq(disputes.bookingId, bookings.id),
                    inArray(disputes.status, ['open', 'in_review']),
                  ),
                ),
            ),
          ),
        )
        .limit(RETENTION_BATCH_SIZE);
      if (dryRun || rows.length === 0) return rows.length;
      const updated = await this.db
        .update(bookingDrivers)
        .set({ fullName: DRIVER_DETAILS_REMOVED })
        .where(
          inArray(
            bookingDrivers.id,
            rows.map((r) => r.id),
          ),
        )
        .returning({ id: bookingDrivers.id });
      return updated.length;
    });
  }

  /**
   * Runs `batch` until it returns fewer rows than a full batch, a negative
   * count (stop early) or the batch cap is reached. In dry-run mode a single
   * count is taken (the first batch) and extrapolation is not attempted.
   */
  private async drain(
    name: string,
    batchSize: number,
    dryRun: boolean,
    summary: RetentionSweepSummary,
    batch: () => Promise<number>,
  ): Promise<number> {
    let total = 0;
    for (let i = 0; i < RETENTION_MAX_BATCHES; i += 1) {
      const count = await batch();
      if (count < 0) {
        total += -count;
        return total;
      }
      total += count;
      if (dryRun || count < batchSize) return total;
      if (i === RETENTION_MAX_BATCHES - 1) summary.truncated.push(name);
    }
    return total;
  }
}
