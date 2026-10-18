import type { NestExpressApplication } from '@nestjs/platform-express';
import { WorkerStatusSchema } from '@vrp/contracts';
import { runMigrations, type DatabaseHandle } from '@vrp/database';
import { sql } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE_HANDLE } from '../src/database/database.module';
import { HEARTBEAT_QUEUE } from '../src/modules/system/worker-status.service';
import { cleanupUsers, emailFactory } from './utils/auth-helpers';
import { createTestApp, testDatabaseUrl } from './utils/create-app';
import { newAdmin, newVerifiedUser } from './utils/provider-helpers';

const url = testDatabaseUrl();
if (!url) console.warn('DATABASE_URL_TEST is not set: skipping admin system e2e tests');

const SCOPE = 'asys';
const nextEmail = emailFactory(SCOPE);

/**
 * `GET /admin/system/worker` (Phase 10): the operator view of pg-boss. The raw
 * rows come back without Drizzle's column mapping (timestamps as strings), which
 * once produced a 500; the heartbeat must be derived from them and the endpoint
 * must stay admin-only.
 */
describe.skipIf(!url)('admin system status (Phase 10)', () => {
  let app: NestExpressApplication;
  let handle: DatabaseHandle;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    await runMigrations(url as string);
    app = await createTestApp({ DATABASE_URL: url as string });
    handle = app.get<DatabaseHandle>(DATABASE_HANDLE);
    adminToken = (await newAdmin(app, nextEmail())).body.accessToken;
    customerToken = (await newVerifiedUser(app, nextEmail())).body.accessToken;
  });

  afterAll(async () => {
    await cleanupUsers(app, SCOPE);
    await app.close();
  });

  it('is admin-only', async () => {
    await request(app.getHttpServer()).get('/api/v1/admin/system/worker').expect(401);
    await request(app.getHttpServer())
      .get('/api/v1/admin/system/worker')
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(403);
  });

  it('derives the heartbeat from the latest completed minute sweep and lists the queues', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/system/worker')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const status = WorkerStatusSchema.parse(res.body);
    expect(status.heartbeatQueue).toBe(HEARTBEAT_QUEUE);
    expect(status.staleAfterSeconds).toBe(180);
    // Compare with the database directly: healthy only when the latest completed sweep is recent.
    const rows = await handle.db.execute<{ last: Date | string | null }>(
      sql`select max(completed_on) as last from pgboss_test.job where name = ${HEARTBEAT_QUEUE} and state = 'completed'`,
    );
    const last = rows[0]?.last ? new Date(rows[0].last) : null;
    expect(status.heartbeatLastCompletedAt).toBe(last?.toISOString() ?? null);
    expect(status.healthy).toBe(last !== null && Date.now() - last.getTime() <= 180_000);
    expect(status.queues.some((q) => q.name === 'email.send')).toBe(true);
    for (const queue of status.queues) {
      expect(queue.completedLast24h).toBeGreaterThanOrEqual(0);
      if (queue.lastCompletedAt !== null) {
        expect(Number.isNaN(Date.parse(queue.lastCompletedAt))).toBe(false);
      }
    }
  });

  it('turns a fresh heartbeat row with a string timestamp into a healthy status', async () => {
    // Simulate a worker that completed the minute sweep just now.
    await handle.db.execute(sql`
      insert into pgboss_test.job (name, data, state, created_on, started_on, completed_on, keep_until, policy)
      values (${HEARTBEAT_QUEUE}, '{}'::jsonb, 'completed', now(), now(), now(), now() + interval '1 day', 'standard')
      on conflict do nothing`);
    const res = await request(app.getHttpServer())
      .get('/api/v1/admin/system/worker')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const status = WorkerStatusSchema.parse(res.body);
    expect(status.healthy).toBe(true);
    expect(status.heartbeatLastCompletedAt).not.toBeNull();
    expect(Date.now() - Date.parse(status.heartbeatLastCompletedAt as string)).toBeLessThan(60_000);
    await handle.db.execute(
      sql`delete from pgboss_test.job where name = ${HEARTBEAT_QUEUE} and state = 'completed' and data = '{}'::jsonb and completed_on > now() - interval '1 minute'`,
    );
  });
});
