import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@vrp/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_ENV_DEFAULTS, testDatabaseUrl } from './utils/create-app';

const url = testDatabaseUrl();
if (!url) {
  console.warn('DATABASE_URL_TEST is not set: skipping worker tests that need PostgreSQL');
}

describe.skipIf(!url)('worker foundation (pg-boss)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV_DEFAULTS, {
      DATABASE_URL: url as string,
      PGBOSS_SCHEMA: 'pgboss_test',
    });
    // Imported after the environment is set because ConfigModule validates at import time.
    const { WorkerModule } = await import('../src/worker.module.js');
    app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
      // Surface initialisation errors as rejections instead of process.abort().
      abortOnError: false,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('starts the job queue against the database and installs its schema', async () => {
    const { JobsService } = await import('../src/jobs/jobs.service.js');
    const jobs = app.get(JobsService);
    expect(jobs.isStarted).toBe(false);

    await jobs.start();
    expect(jobs.isStarted).toBe(true);
    expect(jobs.registeredJobNames).toEqual([]);

    const handle = createDatabase({
      url: url as string,
      max: 1,
      applicationName: 'vrp-worker-test',
    });
    try {
      const rows = await handle.sql<{ schema_name: string }[]>`
        select schema_name from information_schema.schemata where schema_name = 'pgboss_test'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('stops cleanly on application shutdown', async () => {
    const { JobsService } = await import('../src/jobs/jobs.service.js');
    const jobs = app.get(JobsService);
    await app.close();
    expect(jobs.isStarted).toBe(false);
  });
});
