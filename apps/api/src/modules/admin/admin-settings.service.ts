import { Inject, Injectable } from '@nestjs/common';
import {
  COUPLED_MONEY_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  type AdminSetting,
  type AdminSettingsResponse,
  type SettingKey,
  type UpdateSettingsRequest,
} from '@vrp/contracts';
import { platformSettings, type Database } from '@vrp/database';
import { eq } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';

import { ApiException } from '../../common/errors/api.exception';
import { DATABASE } from '../../database/database.module';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, RequestMeta } from '../auth/auth.types';
import { BookingSettingsService } from '../bookings/booking-settings.service';

/** Settings shown read-only next to the editable ones (informational; not enforced by code yet). */
const READ_ONLY_KEYS = ['currency', 'vehicle_review_required'] as const;

/**
 * Typed platform-settings administration (Phase 9, TECH_DECISIONS D63).
 * Reads are open to admins; writes are super-admin only (controller), go
 * through the allow-list in `SETTING_DEFINITIONS`, are validated per key,
 * refuse stale tokens (`409 SETTING_STALE`), keep the money pair equal
 * (`409 SETTING_MONEY_MODEL_UNSUPPORTED`) and write one audit row per key
 * with the old and the new value. Changes apply to new decisions only:
 * booking snapshots are never recomputed.
 */
@Injectable()
export class AdminSettingsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly bookingSettings: BookingSettingsService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AdminSettingsService.name);
  }

  async list(): Promise<AdminSettingsResponse> {
    const rows = await this.db.select().from(platformSettings);
    const byKey = new Map(rows.map((r) => [r.key, r]));
    const data: AdminSetting[] = [];
    for (const key of SETTING_KEYS) {
      const row = byKey.get(key);
      if (!row) continue; // not seeded yet: `pnpm db:seed` inserts it
      const definition = SETTING_DEFINITIONS[key];
      data.push({
        key,
        group: definition.group,
        label: definition.label,
        description: definition.description,
        hint: definition.hint,
        highImpact: definition.highImpact,
        value: row.value,
        updatedAt: row.updatedAt.toISOString(),
        updatedBy: row.updatedBy,
      });
    }
    return {
      data,
      readOnly: READ_ONLY_KEYS.flatMap((key) => {
        const row = byKey.get(key);
        return row ? [{ key, value: row.value, description: row.description }] : [];
      }),
    };
  }

  async update(
    admin: AuthenticatedUser,
    input: UpdateSettingsRequest,
    meta: RequestMeta,
    now = new Date(),
  ): Promise<AdminSettingsResponse> {
    const highImpact = input.changes.filter((c) => SETTING_DEFINITIONS[c.key].highImpact);
    if (highImpact.length > 0 && !input.reason) {
      throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
        {
          field: 'reason',
          issue: `a reason is required when changing ${highImpact.map((c) => c.key).join(', ')}`,
        },
      ]);
    }
    const validated = input.changes.map((change) => {
      const parsed = SETTING_DEFINITIONS[change.key].schema.safeParse(change.value);
      if (!parsed.success) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          {
            field: `changes.${change.key}`,
            issue: parsed.error.issues.map((i) => i.message).join('; ') || 'invalid value',
          },
        ]);
      }
      return { ...change, value: parsed.data as unknown };
    });

    await this.db.transaction(async (tx) => {
      for (const change of validated) {
        const [row] = await tx
          .select()
          .from(platformSettings)
          .where(eq(platformSettings.key, change.key))
          .for('update');
        if (!row) {
          throw new ApiException(
            'NOT_FOUND',
            `Setting ${change.key} is not seeded yet; run the database seed first`,
            404,
          );
        }
        if (row.updatedAt.toISOString() !== new Date(change.expectedUpdatedAt).toISOString()) {
          throw new ApiException(
            'SETTING_STALE',
            `${change.key} was changed by someone else at ${row.updatedAt.toISOString()}; reload and try again`,
            409,
            [{ field: `changes.${change.key}`, issue: 'stale expectedUpdatedAt' }],
          );
        }
        await tx
          .update(platformSettings)
          .set({ value: change.value, updatedBy: admin.id, updatedAt: now })
          .where(eq(platformSettings.key, change.key));
        await this.audit.record(
          {
            actorUserId: admin.id,
            actorType: 'admin',
            action: 'setting.updated',
            targetType: 'platform_setting',
            targetId: null,
            reason: input.reason ?? null,
            ip: meta.ip ?? null,
            metadata: { key: change.key, before: row.value, after: change.value },
          },
          tx,
        );
      }
      // Invariants over the resulting state (the transaction rolls back when violated).
      const current = new Map(
        (
          await tx
            .select({ key: platformSettings.key, value: platformSettings.value })
            .from(platformSettings)
        ).map((r) => [r.key as SettingKey, r.value]),
      );
      const [commissionKey, advanceKey] = COUPLED_MONEY_SETTING_KEYS as [SettingKey, SettingKey];
      const commission = Number(current.get(commissionKey));
      const advance = Number(current.get(advanceKey));
      if (Number.isFinite(commission) && Number.isFinite(advance) && commission !== advance) {
        throw new ApiException(
          'SETTING_MONEY_MODEL_UNSUPPORTED',
          `advance_percentage (${advance}) must equal default_commission_rate (${commission}): the platform collects only its commission online and holds no provider money while settlements are dormant (TECH_DECISIONS D8). Change both values together.`,
          409,
        );
      }
      const defaultRadius = Number(current.get('default_search_radius_km'));
      const maxRadius = Number(current.get('max_search_radius_km'));
      if (
        Number.isFinite(defaultRadius) &&
        Number.isFinite(maxRadius) &&
        defaultRadius > maxRadius
      ) {
        throw new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
          {
            field: 'changes.default_search_radius_km',
            issue: 'must not exceed max_search_radius_km',
          },
        ]);
      }
    });
    this.bookingSettings.invalidate();
    this.logger.info(
      { keys: validated.map((c) => c.key), adminId: admin.id },
      'Platform settings updated',
    );
    return this.list();
  }
}
