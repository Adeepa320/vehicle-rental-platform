import { describe, expect, it } from 'vitest';

import { API_BASE_PATH, ApiErrorSchema, HealthResponseSchema, ReadyResponseSchema } from '../index';

describe('API base path', () => {
  it('mounts v1 under /api/v1', () => {
    expect(API_BASE_PATH).toBe('/api/v1');
  });
});

describe('HealthResponseSchema', () => {
  const valid = {
    status: 'ok',
    service: 'vrp-api',
    version: '0.1.0',
    environment: 'test',
    uptimeSeconds: 12,
    timestamp: '2026-10-03T00:00:00.000Z',
  };

  it('accepts a valid payload', () => {
    expect(HealthResponseSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a non-ok status and a non-ISO timestamp', () => {
    expect(HealthResponseSchema.safeParse({ ...valid, status: 'degraded' }).success).toBe(false);
    expect(HealthResponseSchema.safeParse({ ...valid, timestamp: 'yesterday' }).success).toBe(
      false,
    );
  });
});

describe('ReadyResponseSchema', () => {
  it('requires every check and allows a down message', () => {
    const payload = {
      status: 'not_ready',
      checks: {
        database: { status: 'down', message: 'connect ECONNREFUSED' },
        postgis: { status: 'down' },
        migrations: { status: 'down' },
      },
      timestamp: '2026-10-03T00:00:00.000Z',
    };
    expect(ReadyResponseSchema.safeParse(payload).success).toBe(true);
    const { migrations: _dropped, ...partial } = payload.checks;
    expect(ReadyResponseSchema.safeParse({ ...payload, checks: partial }).success).toBe(false);
  });
});

describe('ApiErrorSchema', () => {
  it('requires a known code and message', () => {
    expect(
      ApiErrorSchema.safeParse({ error: { code: 'NOT_FOUND', message: 'Nope', requestId: 'r1' } })
        .success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: 'WHATEVER', message: 'x' } }).success).toBe(
      false,
    );
  });
});
