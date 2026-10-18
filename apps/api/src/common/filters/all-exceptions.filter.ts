import { Catch, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { toErrorResponse } from '../errors/error-response';
import { ErrorReporter } from '../observability/error-reporter';

/**
 * Global filter: every error leaves the API as the shared `ApiError` envelope
 * with the request id, and 5xx errors are logged with their stack.
 *
 * `PinoLogger` is injected directly (not via `@InjectPinoLogger`) because the
 * decorator variant depends on class-decoration order relative to
 * `LoggerModule.forRoot`, which is fragile across entrypoints and test runners.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly reporter: ErrorReporter,
  ) {
    this.logger.setContext(AllExceptionsFilter.name);
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<
      Request & { id?: unknown; route?: { path?: string }; user?: { id?: string } }
    >();
    const requestId = typeof request.id === 'string' ? request.id : undefined;

    const { status, body } = toErrorResponse(exception, requestId);

    if (status >= 500) {
      this.logger.error(
        { err: exception, requestId, method: request.method, url: request.originalUrl },
        'Unhandled exception',
      );
      this.reporter.capture(exception, {
        requestId,
        method: request.method,
        route: request.route?.path,
        userId: request.user?.id,
      });
    }

    response.status(status).json(body);
  }
}
