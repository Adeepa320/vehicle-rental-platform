import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DatabaseExecutor } from '@vrp/database';
import { sql } from 'drizzle-orm';
import { PinoLogger } from 'nestjs-pino';
// pg-boss is ESM-only; Node >= 22.12 loads it from this CommonJS bundle via require(esm).
import { PgBoss, fromDrizzle, type Job, type WorkOptions } from 'pg-boss';

import type { Env } from '../config/env.schema';
import { QUEUE_DEFINITIONS, type QueueName } from './queues';

export interface SendJobOptions {
  /**
   * Open Drizzle transaction. When given, the job row is inserted inside that
   * transaction, so the job exists if and only if the business write commits
   * (the transactional-outbox guarantee from ARCHITECTURE §5.1).
   */
  tx?: DatabaseExecutor;
  /** Seconds to delay the first attempt. */
  startAfterSeconds?: number;
}

export type JobHandler<T> = (jobs: Job<T>[]) => Promise<void>;

/**
 * Thin wrapper around pg-boss (Postgres-backed job queue, ARCHITECTURE §5.4).
 *
 * - The API process starts the queue lazily on first `send` with supervision
 *   and scheduling disabled: it only enqueues.
 * - The worker process (`worker.ts`) starts it eagerly and registers handlers.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private boss: PgBoss | undefined;
  private starting: Promise<void> | undefined;
  private readonly handlers = new Set<string>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JobsService.name);
  }

  /**
   * Connects to Postgres, installs/migrates the pg-boss schema and creates
   * missing queues. `role` decides whether this instance also maintains the
   * queue tables (worker) or only enqueues (api).
   */
  async start(role: 'worker' | 'api' = 'worker'): Promise<void> {
    if (this.boss) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const schema = this.config.get('PGBOSS_SCHEMA', { infer: true });
      const boss = new PgBoss({
        connectionString: this.config.get('DATABASE_URL', { infer: true }),
        schema,
        max: role === 'worker' ? 4 : 2,
        application_name: role === 'worker' ? 'vrp-worker' : 'vrp-api',
        supervise: role === 'worker',
        schedule: role === 'worker',
      });
      boss.on('error', (error: Error) => this.logger.error({ err: error }, 'pg-boss error'));
      await boss.start();
      for (const queue of QUEUE_DEFINITIONS) {
        if (!(await boss.getQueue(queue.name))) {
          await boss.createQueue(queue.name, queue.options);
        }
      }
      this.boss = boss;
      this.logger.info({ schema, role }, 'Job queue started');
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Enqueues a job, optionally inside the caller's database transaction. */
  async send<T extends object>(
    name: QueueName,
    data: T,
    options: SendJobOptions = {},
  ): Promise<string | null> {
    await this.start('api');
    const db = options.tx ? fromDrizzle(options.tx, sql) : undefined;
    return this.queue.send(name, data, {
      ...(db ? { db } : {}),
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
    });
  }

  /** Registers a batch handler for a queue (worker only). */
  async work<T extends object>(
    name: QueueName,
    options: WorkOptions,
    handler: JobHandler<T>,
  ): Promise<void> {
    await this.queue.work<T>(name, options, async (jobs) => {
      await handler(jobs);
    });
    this.handlers.add(name);
    this.logger.info({ queue: name }, 'Job handler registered');
  }

  /** Registers (or updates) a cron schedule for a queue (worker only; UTC). */
  async schedule(name: QueueName, cron: string): Promise<void> {
    await this.queue.schedule(name, cron, {}, { tz: 'UTC' });
    this.logger.info({ queue: name, cron }, 'Job schedule registered');
  }

  /** Fetches up to `batchSize` pending jobs without a handler; used by tests and tooling. */
  async fetch<T>(name: QueueName, batchSize = 10): Promise<Job<T>[]> {
    await this.start('api');
    return this.queue.fetch<T>(name, { batchSize });
  }

  /** The running pg-boss instance. Throws if `start()` has not completed. */
  get queue(): PgBoss {
    if (!this.boss) throw new Error('Job queue has not been started');
    return this.boss;
  }

  get isStarted(): boolean {
    return this.boss !== undefined;
  }

  /** Names of registered job handlers. */
  get registeredJobNames(): string[] {
    return [...this.handlers];
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = undefined;
    this.handlers.clear();
    await boss.stop({ graceful: true, timeout: 5_000 });
    this.logger.info('Job queue stopped');
  }
}
