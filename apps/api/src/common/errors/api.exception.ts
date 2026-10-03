import { HttpException } from '@nestjs/common';
import type { ApiErrorCode, ApiErrorDetail } from '@vrp/contracts';

/**
 * Application error carrying a machine-readable code from the shared contract.
 * Thrown by services/pipes; rendered by `AllExceptionsFilter`.
 */
export class ApiException extends HttpException {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    status: number,
    readonly details?: ApiErrorDetail[],
  ) {
    super({ code, message, details }, status);
  }
}
