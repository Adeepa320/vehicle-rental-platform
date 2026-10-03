import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { describe, expect, it } from 'vitest';

import { ApiException } from './api.exception';
import { toErrorResponse } from './error-response';

describe('toErrorResponse', () => {
  it('renders ApiException with its code, details and request id', () => {
    const exception = new ApiException('VALIDATION_ERROR', 'Invalid request body', 400, [
      { field: 'startsAt', issue: 'must be in the future' },
    ]);
    expect(toErrorResponse(exception, 'req-1')).toEqual({
      status: 400,
      body: {
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
          details: [{ field: 'startsAt', issue: 'must be in the future' }],
          requestId: 'req-1',
        },
      },
    });
  });

  it('maps built-in Nest HTTP exceptions by status', () => {
    expect(toErrorResponse(new NotFoundException('Cannot GET /x')).body.error).toMatchObject({
      code: 'NOT_FOUND',
      message: 'Cannot GET /x',
    });
    expect(toErrorResponse(new ThrottlerException()).body.error.code).toBe('RATE_LIMITED');
    expect(toErrorResponse(new ServiceUnavailableException()).status).toBe(503);
  });

  it('hides internal details for unknown errors', () => {
    const result = toErrorResponse(new Error('ECONNREFUSED postgresql://secret@host/db'), 'req-2');
    expect(result.status).toBe(500);
    expect(result.body.error.code).toBe('INTERNAL');
    expect(result.body.error.message).not.toContain('postgresql://');
    expect(result.body.error.requestId).toBe('req-2');
  });

  it('omits requestId when none is known', () => {
    expect('requestId' in toErrorResponse(new NotFoundException()).body.error).toBe(false);
  });
});
