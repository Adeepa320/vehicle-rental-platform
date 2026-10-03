import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createDatabase, type Database, type DatabaseHandle } from '@vrp/database';

import type { Env } from '../config/env.schema';

/** Injection token for the full handle (Drizzle db + raw postgres.js client). */
export const DATABASE_HANDLE = Symbol('DATABASE_HANDLE');
/** Injection token for the Drizzle query builder only (what repositories use). */
export const DATABASE = Symbol('DATABASE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}

/**
 * One connection pool per process, created lazily on first query so startup
 * never blocks on the database; `/ready` reports connectivity instead.
 */
@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>): DatabaseHandle =>
        createDatabase({
          url: config.get('DATABASE_URL', { infer: true }),
          max: 10,
          applicationName: 'vrp-api',
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_HANDLE],
      useFactory: (handle: DatabaseHandle): Database => handle.db,
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE_HANDLE, DATABASE],
})
export class DatabaseModule {}
