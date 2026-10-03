import { HttpException } from '@nestjs/common';
import type { ApiError, ApiErrorCode } from '@vrp/contracts';

import { ApiException } from './api.exception';

const STATUS_TO_CODE: Readonly<Partial<Record<number, ApiErrorCode>>> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'SERVICE_UNAVAILABLE',
};

const GENERIC_MESSAGE = 'An unexpected error occurred.';
const RATE_LIMITED_MESSAGE = 'Too many requests. Please retry later.';

export interface ErrorResponse {
  status: number;
  body: ApiError;
}

/**
 * Maps any thrown value to the uniform error envelope. Pure function so it is
 * unit-testable without an HTTP context. Never leaks stack traces or internal
 * messages for 5xx responses.
 */
export function toErrorResponse(exception: unknown, requestId?: string): ErrorResponse {
  if (exception instanceof ApiException) {
    return {
      status: exception.getStatus(),
      body: {
        error: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const code = STATUS_TO_CODE[status] ?? 'INTERNAL';
    const message =
      code === 'RATE_LIMITED'
        ? RATE_LIMITED_MESSAGE
        : status >= 500
          ? GENERIC_MESSAGE
          : extractMessage(exception);
    return { status, body: { error: { code, message, ...(requestId ? { requestId } : {}) } } };
  }

  return {
    status: 500,
    body: {
      error: { code: 'INTERNAL', message: GENERIC_MESSAGE, ...(requestId ? { requestId } : {}) },
    },
  };
}

function extractMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message: unknown }).message;
    if (typeof message === 'string') return message;
    if (Array.isArray(message)) return message.map(String).join('; ');
  }
  return exception.message;
}
