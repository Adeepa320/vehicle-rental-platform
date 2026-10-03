import type { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { createDatabase } from '@vrp/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { MemoryEmailProvider } from '../src/modules/notifications/email/memory-email.provider';
import { TEST_ENV_DEFAULTS, testDatabaseUrl } from './utils/create-app';
import { sleep } from './utils/auth-helpers';

const url = testDatabaseUrl();
if (!url) {
  console.warn('DATABASE_URL_TEST is not set: skipping worker tests that need PostgreSQL');
}

describe.skipIf(!url)('worker foundation (pg-boss + e-mail delivery)', () => {
  let app: INestApplicationContext;

  beforeAll(async () => {
    Object.assign(process.env, TEST_ENV_DEFAULTS, {
      DATABASE_URL: url as string,
      PGBOSS_SCHEMA: 'pgboss_worker_test',
    });
    // Imported after the environment is set because ConfigModule validates at import time.
    const { WorkerModule } = await import('../src/worker.module.js');
    app = await NestFactory.createApplicationContext(WorkerModule, {
      logger: false,
      abortOnError: false,
    });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('starts the job queue, installs its schema and creates the e-mail queue', async () => {
    const { JobsService } = await import('../src/jobs/jobs.service.js');
    const { QUEUES } = await import('../src/jobs/queues.js');
    const jobs = app.get(JobsService);
    expect(jobs.isStarted).toBe(false);

    await jobs.start('worker');
    expect(jobs.isStarted).toBe(true);
    expect(await jobs.queue.getQueue(QUEUES.emailSend)).not.toBeNull();

    const handle = createDatabase({
      url: url as string,
      max: 1,
      applicationName: 'vrp-worker-test',
    });
    try {
      const rows = await handle.sql<{ schema_name: string }[]>`
        select schema_name from information_schema.schemata where schema_name = 'pgboss_worker_test'
      `;
      expect(rows).toHaveLength(1);
    } finally {
      await handle.close();
    }
  });

  it('delivers a queued e-mail through the configured provider', async () => {
    const { JobsService } = await import('../src/jobs/jobs.service.js');
    const { QUEUES } = await import('../src/jobs/queues.js');
    const { EmailService } = await import('../src/modules/notifications/email/email.service.js');
    const { EMAIL_PROVIDER } = await import('../src/modules/notifications/email/email-provider.js');
    const { registerEmailJobs } =
      await import('../src/modules/notifications/email/email.worker.js');

    const jobs = app.get(JobsService);
    const email = app.get(EmailService);
    const provider = app.get<MemoryEmailProvider>(EMAIL_PROVIDER);
    await registerEmailJobs(jobs, email);
    expect(jobs.registeredJobNames).toEqual([QUEUES.emailSend]);

    const to = `worker-${Date.now()}@example.com`;
    await email.enqueue({ to, subject: 'Worker test', text: 'hello from the queue' });

    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && !provider.sent.some((m) => m.to === to)) {
      await sleep(200);
    }
    const delivered = provider.sent.find((m) => m.to === to);
    expect(delivered?.text).toBe('hello from the queue');
  });

  it('stops cleanly on application shutdown', async () => {
    const { JobsService } = await import('../src/jobs/jobs.service.js');
    const jobs = app.get(JobsService);
    await app.close();
    expect(jobs.isStarted).toBe(false);
  });
});
