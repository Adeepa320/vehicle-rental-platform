import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PinoLogger } from 'nestjs-pino';
// pg-boss is ESM-only; Node >= 22.12 loads it from this CommonJS bundle via require(esm).
import { PgBoss } from 'pg-boss';

import type { Env } from '../config/env.schema';

/**
 * Thin wrapper around pg-boss (Postgres-backed job queue, see ARCHITECTURE §5.4).
 *
 * Phase 1 only proves the queue can start against the database and shut down
 * cleanly. Later phases register handlers here (`queue.work(name, handler)`)
 * and enqueue from the API (`queue.send`). No jobs exist yet by design.
 */
@Injectable()
export class JobsService implements OnApplicationShutdown {
  private boss: PgBoss | undefined;
  private readonly handlers = new Set<string>();

  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(JobsService.name);
  }

  /** Connects to Postgres and installs/migrates the pg-boss schema if needed. */
  async start(): Promise<void> {
    if (this.boss) return;
    const schema = this.config.get('PGBOSS_SCHEMA', { infer: true });
    const boss = new PgBoss({
      connectionString: this.config.get('DATABASE_URL', { infer: true }),
      schema,
      max: 4,
      application_name: 'vrp-worker',
    });
    boss.on('error', (error: Error) => this.logger.error({ err: error }, 'pg-boss error'));
    await boss.start();
    this.boss = boss;
    this.logger.info({ schema }, 'Job queue started');
  }

  /** The running pg-boss instance. Throws if `start()` has not completed. */
  get queue(): PgBoss {
    if (!this.boss) throw new Error('Job queue has not been started');
    return this.boss;
  }

  get isStarted(): boolean {
    return this.boss !== undefined;
  }

  /** Names of registered job handlers (empty in Phase 1). */
  get registeredJobNames(): string[] {
    return [...this.handlers];
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.boss) return;
    const boss = this.boss;
    this.boss = undefined;
    await boss.stop({ graceful: true, timeout: 5_000 });
    this.logger.info('Job queue stopped');
  }
}
