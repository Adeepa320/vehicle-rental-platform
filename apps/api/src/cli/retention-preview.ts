/**
 * Retention dry run (Phase 10, docs/security/DATA_RETENTION.md): counts what
 * the daily `retention.sweep` would delete under the current settings without
 * deleting anything. Boots the worker module (no HTTP server) against the
 * configured database. Runs from the build (`pnpm --filter @vrp/api build` first):
 * NestJS dependency injection needs the decorator metadata tsx does not emit.
 *
 *   pnpm retention:preview            # counts
 *   pnpm retention:preview --apply    # run the sweep now (same code path as the job)
 */
import { NestFactory } from '@nestjs/core';

import { RetentionService } from '../modules/retention/retention.service';
import { WorkerModule } from '../worker.module';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  try {
    const summary = await app.get(RetentionService).sweep(new Date(), { dryRun: !apply });
    console.warn(JSON.stringify(summary, null, 2));
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
