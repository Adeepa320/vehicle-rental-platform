import { z } from 'zod';

/** Accepts the usual string spellings of a boolean environment variable. */
const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * Every environment variable the API and worker read, validated once at
 * startup. Unknown variables are ignored; invalid or missing required ones
 * abort startup with a readable message (see `validateEnv`).
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection URL'),
    /** Comma-separated browser origins allowed by CORS (and by the CSRF origin check). */
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:3000')
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      ),
    /** Public URL of the web app; used to build links in e-mails. */
    WEB_APP_URL: z.url().default('http://localhost:3000'),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
    RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
    /** Per-IP login attempts per minute (read at controller load, see auth-throttle.ts). */
    AUTH_LOGIN_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(10),
    /** Per-IP register / forgot-password / resend-verification requests per 15 minutes. */
    AUTH_SENSITIVE_LIMIT_PER_15MIN: z.coerce.number().int().positive().default(5),
    /** Per-account e-mail tokens (verification or reset) per 15 minutes; excess requests are silently dropped. */
    AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN: z.coerce.number().int().positive().default(3),
    /** Schema pg-boss creates for its queue tables. */
    PGBOSS_SCHEMA: z
      .string()
      .regex(/^[a-z_][a-z0-9_]*$/, 'must be a lowercase SQL identifier')
      .default('pgboss'),

    // ---- tokens & sessions ----
    JWT_ISSUER: z.string().min(1).default('vrp-api'),
    JWT_AUDIENCE: z.string().min(1).default('vrp'),
    /** PEM Ed25519 keys (PKCS#8 / SPKI); `\n` escapes allowed. Required in production; generated per process otherwise. */
    JWT_PRIVATE_KEY: z.string().min(1).optional(),
    JWT_PUBLIC_KEY: z.string().min(1).optional(),
    ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    /** Defaults to true in production. Browsers treat http://localhost as secure, so true also works locally. */
    COOKIE_SECURE: booleanString.optional(),
    COOKIE_DOMAIN: z.string().min(1).optional(),
    EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
    PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(1440).default(30),

    // ---- password hashing (Argon2id) ----
    ARGON2_MEMORY_KIB: z.coerce.number().int().min(8192).default(65536),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(3),

    // ---- e-mail delivery ----
    /** `smtp` (Mailpit locally, any SMTP in production) or `memory` (tests). */
    EMAIL_PROVIDER: z.enum(['smtp', 'memory']).default('smtp'),
    /** Optional operator inbox notified when a provider application is submitted. */
    OPERATOR_NOTIFICATION_EMAIL: z.email().optional(),
    EMAIL_FROM: z.string().min(3).default('Vehicle Rental Platform <no-reply@localhost>'),
    SMTP_HOST: z.string().min(1).default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1025),
    SMTP_SECURE: booleanString.default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASS: z.string().min(1).optional(),

    // ---- object storage (S3-compatible; MinIO locally, TECH_DECISIONS D42) ----
    /** `s3` (MinIO locally, any S3-compatible service later) or `memory` (tests). */
    STORAGE_PROVIDER: z.enum(['s3', 'memory']).default('s3'),
    STORAGE_ENDPOINT: z.url().default('http://localhost:9000'),
    STORAGE_REGION: z.string().min(1).default('us-east-1'),
    /** MinIO's documented default root credentials; local development only (refused in production). */
    STORAGE_ACCESS_KEY: z.string().min(1).default('minioadmin'),
    STORAGE_SECRET_KEY: z.string().min(1).default('minioadmin'),
    STORAGE_BUCKET_PRIVATE: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
      .default('vrp-private'),
    STORAGE_BUCKET_PUBLIC: z
      .string()
      .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
      .default('vrp-public'),
    /** Base URL from which objects in the public bucket are served (MinIO path-style locally, a CDN or custom domain later). */
    STORAGE_PUBLIC_URL: z.url().default('http://localhost:9000/vrp-public'),
    STORAGE_FORCE_PATH_STYLE: booleanString.default(true),
    /** Create buckets and the public-read policy at startup. Defaults to true outside production. */
    STORAGE_AUTO_CREATE_BUCKETS: booleanString.optional(),

    // ---- developer tooling ----
    /** Serve Swagger UI at /api/docs. Defaults to true outside production. */
    OPENAPI_ENABLED: booleanString.optional(),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === 'production') {
      if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
        ctx.addIssue({
          code: 'custom',
          path: ['JWT_PRIVATE_KEY'],
          message: 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production',
        });
      }
      if (env.EMAIL_PROVIDER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['EMAIL_PROVIDER'],
          message: 'the in-memory e-mail provider is for tests only',
        });
      }
      if (env.STORAGE_PROVIDER === 'memory') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_PROVIDER'],
          message: 'the in-memory storage provider is for tests only',
        });
      }
      if (env.STORAGE_ACCESS_KEY === 'minioadmin' || env.STORAGE_SECRET_KEY === 'minioadmin') {
        ctx.addIssue({
          code: 'custom',
          path: ['STORAGE_ACCESS_KEY'],
          message: 'set real object-storage credentials in production',
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by `ConfigModule.forRoot({ validate })`; throws with every issue listed. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration (see .env.example):\n${issues}`);
  }
  return result.data;
}
