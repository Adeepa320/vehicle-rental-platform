import { describe, expect, it } from 'vitest';

import { validateEnv } from './env.schema';

const base = { DATABASE_URL: 'postgresql://user:pass@localhost:5432/db' };

describe('validateEnv', () => {
  it('applies documented defaults', () => {
    const env = validateEnv(base);
    expect(env.NODE_ENV).toBe('development');
    expect(env.API_PORT).toBe(4000);
    expect(env.API_HOST).toBe('0.0.0.0');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:3000']);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.RATE_LIMIT_TTL_SECONDS).toBe(60);
    expect(env.RATE_LIMIT_MAX).toBe(300);
    expect(env.PGBOSS_SCHEMA).toBe('pgboss');
  });

  it('coerces numeric strings and splits CORS origins', () => {
    const env = validateEnv({
      ...base,
      API_PORT: '5001',
      RATE_LIMIT_MAX: '42',
      CORS_ORIGINS: 'https://app.example.lk, https://admin.example.lk ,',
    });
    expect(env.API_PORT).toBe(5001);
    expect(env.RATE_LIMIT_MAX).toBe(42);
    expect(env.CORS_ORIGINS).toEqual(['https://app.example.lk', 'https://admin.example.lk']);
  });

  it('rejects a missing or non-postgres DATABASE_URL with a readable message', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrow(/postgres/);
  });

  it('rejects invalid ports, log levels and schema names', () => {
    expect(() => validateEnv({ ...base, API_PORT: '70000' })).toThrow(/API_PORT/);
    expect(() => validateEnv({ ...base, LOG_LEVEL: 'verbose' })).toThrow(/LOG_LEVEL/);
    expect(() => validateEnv({ ...base, PGBOSS_SCHEMA: 'Drop Table' })).toThrow(/PGBOSS_SCHEMA/);
  });

  it('ignores unrelated variables', () => {
    const env = validateEnv({ ...base, SOMETHING_ELSE: 'x' });
    expect('SOMETHING_ELSE' in env).toBe(false);
  });
});
