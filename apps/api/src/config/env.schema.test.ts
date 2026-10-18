import { describe, expect, it } from 'vitest';

import { DEV_DATA_ENCRYPTION_KEY, derived, validateEnv } from './env.schema';

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

  it('defaults to the fake payment gateway outside production and refuses it in production', () => {
    expect(validateEnv(base).PAYMENT_GATEWAY).toBe('fake');
    expect(() => validateEnv({ ...base, NODE_ENV: 'production' })).toThrow(/PAYMENT_GATEWAY/);
  });

  it('requires the PayHere merchant credentials whenever the PayHere gateway is selected', () => {
    expect(() => validateEnv({ ...base, PAYMENT_GATEWAY: 'payhere' })).toThrow(
      /PAYHERE_MERCHANT_ID/,
    );
    expect(() =>
      validateEnv({ ...base, PAYMENT_GATEWAY: 'payhere', PAYHERE_MERCHANT_ID: '1211149' }),
    ).toThrow(/PAYHERE_MERCHANT_SECRET/);
    const env = validateEnv({
      ...base,
      PAYMENT_GATEWAY: 'payhere',
      PAYHERE_MERCHANT_ID: '1211149',
      PAYHERE_MERCHANT_SECRET: 'sandbox-secret-at-least-8',
    });
    expect(env.PAYHERE_ENVIRONMENT).toBe('sandbox');
    expect(env.PAYHERE_NOTIFY_URL).toBeUndefined();
  });

  it('fails production start-up without PayHere secrets or a public notify URL', () => {
    const production = {
      ...base,
      NODE_ENV: 'production',
      PAYMENT_GATEWAY: 'payhere',
      PAYHERE_ENVIRONMENT: 'live',
      BOOKING_QUOTE_SECRET: 'q'.repeat(32),
    };
    expect(() => validateEnv(production)).toThrow(/PAYHERE_MERCHANT_ID/);
    expect(() =>
      validateEnv({
        ...production,
        PAYHERE_MERCHANT_ID: '1211149',
        PAYHERE_MERCHANT_SECRET: 'live-secret-at-least-8',
      }),
    ).toThrow(/PAYHERE_NOTIFY_URL/);
    expect(() =>
      validateEnv({
        ...production,
        PAYHERE_MERCHANT_ID: '1211149',
        PAYHERE_MERCHANT_SECRET: 'live-secret-at-least-8',
        PAYHERE_NOTIFY_URL: 'not a url',
      }),
    ).toThrow(/PAYHERE_NOTIFY_URL/);
  });
  describe('production rules (Phase 10)', () => {
    const production: Record<string, string> = {
      DATABASE_URL: 'postgresql://vrp:secret@db.internal:5432/vrp',
      NODE_ENV: 'production',
      LAUNCH_MODE: 'production',
      TRUST_PROXY_HOPS: '1',
      CORS_ORIGINS: 'https://app.example.lk',
      WEB_APP_URL: 'https://app.example.lk',
      API_PUBLIC_URL: 'https://api.example.lk/api/v1',
      JWT_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\\nMC4C\\n-----END PRIVATE KEY-----',
      JWT_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\\nMCow\\n-----END PUBLIC KEY-----',
      BOOKING_QUOTE_SECRET: 'q'.repeat(32),
      APP_DATA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
      EMAIL_PROVIDER: 'smtp',
      EMAIL_FROM: 'Rentals <no-reply@example.lk>',
      SMTP_HOST: 'smtp.resend.com',
      SMTP_PORT: '587',
      SMTP_USER: 'resend',
      SMTP_PASS: 'smtp-password',
      STORAGE_PROVIDER: 's3',
      STORAGE_ENDPOINT: 'https://account.r2.cloudflarestorage.com',
      STORAGE_ACCESS_KEY: 'access',
      STORAGE_SECRET_KEY: 'secret',
      STORAGE_PUBLIC_URL: 'https://img.example.lk',
      PAYMENT_GATEWAY: 'payhere',
      PAYHERE_ENVIRONMENT: 'live',
      PAYHERE_MERCHANT_ID: '1211149',
      PAYHERE_MERCHANT_SECRET: 'live-secret-at-least-8',
      PAYHERE_NOTIFY_URL: 'https://api.example.lk/api/v1/payments/payhere/notify',
    };

    it('accepts a complete production configuration and derives the production defaults', () => {
      const env = validateEnv(production);
      expect(derived.cookieSecure(env)).toBe(true);
      expect(derived.hstsEnabled(env)).toBe(true);
      expect(derived.openApiEnabled(env)).toBe(false);
      expect(derived.adminMfaRequired(env)).toBe(true);
      expect(derived.smtpRequireTls(env)).toBe(true);
      expect(derived.storageAutoCreateBuckets(env)).toBe(false);
      expect(env.TRUST_PROXY_HOPS).toBe(1);
    });

    it.each([
      ['APP_DATA_ENCRYPTION_KEY', undefined, /APP_DATA_ENCRYPTION_KEY is required/],
      ['APP_DATA_ENCRYPTION_KEY', DEV_DATA_ENCRYPTION_KEY, /development key is refused/],
      ['APP_DATA_ENCRYPTION_KEY', 'too-short', /32-byte key/],
      ['ADMIN_MFA_REQUIRED', 'false', /admin MFA cannot be disabled/],
      ['COOKIE_SECURE', 'false', /must be Secure/],
      ['CORS_ORIGINS', 'https://app.example.lk,http://localhost:3000', /CORS_ORIGINS/],
      ['CORS_ORIGINS', '*', /CORS_ORIGINS/],
      ['WEB_APP_URL', 'http://app.example.lk', /WEB_APP_URL/],
      ['API_PUBLIC_URL', 'https://localhost:4000/api/v1', /API_PUBLIC_URL/],
      ['PAYHERE_NOTIFY_URL', 'https://192.168.1.10/notify', /PAYHERE_NOTIFY_URL/],
      ['PAYHERE_ENVIRONMENT', 'sandbox', /LAUNCH_MODE=production requires the live/],
      ['OPENAPI_ENABLED', 'true', /Swagger UI is not served/],
      ['SMTP_HOST', 'localhost', /SMTP_HOST/],
      ['SMTP_USER', undefined, /SMTP_USER and SMTP_PASS/],
      ['SMTP_REQUIRE_TLS', 'false', /TLS/],
      ['EMAIL_FROM', 'Rentals <no-reply@localhost>', /EMAIL_FROM/],
      ['STORAGE_ENDPOINT', 'http://localhost:9000', /STORAGE_ENDPOINT/],
      ['STORAGE_PUBLIC_URL', 'http://localhost:9000/vrp-public', /STORAGE_PUBLIC_URL/],
      ['STORAGE_ACCESS_KEY', 'minioadmin', /object-storage credentials/],
      ['STORAGE_AUTO_CREATE_BUCKETS', 'true', /managed by the operator/],
      ['PAYMENT_GATEWAY', 'fake', /fake payment gateway/],
    ] as Array<[string, string | undefined, RegExp]>)(
      'rejects %s=%s in production',
      (key, value, pattern) => {
        const variant = { ...production };
        if (value === undefined) delete variant[key];
        else variant[key] = value;
        expect(() => validateEnv(variant)).toThrow(pattern);
      },
    );

    it('lets staging keep the PayHere sandbox but still demands every other production rule', () => {
      expect(() =>
        validateEnv({ ...production, LAUNCH_MODE: 'staging', PAYHERE_ENVIRONMENT: 'sandbox' }),
      ).not.toThrow();
    });

    it('rejects a previous encryption key equal to the current one anywhere', () => {
      expect(() =>
        validateEnv({
          ...base,
          APP_DATA_ENCRYPTION_KEY: DEV_DATA_ENCRYPTION_KEY,
          APP_DATA_ENCRYPTION_KEY_PREVIOUS: DEV_DATA_ENCRYPTION_KEY,
        }),
      ).toThrow(/must differ/);
    });

    it('keeps development permissive: no MFA requirement, Swagger on, cookie not forced secure', () => {
      const env = validateEnv(base);
      expect(derived.adminMfaRequired(env)).toBe(false);
      expect(derived.openApiEnabled(env)).toBe(true);
      expect(derived.cookieSecure(env)).toBe(false);
      expect(env.TRUST_PROXY_HOPS).toBe(0);
      expect(env.THREAD_POSTS_PER_15MIN).toBe(30);
      expect(env.LAUNCH_MODE).toBe('staging');
    });
  });

  it('ignores unrelated variables', () => {
    const env = validateEnv({ ...base, SOMETHING_ELSE: 'x' });
    expect('SOMETHING_ELSE' in env).toBe(false);
  });
});
