import { Global, Module } from '@nestjs/common';

import { ErrorReporter } from './error-reporter';

/** Error reporting for the API and the worker (Phase 10); a no-op without `SENTRY_DSN`. */
@Global()
@Module({ providers: [ErrorReporter], exports: [ErrorReporter] })
export class ObservabilityModule {}
