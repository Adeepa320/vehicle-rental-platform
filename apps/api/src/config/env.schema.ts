import { z } from 'zod';

/** Accepts the usual string spellings of a boolean environment variable. */
const booleanString = z
  .enum(['true', 'false', '1', '0'])
  .transform((value) => value === 'true' || value === '1');

/**
 * The documented local / test data-encryption key (the 32 bytes of
 * `vrp-local-development-key-32byte`, base64). It exists so development and
 * tests are deterministic; production refuses it.
 */
export const DEV_DATA_ENCRYPTION_KEY = 'dnJwLWxvY2FsLWRldmVsb3BtZW50LWtleS0zMmJ5dGU=';

/** Decodes a base64 / base64url 32-byte key; `null` when malformed or the wrong length. */
export function decodeEncryptionKey(value: string): Buffer | null {
  const normalised = value.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalised)) return null;
  const key = Buffer.from(normalised, 'base64');
  return key.length === 32 ? key : null;
}

const encryptionKey = z
  .string()
  .min(1)
  .refine((value) => decodeEncryptionKey(value) !== null, {
    message: 'must be a 32-byte key encoded as base64 (44 characters)',
  });

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal']);

/** True for `http://localhost:…`, `127.0.0.1`, `.local` names and plain HTTP: never a public production URL. */
export function isLocalOrInsecureUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return (
      url.protocol !== 'https:' ||
      LOCAL_HOSTS.has(host) ||
      host.endsWith('.local') ||
      host.endsWith('.localhost') ||
      /^(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(host)
    );
  } catch {
    return true;
  }
}

/**
 * Every environment variable the API and worker read, validated once at
 * startup. Unknown variables are ignored; invalid or missing required ones
 * abort startup with a readable message (see `validateEnv`). The production
 * rules at the end are also what `pnpm production:check` reports on.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /**
     * Which launch stage a production build serves (Phase 10): `staging` may
     * still use the PayHere sandbox; `production` requires the live gateway.
     */
    LAUNCH_MODE: z.enum(['staging', 'production']).default('staging'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    API_HOST: z.string().min(1).default('0.0.0.0'),
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\/.+/, 'must be a postgres:// or postgresql:// connection URL'),
    /**
     * Number of reverse proxies in front of the API whose `X-Forwarded-*`
     * headers may be trusted (Express `trust proxy`). 0 = none: client IPs
     * come from the socket and forwarded headers are ignored. Railway's edge
     * is one hop; Cloudflare in front of it makes two.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
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
    /** Per-IP dispute opens / thread posts per 15 minutes (read at controller load, see auth-throttle.ts). */
    THREAD_POSTS_PER_15MIN: z.coerce.number().int().positive().default(30),
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
    /** Send `Strict-Transport-Security`. Defaults to true in production (TLS terminates at the edge, but the header must still reach browsers). */
    HSTS_ENABLED: booleanString.optional(),

    // ---- application-level encryption & admin MFA (Phase 10) ----
    /**
     * AES-256-GCM key for sensitive columns (TOTP secrets): 32 bytes, base64.
     * Required in production and must not be the documented development key.
     */
    APP_DATA_ENCRYPTION_KEY: encryptionKey.optional(),
    /** The previous key during a rotation: decrypt-only, never used for new ciphertext. */
    APP_DATA_ENCRYPTION_KEY_PREVIOUS: encryptionKey.optional(),
    /**
     * Privileged (`admin` / `super_admin`) actions require a completed TOTP
     * factor. Defaults to true in production (and cannot be disabled there)
     * and false elsewhere so local tooling and the test suites stay simple.
     */
    ADMIN_MFA_REQUIRED: booleanString.optional(),
    /** Label shown in authenticator apps. */
    MFA_ISSUER: z.string().min(1).max(60).default('Vehicle Rental Platform'),

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
    /** Implicit TLS (port 465). */
    SMTP_SECURE: booleanString.default(false),
    /** Refuse to deliver unless STARTTLS upgrades the connection (port 587). Defaults to true in production. */
    SMTP_REQUIRE_TLS: booleanString.optional(),
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

    // ---- bookings (Phase 6) ----
    /** HMAC secret for signed quote tokens (≥ 32 chars). Required in production; a per-process secret is generated otherwise. */
    BOOKING_QUOTE_SECRET: z.string().min(32).optional(),
    /** How long a quoted price can be used to create a booking request (PRD FR-PR3: 15 minutes). */
    BOOKING_QUOTE_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(15),

    // ---- payments (Phase 7, TECH_DECISIONS D53) ----
    /** Public base URL of this API (gateway notify URL, the fake gateway's checkout page). */
    API_PUBLIC_URL: z.url().default('http://localhost:4000/api/v1'),
    /** `payhere` (hosted checkout) or `fake` (deterministic local gateway; refused in production). */
    PAYMENT_GATEWAY: z.enum(['payhere', 'fake']).default('fake'),
    PAYHERE_ENVIRONMENT: z.enum(['sandbox', 'live']).default('sandbox'),
    /** From the PayHere merchant portal (Integrations → Add Domain/App); the secret is per domain/app. */
    PAYHERE_MERCHANT_ID: z.string().min(1).optional(),
    PAYHERE_MERCHANT_SECRET: z.string().min(8).optional(),
    /** Publicly reachable notify URL; defaults to `API_PUBLIC_URL` + `/payments/payhere/notify`. */
    PAYHERE_NOTIFY_URL: z.url().optional(),
    /** Merchant API app credentials (Retrieval / Refund APIs); optional. */
    PAYHERE_APP_ID: z.string().min(1).optional(),
    PAYHERE_APP_SECRET: z.string().min(1).optional(),

    // ---- observability (Phase 10) ----
    /** Optional error tracking; absent = no-op. Events are scrubbed before they leave the process. */
    SENTRY_DSN: z.url().optional(),
    /** Release identifier attached to logs and error events (e.g. the git SHA). */
    APP_RELEASE: z.string().min(1).max(100).optional(),

    // ---- developer tooling ----
    /** Serve Swagger UI at /api/docs. Defaults to true outside production. */
    OPENAPI_ENABLED: booleanString.optional(),
  })
  .superRefine((env, ctx) => {
    const issue = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });

    if (
      env.PAYMENT_GATEWAY === 'payhere' &&
      (!env.PAYHERE_MERCHANT_ID || !env.PAYHERE_MERCHANT_SECRET)
    ) {
      issue(
        'PAYHERE_MERCHANT_ID',
        'PAYHERE_MERCHANT_ID and PAYHERE_MERCHANT_SECRET are required when PAYMENT_GATEWAY=payhere',
      );
    }
    if (
      env.APP_DATA_ENCRYPTION_KEY &&
      env.APP_DATA_ENCRYPTION_KEY_PREVIOUS &&
      env.APP_DATA_ENCRYPTION_KEY === env.APP_DATA_ENCRYPTION_KEY_PREVIOUS
    ) {
      issue('APP_DATA_ENCRYPTION_KEY_PREVIOUS', 'must differ from APP_DATA_ENCRYPTION_KEY');
    }

    if (env.NODE_ENV !== 'production') return;

    // ---- production: payments ----
    if (env.PAYMENT_GATEWAY !== 'payhere') {
      issue('PAYMENT_GATEWAY', 'the fake payment gateway is for tests and local development only');
    }
    if (!env.PAYHERE_NOTIFY_URL) {
      issue(
        'PAYHERE_NOTIFY_URL',
        'PAYHERE_NOTIFY_URL (publicly reachable) is required in production',
      );
    } else if (isLocalOrInsecureUrl(env.PAYHERE_NOTIFY_URL)) {
      issue('PAYHERE_NOTIFY_URL', 'must be a public https:// URL');
    }
    if (env.LAUNCH_MODE === 'production' && env.PAYHERE_ENVIRONMENT !== 'live') {
      issue('PAYHERE_ENVIRONMENT', 'LAUNCH_MODE=production requires the live PayHere environment');
    }

    // ---- production: keys and secrets ----
    if (!env.JWT_PRIVATE_KEY || !env.JWT_PUBLIC_KEY) {
      issue('JWT_PRIVATE_KEY', 'JWT_PRIVATE_KEY and JWT_PUBLIC_KEY are required in production');
    }
    if (!env.BOOKING_QUOTE_SECRET) {
      issue('BOOKING_QUOTE_SECRET', 'BOOKING_QUOTE_SECRET is required in production');
    }
    if (!env.APP_DATA_ENCRYPTION_KEY) {
      issue('APP_DATA_ENCRYPTION_KEY', 'APP_DATA_ENCRYPTION_KEY is required in production');
    } else if (env.APP_DATA_ENCRYPTION_KEY === DEV_DATA_ENCRYPTION_KEY) {
      issue('APP_DATA_ENCRYPTION_KEY', 'the documented development key is refused in production');
    }
    if (env.ADMIN_MFA_REQUIRED === false) {
      issue('ADMIN_MFA_REQUIRED', 'admin MFA cannot be disabled in production');
    }

    // ---- production: browser-facing URLs, cookies, CORS ----
    if (env.COOKIE_SECURE === false) {
      issue('COOKIE_SECURE', 'the refresh cookie must be Secure in production');
    }
    for (const origin of env.CORS_ORIGINS) {
      if (origin === '*' || isLocalOrInsecureUrl(origin)) {
        issue('CORS_ORIGINS', `"${origin}" is not an explicit public https:// origin`);
        break;
      }
    }
    if (isLocalOrInsecureUrl(env.WEB_APP_URL)) {
      issue('WEB_APP_URL', 'must be a public https:// URL');
    }
    if (isLocalOrInsecureUrl(env.API_PUBLIC_URL)) {
      issue('API_PUBLIC_URL', 'must be a public https:// URL');
    }
    if (env.OPENAPI_ENABLED === true) {
      issue('OPENAPI_ENABLED', 'Swagger UI is not served in production');
    }

    // ---- production: e-mail ----
    if (env.EMAIL_PROVIDER === 'memory') {
      issue('EMAIL_PROVIDER', 'the in-memory e-mail provider is for tests only');
    }
    if (LOCAL_HOSTS.has(env.SMTP_HOST.toLowerCase())) {
      issue('SMTP_HOST', 'a local SMTP catcher is not a production mail provider');
    }
    if (!env.SMTP_USER || !env.SMTP_PASS) {
      issue('SMTP_USER', 'SMTP_USER and SMTP_PASS are required in production');
    }
    if (!env.SMTP_SECURE && env.SMTP_REQUIRE_TLS === false) {
      issue(
        'SMTP_REQUIRE_TLS',
        'mail must travel over TLS (SMTP_SECURE or STARTTLS) in production',
      );
    }
    if (/localhost|example\.(com|org|net)/i.test(env.EMAIL_FROM)) {
      issue('EMAIL_FROM', 'set the production sender address');
    }

    // ---- production: object storage ----
    if (env.STORAGE_PROVIDER === 'memory') {
      issue('STORAGE_PROVIDER', 'the in-memory storage provider is for tests only');
    }
    if (env.STORAGE_ACCESS_KEY === 'minioadmin' || env.STORAGE_SECRET_KEY === 'minioadmin') {
      issue('STORAGE_ACCESS_KEY', 'set real object-storage credentials in production');
    }
    if (isLocalOrInsecureUrl(env.STORAGE_ENDPOINT)) {
      issue('STORAGE_ENDPOINT', 'must be the https:// endpoint of the production object store');
    }
    if (isLocalOrInsecureUrl(env.STORAGE_PUBLIC_URL)) {
      issue('STORAGE_PUBLIC_URL', 'must be the public https:// base URL of the image bucket / CDN');
    }
    if (env.STORAGE_AUTO_CREATE_BUCKETS === true) {
      issue(
        'STORAGE_AUTO_CREATE_BUCKETS',
        'buckets and policies are managed by the operator in production',
      );
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Runtime defaults that depend on `NODE_ENV` (kept in one place so the API, worker and `production:check` agree). */
export const derived = {
  cookieSecure: (env: Env): boolean => env.COOKIE_SECURE ?? env.NODE_ENV === 'production',
  hstsEnabled: (env: Env): boolean => env.HSTS_ENABLED ?? env.NODE_ENV === 'production',
  openApiEnabled: (env: Env): boolean => env.OPENAPI_ENABLED ?? env.NODE_ENV !== 'production',
  adminMfaRequired: (env: Env): boolean => env.ADMIN_MFA_REQUIRED ?? env.NODE_ENV === 'production',
  smtpRequireTls: (env: Env): boolean => env.SMTP_REQUIRE_TLS ?? env.NODE_ENV === 'production',
  storageAutoCreateBuckets: (env: Env): boolean =>
    env.STORAGE_AUTO_CREATE_BUCKETS ?? env.NODE_ENV !== 'production',
};

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
