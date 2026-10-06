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
  docker-compose.yml  Local PostgreSQL 17 + PostGIS 3.5, Mailpit (e-mail catcher) and MinIO (S3-compatible photo storage, dev only)
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

# 3. Start PostgreSQL + PostGIS, Mailpit and MinIO, apply migrations and load the South Coast seed data
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
- **Provider inventory** → `/provider/locations` (pickup points) → `/provider/vehicles` (listings, pricing, submit for review) → as an admin, review at `/admin/vehicles` → approve → `/provider/vehicles/[id]/availability` (manual blocks). See "Vehicle inventory flow" below.
- **Customer discovery** → `/` (search box) → `/search?placeId=…` (filters, sort, optional map) → `/vehicles/[slug]`. A listing appears publicly only when it is approved, has 3+ photos, and its provider and pickup location are active. See "Photos, search and public pages" below.
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

| Variable                                                                                                    | Default                                                            | Used by                            |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT`                                           | `postgres` / `postgres` / `vehicle_rental` / `5432`                | Docker Compose                     |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT`                                                                     | `1025` / `8025`                                                    | Docker Compose                     |
| `MINIO_PORT` / `MINIO_CONSOLE_PORT` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`                             | `9000` / `9001` / `minioadmin` / `minioadmin`                      | Docker Compose (dev only)          |
| `DATABASE_URL`                                                                                              | `postgresql://postgres:postgres@localhost:5432/vehicle_rental`     | database scripts, API, worker      |
| `DATABASE_URL_TEST`                                                                                         | `…/vehicle_rental_test`                                            | automated tests                    |
| `NODE_ENV`                                                                                                  | `development`                                                      | API, worker                        |
| `API_PORT` / `API_HOST`                                                                                     | `4000` / `0.0.0.0`                                                 | API                                |
| `CORS_ORIGINS`                                                                                              | `http://localhost:3000`                                            | API (CORS and CSRF origin check)   |
| `WEB_APP_URL`                                                                                               | `http://localhost:3000`                                            | API (links in e-mails)             |
| `LOG_LEVEL`                                                                                                 | `debug`                                                            | API, worker                        |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX`                                                                 | `60` / `300`                                                       | API                                |
| `AUTH_LOGIN_LIMIT_PER_MINUTE` / `AUTH_SENSITIVE_LIMIT_PER_15MIN` / `AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN` | `10` / `5` / `3`                                                   | API                                |
| `JWT_ISSUER` / `JWT_AUDIENCE`                                                                               | `vrp-api` / `vrp`                                                  | API                                |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                                                                        | _(unset → ephemeral pair; required in production)_                 | API                                |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS`                                                       | `900` / `30`                                                       | API                                |
| `COOKIE_SECURE` / `COOKIE_DOMAIN`                                                                           | _(secure in production)_ / _(unset)_                               | API                                |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES`                                               | `24` / `30`                                                        | API                                |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST`                                                                    | `65536` / `3`                                                      | API                                |
| `EMAIL_PROVIDER`                                                                                            | `smtp` (`memory` for tests)                                        | API, worker                        |
| `EMAIL_FROM` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`                        | Mailpit defaults                                                   | worker                             |
| `OPENAPI_ENABLED`                                                                                           | `true` outside production                                          | API                                |
| `PGBOSS_SCHEMA`                                                                                             | `pgboss`                                                           | API, worker                        |
| `OPERATOR_NOTIFICATION_EMAIL`                                                                               | _(unset → no operator notice)_                                     | API (e-mail on application submit) |
| `STORAGE_PROVIDER` / `STORAGE_ENDPOINT` / `STORAGE_REGION`                                                  | `s3` / `http://localhost:9000` / `us-east-1`                       | API (photos; `memory` in tests)    |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`                                                                 | `minioadmin` / `minioadmin` (refused in production)                | API                                |
| `STORAGE_BUCKET_PRIVATE` / `STORAGE_BUCKET_PUBLIC` / `STORAGE_PUBLIC_URL`                                   | `vrp-private` / `vrp-public` / `http://localhost:9000/vrp-public`  | API (variant URLs)                 |
| `STORAGE_FORCE_PATH_STYLE` / `STORAGE_AUTO_CREATE_BUCKETS`                                                  | `true` / `true` outside production                                 | API                                |
| `BOOKING_QUOTE_SECRET`                                                                                      | _(unset → per-process secret; required in production, ≥ 32 chars)_ | API (signed quote tokens)          |
| `BOOKING_QUOTE_TTL_MINUTES`                                                                                 | `15`                                                               | API                                |

Payments (Phase 7):

| Variable                                          | Default                                                                                             | Used by                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `API_PUBLIC_URL`                                  | `http://localhost:4000/api/v1`                                                                      | API (gateway `notify_url`, fake checkout URL)  |
| `PAYMENT_GATEWAY`                                 | `fake` (refused in production)                                                                      | API (`payhere` needs the merchant credentials) |
| `PAYHERE_ENVIRONMENT`                             | `sandbox`                                                                                           | API (`live` for production)                    |
| `PAYHERE_MERCHANT_ID` / `PAYHERE_MERCHANT_SECRET` | _(unset; required when `PAYMENT_GATEWAY=payhere`; the secret also signs the fake gateway when set)_ | API (never logged, never returned)             |
| `PAYHERE_NOTIFY_URL`                              | _(unset → `API_PUBLIC_URL` + `/payments/payhere/notify`; must be public; required in production)_   | API                                            |
| `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET`           | _(unset → Retrieval / Refund API unavailable: admin reconcile and gateway refunds answer `503`)_    | API                                            |

`apps/web/.env.local` (copied from [`apps/web/.env.example`](apps/web/.env.example)):

| Variable                    | Default                                        | Used by                                |
| --------------------------- | ---------------------------------------------- | -------------------------------------- |
| `NEXT_PUBLIC_API_URL`       | `http://localhost:4000/api/v1`                 | browser                                |
| `API_INTERNAL_URL`          | `http://localhost:4000/api/v1`                 | server rendering                       |
| `NEXT_PUBLIC_MAP_STYLE_URL` | `https://tiles.openfreemap.org/styles/liberty` | browser (MapLibre style; free, no key) |

Placeholders for later phases (SMS, field encryption, error tracking) are listed as comments in `.env.example` and are not read by any code yet.

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

## Vehicle inventory flow (local)

Phase 4 is lean too: no paid map API (district + town from the gazetteer, optional typed-in pin), no photos or object storage, no customer search or booking (TECH_DECISIONS D37–D41).

1. An **approved, active provider** adds a pickup location at `/provider/locations` (the first one becomes primary; deactivating is refused while vehicles use it).
2. `/provider/vehicles/new` creates a `draft` from category, make, model and year. `/provider/vehicles/[id]` completes the listing: specifications (category-aware), **pricing in LKR** (daily, optional weekly/monthly, deposit, included km + extra-km rate, min/max days) and rules. The page shows the submission checklist; **Save and submit for review** moves it to `submitted` and e-mails the provider (and the operator inbox when `OPERATOR_NOTIFICATION_EMAIL` is set).
3. An **admin** reviews at `/admin/vehicles`: **Start review**, **Request changes** (reason e-mailed; the provider edits and resubmits), **Approve** or **Reject**. Approved listings can be **suspended** / **reactivated** by an admin and taken offline / put back online by the provider; identity fields (make, model, year, plate, specs) are locked after approval.
4. `/provider/vehicles/[id]/availability` manages **manual blocks** (maintenance, rented offline, …). The vehicle is available on every day without a block while `approved`; overlapping blocks are refused (`409 AVAILABILITY_CONFLICT`) and the database's exclusion constraint on `vehicle_holds` is the final guard.

Money never uses floats: amounts are decimal strings in the API (`"7500.00"`) and `numeric(12,2)` in PostgreSQL. Registration numbers are stored upper-cased and shown in full only to the provider and admins.

## Photos, search and public pages (local)

Phase 5 adds the customer side without any paid service: MinIO (local S3-compatible storage, development only), MapLibre with free OpenFreeMap tiles, and PostgreSQL/PostGIS search (TECH_DECISIONS D42–D47).

1. **Photos.** On `/provider/vehicles/[id]` a provider uploads 3–12 photos (JPEG/PNG/WebP, ≤ 10 MB). The API checks the real format, strips EXIF/GPS metadata, stores the original in the private bucket `vrp-private` and three WebP variants in the public bucket `vrp-public` (MinIO console: <http://localhost:9001>). Listings cannot be submitted or approved with fewer than 3 photos; photos can be changed while the listing is a draft or has changes requested.
2. **Approval assigns a public slug** (`toyota-aqua-2018-mirissa-ab12`).
3. **Search.** `/` → `/search` calls `GET /vehicles/search`: only approved listings of active providers at active locations with 3+ photos; with dates, only vehicles with no overlapping `vehicle_holds` and whose min/max rental days fit. Place search uses the gazetteer centre and PostGIS radius; results carry a distance and an **estimated** total (listed rates only; not a booking quote).
4. **Public listing page** `/vehicles/[slug]` is server-rendered with gallery, specs, pricing, rules, provider summary and an **approximate** map point (pin snapped to ~550 m or the town centre). Exact addresses, pickup instructions, plates and provider contact details are never public.
5. Payment does not exist yet; booking requests do (next section).

Try it: approve a listing with photos, then open <http://localhost:3000/search> and the listing's public page.

## Bookings (local)

Phase 6 is the lean request-to-book loop (TECH_DECISIONS D48–D52) and Phase 7 adds the online advance (D53–D56). The vehicle is reserved only when the provider accepts, and the booking is confirmed only when the advance has been paid and verified.

1. **Request.** On a listing page pick dates → **Check price and availability** (`GET /vehicles/{slug}/quote`, a signed 15-minute price token) → **Request to book** → `/bookings/new` (log in if needed; the dates survive the redirect) → driver name, licence country and expiry, optional message → **Send booking request** (`POST /bookings` with an `Idempotency-Key`). The booking is `requested`; both parties get an e-mail (Mailpit). Several customers may request the same dates.
2. **Provider inbox.** `/provider/bookings` → open the request → **Accept** (reserves the dates: a `kind = booking` row in `vehicle_holds`, created in one transaction; overlapping requests are declined automatically) or **Decline** with a reason. Requests not answered within 24 h (`platform_settings.provider_response_hours`) expire — run the worker (`pnpm dev:worker`) for the minute-by-minute sweep.
3. **Advance payment.** The customer's booking page shows the split (rental total, advance = 10 % to pay online, balance at pickup, refundable deposit) and **Pay advance securely** (`POST /bookings/{id}/payments/checkout`, amount decided by the server). The browser is handed to the gateway (locally: the fake gateway page served by the API, see [Payments](#payments-local)); the gateway notifies the API server-to-server, the API verifies the signature and confirms the booking in one transaction, and the browser lands on `/bookings/[id]/payment`, which polls until the verified result is in. Both sides are e-mailed; the customer now sees the exact pickup address and can reveal the provider's phone / e-mail / WhatsApp link, and vice versa. An accepted booking whose advance is not paid within 24 h (`payment_window_hours`) expires and frees the dates.
4. **Pickup and return.** The provider records the handover (odometer, fuel, note → `active`) and later the return (→ `completed`; the hold stays as history). After the pickup time plus 3 h a confirmed booking can be marked **no-show**.
5. **Cancellation.** Customers can cancel while requested / accepted / confirmed, providers while accepted / confirmed; the hold is released immediately. After the advance was paid: provider cancellation → full advance refund due; customer cancellation at least 48 h before pickup (`platform_settings.cancellation_full_refund_hours`) → full refund due; later → advance forfeited. Refunds are processed by the team and recorded by an admin (never automatic).

Everything a booking goes through is visible in its timeline (`booking_events`, append-only) on all three booking pages.

## Payments (local)

Phase 7 collects only the **advance** (10 % of the rental, `platform_settings.advance_percentage`) online; the balance and the refundable deposit are paid to the provider at pickup (TECH_DECISIONS D8, D53–D56). All gateway code lives in `apps/api/src/modules/payments` behind `PaymentGateway`; card data never reaches the platform.

- **Fake gateway (default).** With `PAYMENT_GATEWAY=fake` the **Pay advance securely** button posts the server-signed checkout fields to `POST /payments/fake/checkout`, a page served by the API that stands in for PayHere's hosted checkout. **Pay successfully** / **Cancel payment** / **Simulate a failed payment** send a correctly signed, PayHere-shaped notification through the real `POST /payments/payhere/notify` code path and redirect the browser to `/bookings/[id]/payment`. No credentials, no network, no card data. The fake routes answer `404` whenever the fake gateway is not active, and the environment schema refuses the fake gateway in production.
- **PayHere sandbox.** Set `PAYMENT_GATEWAY=payhere`, `PAYHERE_ENVIRONMENT=sandbox`, the sandbox `PAYHERE_MERCHANT_ID` / `PAYHERE_MERCHANT_SECRET` (merchant portal; the secret is bound to the registered domain) and a **publicly reachable** `PAYHERE_NOTIFY_URL` (for example a `cloudflared` / `ngrok` tunnel in front of `http://localhost:4000/api/v1/payments/payhere/notify`). Without a public callback PayHere cannot confirm anything. This has **not** been executed for this repository yet (no merchant account); see ROADMAP Phase 7.
- **What a verified success does.** In one transaction: payment `paid` (gateway payment id, status code, method), booking `accepted → confirmed` (`confirmation_source = payment`), `booking_events` + `audit_events` rows, confirmation e-mails. Replays are acknowledged and logged without side effects; forged or mismatched messages never touch the booking and are visible in `payment_events`. A payment that arrives after the booking expired or was cancelled is recorded as `paid` with a `late_success` anomaly and a refund due.
- **Admin.** `/admin/bookings/[id]` shows every attempt (order id, gateway payment id, amount, status, anomaly, audit trail) with **Record refund** (manual: PayHere-portal or bank-transfer reference; gateway: Refund API when `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` are set), **Mark resolved** and **Check with gateway** (Retrieval API; `503` without credentials). `/admin/payments` lists everything flagged for manual resolution.

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

Phase 4 suites (`provider-locations`, `provider-vehicles`, `admin-vehicle-review`, `vehicle-availability`) build on the same helpers; the availability suite also fires two concurrent inserts at the `vehicle_holds` exclusion constraint to prove overlaps cannot both succeed.

Phase 5 suites: `vehicle-photos` (real images generated with sharp, EXIF stripping, variants, limits, ownership — against the in-memory storage provider) and `public-search` (searchable condition, filters, PostGIS radius, holds, boundaries, pagination, sorting, slug detail, place suggest and a privacy scan of the raw JSON). The real MinIO path is exercised by the Phase 5 smoke test.

Phase 6 suites: `bookings` (quotes and tokens, request creation without a hold, validation of client prices / dates / stale quotes, idempotency incl. three parallel identical requests, accept with auto-decline, privacy and access scoping, the admin testing confirmation, contact reveal, pickup / return, decline, cancellation, expiry with an injected clock, no-show, lists, OpenAPI, the append-only trigger) and `bookings-concurrency` (parallel accepts, triple-click, accept vs concurrent block, block before accept, adjacent half-open windows, re-use after cancellation — all as real parallel HTTP requests against the database). Unit tests cover the state machine, the quote token service, booking references and the e-mail templates. E-mail assertions use `takeAllEmails` + `findEmail` when one action mails several recipients (the queue is FIFO and `takeEmailFor` drains it).

Phase 7 suites: `payments` (money split on quotes and bookings; checkout ownership, state, deadline and reuse; forged, mismatched and unknown notifications; exactly-once confirmation under three parallel deliveries plus replays and a stale failure; failed and cancelled attempts with retry; expiry cancelling pending attempts and a late success recorded as an anomaly; the cancellation refund rule; admin refund / resolve / reconcile; OpenAPI; the append-only trigger). The `bookings` suite now confirms through the fake gateway (`payAdvance` in `test/utils/payment-helpers.ts`). Unit tests cover the PayHere checkout hash and `md5sig` with vectors in the documented format, notification parsing and status mapping, the state machine's `confirm` / `pay` rules and the money helpers. The test runner sets `PAYMENT_GATEWAY=fake`; runs against the PayHere sandbox are manual and need credentials plus a public `notify_url`.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint → build → typecheck → migrate + seed → test → format check against a PostGIS service container. It needs no secrets. Deployment is intentionally not configured yet (see `docs/ARCHITECTURE.md` §13 for the planned hosting).

## Troubleshooting

- **`pnpm install` complains about ignored build scripts** — the allow-list lives in `pnpm-workspace.yaml` (`allowBuilds`). Run `pnpm approve-builds <pkg>` (or `'!<pkg>'` to deny) to extend it.
- **Port 5432 / 1025 / 8025 already in use** — set `DB_PORT`, `MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT` in `.env` and start with `docker compose --env-file .env -f infra/docker-compose.yml up -d`, then update `DATABASE_URL*` / `SMTP_PORT`.
- **`/ready` reports `migrations: down`** — run `pnpm db:migrate`.
- **No verification e-mail arrives** — the worker must be running (`pnpm dev:worker`); check Mailpit at <http://localhost:8025> and the worker log.
- **`pnpm admin:grant` refuses** — the e-mail must belong to an existing, active user whose e-mail is verified (register and verify first). Running it again for the same user is safe.
- **Photo upload fails with a storage error** — MinIO must be running (`pnpm db:up`; console at <http://localhost:9001>, `minioadmin` / `minioadmin`). The API logs "Object storage ready" at startup after creating the `vrp-private` and `vrp-public` buckets. Photos are not served if `STORAGE_PUBLIC_URL` does not match how the browser reaches MinIO.
- **The map does not load** — results and listing pages work without it; check `NEXT_PUBLIC_MAP_STYLE_URL` (any MapLibre style JSON URL) and network access to the tile host.
- **"JWT_PRIVATE_KEY … not set" warning** — expected locally; generate keys with `pnpm --filter @vrp/api keys:generate` for stable tokens across restarts.
- **Test database missing** (older Docker volume) — `docker exec vehicle-rental-db psql -U postgres -c "CREATE DATABASE vehicle_rental_test;"`.
- **"Pay advance securely" lands on a 404** — the fake gateway routes exist only while `PAYMENT_GATEWAY=fake` (never in production); the checkout URL is built from `API_PUBLIC_URL`, which must be how the browser reaches the API.
- **A PayHere sandbox payment never confirms** — PayHere must reach `PAYHERE_NOTIFY_URL` from the internet; check the tunnel, then `payment_events` (`signature_valid`, `metadata.reason`) and the API log line `Payment notification rejected`. The browser's return URL never confirms a booking.
- **A payment sits under `/admin/payments`** — it needs a human: a late or duplicate success (refund due), an amount mismatch, or a refund owed after a cancellation. Record the refund or mark it resolved; nothing is refunded automatically.
