# Vehicle Rental Platform

Sri Lankan online vehicle-rental marketplace: _search nearby vehicles → see real availability → compare transparent prices → trust verified providers → book_. Launching on the South Coast (Matara, Weligama, Mirissa, Galle, Unawatuna).

The product, architecture and roadmap are documented in [`docs/`](docs/) — start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md). Development rules for AI-assisted sessions are in [CLAUDE.md](CLAUDE.md).

**Current state: Phase 2 (Authentication & user foundation) implemented locally.** Accounts with e-mail + password, e-mail verification by link, login with short-lived access tokens and rotating refresh tokens, logout / logout-all, password reset, a basic profile, and the authorization foundation (guards, roles). No marketplace features yet; no paid services required.

## Repository layout

```
apps/
  api/        NestJS modular monolith: REST API (/api/v1) and background worker entrypoint
  web/        Next.js App Router web client (Tailwind CSS, shadcn/ui)
packages/
  contracts/  Zod schemas + TypeScript types shared by API, web and future mobile clients
  database/   Drizzle ORM schema, SQL migrations, reference-data seeds, database client
  eslint-config/      Shared ESLint flat configs (base, nest, next)
  typescript-config/  Shared strict tsconfig bases
infra/
  docker-compose.yml  Local PostgreSQL 17 + PostGIS 3.5 and Mailpit (e-mail catcher)
docs/         Product and technical documentation (source of truth)
```

## Prerequisites

| Tool           | Version    | Notes                                                           |
| -------------- | ---------- | --------------------------------------------------------------- |
| Node.js        | 24.x       | `node --version`                                                |
| pnpm           | 12.x       | `corepack enable` installs the version pinned in `package.json` |
| Docker Desktop | any recent | for the local PostGIS database and Mailpit                      |

No cloud accounts, API keys or paid services are needed for local development.

## Quick start

```bash
# 1. Install dependencies (post-install scripts are allow-listed in pnpm-workspace.yaml)
pnpm install

# 2. Create local env files from the examples (never commit the real ones)
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start PostgreSQL + PostGIS and Mailpit, apply migrations and load the South Coast seed data
pnpm db:setup          # = pnpm db:up && pnpm db:migrate && pnpm db:seed

# 4. Run the web app (http://localhost:3000) and the API (http://localhost:4000/api/v1)
pnpm dev

# 5. In a second terminal, run the worker that delivers e-mails
pnpm dev:worker

# 6. (Optional) make an existing, verified account an administrator
pnpm admin:grant --email you@example.com
```

Then:

- <http://localhost:3000> — status page; **Create account** → check the Mailpit inbox at <http://localhost:8025> → open the verification link → log in → **Account**.
- **Become a provider** → `/provider/application` → save and submit → as an admin, review at `/admin/providers` → approve → the applicant sees `/provider/dashboard`. See "Provider onboarding flow" below.
- <http://localhost:4000/api/docs> — Swagger UI generated from the shared Zod contracts (`/api/docs-json` for the document).
- `GET /api/v1/health` (liveness) and `GET /api/v1/ready` (readiness: database, PostGIS, migrations).

Without `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` the API generates an ephemeral signing key pair at startup (fine locally; sessions survive restarts through the refresh cookie). For a stable key pair run `pnpm --filter @vrp/api keys:generate` and paste the output into `.env`.

## Everyday commands

| Command                                           | What it does                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev`                                        | Web + API in watch mode (Turborepo)                                                            |
| `pnpm dev:worker`                                 | Worker process (pg-boss queue; delivers `email.send` jobs)                                     |
| `pnpm admin:grant --email <email> [--role admin]` | Grant `admin` (or `super_admin`) to an existing, active, verified user; audited and idempotent |
| `pnpm build`                                      | Production builds for every package and app                                                    |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`      | Quality gates (run before handing over work)                                                   |
| `pnpm check`                                      | lint + typecheck + test + build in one go                                                      |
| `pnpm format` / `pnpm format:check`               | Prettier                                                                                       |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:logs`    | Manage the Docker services                                                                     |
| `pnpm db:migrate`                                 | Apply pending SQL migrations to `DATABASE_URL`                                                 |
| `pnpm db:seed`                                    | Idempotent reference-data seed (districts, places, categories, settings)                       |
| `pnpm db:generate`                                | Generate a new migration from schema changes (see below)                                       |
| `pnpm --filter @vrp/api keys:generate`            | Print an Ed25519 key pair for `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                             |

## Environment variables

Root `.env` (copied from [`.env.example`](.env.example)) is read by Docker Compose defaults, the database scripts, the API and the worker:

| Variable                                                                                                    | Default                                                        | Used by                            |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ---------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT`                                           | `postgres` / `postgres` / `vehicle_rental` / `5432`            | Docker Compose                     |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT`                                                                     | `1025` / `8025`                                                | Docker Compose                     |
| `DATABASE_URL`                                                                                              | `postgresql://postgres:postgres@localhost:5432/vehicle_rental` | database scripts, API, worker      |
| `DATABASE_URL_TEST`                                                                                         | `…/vehicle_rental_test`                                        | automated tests                    |
| `NODE_ENV`                                                                                                  | `development`                                                  | API, worker                        |
| `API_PORT` / `API_HOST`                                                                                     | `4000` / `0.0.0.0`                                             | API                                |
| `CORS_ORIGINS`                                                                                              | `http://localhost:3000`                                        | API (CORS and CSRF origin check)   |
| `WEB_APP_URL`                                                                                               | `http://localhost:3000`                                        | API (links in e-mails)             |
| `LOG_LEVEL`                                                                                                 | `debug`                                                        | API, worker                        |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX`                                                                 | `60` / `300`                                                   | API                                |
| `AUTH_LOGIN_LIMIT_PER_MINUTE` / `AUTH_SENSITIVE_LIMIT_PER_15MIN` / `AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN` | `10` / `5` / `3`                                               | API                                |
| `JWT_ISSUER` / `JWT_AUDIENCE`                                                                               | `vrp-api` / `vrp`                                              | API                                |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                                                                        | _(unset → ephemeral pair; required in production)_             | API                                |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS`                                                       | `900` / `30`                                                   | API                                |
| `COOKIE_SECURE` / `COOKIE_DOMAIN`                                                                           | _(secure in production)_ / _(unset)_                           | API                                |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES`                                               | `24` / `30`                                                    | API                                |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST`                                                                    | `65536` / `3`                                                  | API                                |
| `EMAIL_PROVIDER`                                                                                            | `smtp` (`memory` for tests)                                    | API, worker                        |
| `EMAIL_FROM` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`                        | Mailpit defaults                                               | worker                             |
| `OPENAPI_ENABLED`                                                                                           | `true` outside production                                      | API                                |
| `PGBOSS_SCHEMA`                                                                                             | `pgboss`                                                       | API, worker                        |
| `OPERATOR_NOTIFICATION_EMAIL`                                                                               | _(unset → no operator notice)_                                 | API (e-mail on application submit) |

`apps/web/.env.local` (copied from [`apps/web/.env.example`](apps/web/.env.example)):

| Variable              | Default                        | Used by          |
| --------------------- | ------------------------------ | ---------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | browser          |
| `API_INTERNAL_URL`    | `http://localhost:4000/api/v1` | server rendering |

Placeholders for later phases (SMS, storage, payments, field encryption, error tracking) are listed as comments in `.env.example` and are not read by any code yet.

## Authentication flow (local)

1. **Register** at `/register` → the API stores an Argon2id hash, creates a 24-hour verification token (hashed) and enqueues an e-mail inside the same transaction.
2. The **worker** delivers it to Mailpit (<http://localhost:8025>); click the link → `/verify-email?token=…`.
3. **Log in** at `/login` → access token (15 min, kept in memory by the web app) + `vrp_refresh` HttpOnly cookie scoped to `/api/v1/auth`.
4. The web app silently refreshes before expiry; each refresh rotates the cookie. Replaying an old cookie revokes the whole session family.
5. `/account` shows and edits the profile; **Log out** revokes this session, **Log out everywhere** revokes all of them and invalidates outstanding access tokens immediately.
6. **Forgot password** sends a 30-minute single-use reset link; resetting signs out every session.

Login is refused until the e-mail is verified (`403 EMAIL_NOT_VERIFIED`). Unknown e-mails and wrong passwords return the same `401`. Forgot-password and resend-verification always return `202`.

## Provider onboarding flow (local)

Phase 3 is a lean, reviewed onboarding: no SMS, no document uploads, no object storage. Verification is a manual operator check (TECH_DECISIONS D30).

1. A **verified** customer opens `/become-a-provider` → `/provider/application`, fills in business, contact, operating-area and vehicle-type details (districts, places and categories come from `GET /reference/*`), saves drafts and **submits** (accepting the provider agreement). The phone number is stored but **not verified**.
2. The applicant receives an "application received" e-mail in Mailpit. When `OPERATOR_NOTIFICATION_EMAIL` is set, that inbox gets a notice too.
3. An **admin** — created with `pnpm admin:grant --email <user>`; the user must already exist, be active and have a verified e-mail — opens `/admin/providers`, inspects the application, calls or e-mails the applicant, then **Start review**, **Request changes** (reason shown to the applicant, who edits and resubmits), **Approve** or **Reject** (reason e-mailed).
4. **Approve** runs in one transaction: application `approved`, `provider_profiles` row (+ service areas and categories) created, `provider` appended to `users.roles`, `audit_events` row written, e-mail queued. The provider's next request already carries the role; `/provider/dashboard` shows the "Platform-approved provider" badge.
5. Admins can **suspend** / **reactivate** a provider from the "Approved providers" tab. A suspended provider keeps the role, but provider-only actions return `403 PROVIDER_SUSPENDED`.

States: `draft → submitted → under_review → changes_requested → submitted …`; `submitted | under_review → approved | rejected` (rejected is terminal for now). Wrong-state actions return `409 INVALID_STATE_TRANSITION`. Every admin decision is audited in `audit_events`.

## Database workflow

1. Edit the Drizzle schema in `packages/database/src/schema/`.
2. `pnpm db:generate` writes a new SQL file under `packages/database/drizzle/` and updates the journal.
3. **Review the SQL.** drizzle-kit quotes PostGIS column types it does not know (`"geography(Point,4326)"`); remove the quotes. A test (`packages/database/src/__tests__/migrations.test.ts`) fails if a quoted PostGIS type slips through. Quoted `"citext"` / `"inet"` are fine.
4. For SQL drizzle-kit cannot express (extensions, triggers, exclusion constraints), create an empty custom migration with `pnpm --filter @vrp/database exec drizzle-kit generate --custom --name <name>` and write the SQL by hand.
5. `pnpm db:migrate` applies it locally; migrations are forward-only (undo with a new migration) and safe to run concurrently (advisory lock).

Seeds are idempotent: reference attributes are upserted, while operational flags (`is_active`) and `platform_settings` are insert-only so admin changes in the database are never overwritten.

## Testing

```bash
pnpm test                      # everything (needs the Docker database for integration/e2e tests)
pnpm --filter @vrp/api test    # API unit + e2e (supertest against an in-process Nest app)
pnpm --filter @vrp/database test
pnpm --filter @vrp/contracts test
TEST_LOG_LEVEL=error pnpm --filter @vrp/api test   # show API error logs while debugging a test
```

Tests that need PostgreSQL use `DATABASE_URL_TEST` and skip with a warning when it is not set. The test database is created automatically by Docker on first start (`infra/db/init/`). E-mail in tests goes to an in-memory provider; e2e tests read queued jobs straight from the pg-boss queue (`pgboss_test` schema) to obtain verification and reset tokens.

Phase 3 e2e suites (`provider-application`, `admin-provider-review`, `admin-bootstrap`, `reference`) seed the gazetteer into the test database and create admins through the same `grantRole` function the CLI uses. The web app has a small Vitest suite for its pure form/API-client logic (`pnpm --filter @vrp/web test`).

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint → build → typecheck → migrate + seed → test → format check against a PostGIS service container. It needs no secrets. Deployment is intentionally not configured yet (see `docs/ARCHITECTURE.md` §13 for the planned hosting).

## Troubleshooting

- **`pnpm install` complains about ignored build scripts** — the allow-list lives in `pnpm-workspace.yaml` (`allowBuilds`). Run `pnpm approve-builds <pkg>` (or `'!<pkg>'` to deny) to extend it.
- **Port 5432 / 1025 / 8025 already in use** — set `DB_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT` in `.env` and start with `docker compose --env-file .env -f infra/docker-compose.yml up -d`, then update `DATABASE_URL*` / `SMTP_PORT`.
- **`/ready` reports `migrations: down`** — run `pnpm db:migrate`.
- **No verification e-mail arrives** — the worker must be running (`pnpm dev:worker`); check Mailpit at <http://localhost:8025> and the worker log.
- **`pnpm admin:grant` refuses** — the e-mail must belong to an existing, active user whose e-mail is verified (register and verify first). Running it again for the same user is safe.
- **"JWT_PRIVATE_KEY … not set" warning** — expected locally; generate keys with `pnpm --filter @vrp/api keys:generate` for stable tokens across restarts.
- **Test database missing** (older Docker volume) — `docker exec vehicle-rental-db psql -U postgres -c "CREATE DATABASE vehicle_rental_test;"`.
