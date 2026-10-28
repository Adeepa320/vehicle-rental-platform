# Vehicle Rental Platform

Sri Lankan online vehicle-rental marketplace: _search nearby vehicles → see real availability → compare transparent prices → trust verified providers → book_. Launching on the South Coast (Matara, Weligama, Mirissa, Galle, Unawatuna).

The product, architecture and roadmap are documented in [`docs/`](docs/) — start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md). Development rules for AI-assisted sessions are in [CLAUDE.md](CLAUDE.md).

**Current state: Phase 10 (Testing, security & production readiness) implemented locally, pending review; Phases 0–9 approved.** Accounts and sessions (Phase 2), reviewed provider onboarding (3), locations / listings / availability (4), public search with photos and maps (5), the request-to-book lifecycle (6), the online advance through PayHere's hosted checkout with a local fake gateway (7), reviews, in-app notifications and reminders (8), the operator console — users, private verification documents, listing moderation, booking operations, disputes, settings, reference data, audit log and reports (9) — and the production-readiness layer: admin two-factor authentication, hardened headers and environment rules, data-subject export and deletion requests, legal drafts, retention sweep, observability, container images, runbooks, security self-assessment, browser end-to-end and load tests (10). Everything runs locally; no paid services are required. Vendor accounts, domains, PayHere certification and legal approval are **EXTERNAL GATE — NOT EXECUTED** (`docs/runbooks/GO_LIVE_CHECKLIST.md`).

## Repository layout

```
apps/
  api/        NestJS modular monolith: REST API (/api/v1) and background worker entrypoint
  web/        Next.js App Router web client (Tailwind CSS, shadcn/ui)
  e2e/        Playwright browser suite (Chromium) against the built web app, API and worker (Phase 10)
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
- **Admin console** → `/admin` (overview, users, providers, vehicles, bookings, payments, reviews, disputes, documents, reports, reference data, settings, audit log). `pnpm admin:grant --email …` makes an `admin`; `--role super_admin` additionally unlocks settings and reference data. See "Phase 9 — operating the marketplace" below.
- <http://localhost:4000/api/docs> — Swagger UI generated from the shared Zod contracts (`/api/docs-json` for the document).
- `GET /api/v1/health` (liveness) and `GET /api/v1/ready` (readiness: database, PostGIS, migrations).

Without `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` the API generates an ephemeral signing key pair at startup (fine locally; sessions survive restarts through the refresh cookie). For a stable key pair run `pnpm --filter @vrp/api keys:generate` and paste the output into `.env`.

## Everyday commands

| Command                                                                                                 | What it does                                                                                                                         |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm dev`                                                                                              | Web + API in watch mode (Turborepo)                                                                                                  |
| `pnpm dev:worker`                                                                                       | Worker process (pg-boss queue; delivers `email.send` jobs)                                                                           |
| `pnpm admin:grant --email <email> [--role admin]`                                                       | Grant `admin` (or `super_admin`) to an existing, active, verified user; audited and idempotent                                       |
| `pnpm build`                                                                                            | Production builds for every package and app                                                                                          |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`                                                            | Quality gates (run before handing over work)                                                                                         |
| `pnpm check`                                                                                            | lint + typecheck + test + build in one go                                                                                            |
| `pnpm format` / `pnpm format:check`                                                                     | Prettier                                                                                                                             |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:logs`                                                          | Manage the Docker services                                                                                                           |
| `pnpm db:migrate`                                                                                       | Apply pending SQL migrations to `DATABASE_URL`                                                                                       |
| `pnpm db:seed`                                                                                          | Idempotent reference-data seed (districts, places, categories, settings)                                                             |
| `pnpm db:generate`                                                                                      | Generate a new migration from schema changes (see below)                                                                             |
| `pnpm --filter @vrp/api keys:generate`                                                                  | Print an Ed25519 key pair for `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                                                                   |
| `pnpm admin:mfa-report [--strict] [--json]`                                                             | List privileged accounts and whether each has a confirmed authenticator (Phase 10)                                                   |
| `pnpm admin:mfa-reset --email <email> --reason …`                                                       | Remove a lost authenticator, sign the account out everywhere, audit `mfa.reset` (Phase 10)                                           |
| `pnpm production:check --env-file <file> [--web-env-file <file>] [--live] [--json]`                     | Validate a production configuration without printing values; `--live` adds read-only connectivity checks                             |
| `pnpm retention:preview [--apply]`                                                                      | Dry run (default) or run the retention sweep now (Phase 10); runs from the API build (`pnpm build` first)                            |
| `pnpm smoke:phase10`                                                                                    | Phase 10 integrated release smoke against the built stack (`pnpm db:up && pnpm build` first); exit 0 only if all 93 steps pass       |
| `SMOKE_WEB_URL=… SMOKE_API_URL=… pnpm smoke:staging`                                                    | Non-destructive HTTP smoke against a deployed staging (no accounts, data or payments); see `docs/runbooks/STAGING_DEPLOYMENT.md` §11 |
| `pnpm supply:report [--json] [--strict]`                                                                | Real-supply readiness against the 20–40 vehicle launch target; prints the business go-live gate                                      |
| `pnpm perf:seed [--drop]` / `pnpm perf:load --scenario search\|booking\|conflict` / `pnpm perf:explain` | 10,000-listing performance dataset (isolated database), load scenarios, `EXPLAIN ANALYZE`                                            |
| `pnpm demo:seed [--reset]` / `pnpm demo:dev` / `pnpm demo:worker`                                       | Fictional local demo (providers, listings, licensed photos) in its own `vehicle_rental_demo` database; see "Local realistic demo"    |
| `pnpm legal:render`                                                                                     | Regenerate `docs/legal/*_DRAFT.md` from the typed legal content (CI fails on drift)                                                  |
| `pnpm e2e`                                                                                              | Playwright browser suite (`apps/e2e`; starts the built API, worker and web app — run `pnpm build` first)                             |

## Environment variables

Root `.env` (copied from [`.env.example`](.env.example)) is read by Docker Compose defaults, the database scripts, the API and the worker:

| Variable                                                                                                    | Default                                                                    | Used by                                     |
| ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT`                                           | `postgres` / `postgres` / `vehicle_rental` / `5432`                        | Docker Compose                              |
| `MAILPIT_SMTP_PORT` / `MAILPIT_UI_PORT`                                                                     | `1025` / `8025`                                                            | Docker Compose                              |
| `MINIO_PORT` / `MINIO_CONSOLE_PORT` / `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`                             | `9000` / `9001` / `minioadmin` / `minioadmin`                              | Docker Compose (dev only)                   |
| `DATABASE_URL`                                                                                              | `postgresql://postgres:postgres@localhost:5432/vehicle_rental`             | database scripts, API, worker               |
| `DATABASE_URL_TEST`                                                                                         | `…/vehicle_rental_test`                                                    | automated tests                             |
| `NODE_ENV`                                                                                                  | `development`                                                              | API, worker                                 |
| `API_PORT` / `API_HOST`                                                                                     | `4000` / `0.0.0.0`                                                         | API                                         |
| `CORS_ORIGINS`                                                                                              | `http://localhost:3000`                                                    | API (CORS and CSRF origin check)            |
| `WEB_APP_URL`                                                                                               | `http://localhost:3000`                                                    | API (links in e-mails)                      |
| `LOG_LEVEL`                                                                                                 | `debug`                                                                    | API, worker                                 |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX`                                                                 | `60` / `300`                                                               | API                                         |
| `AUTH_LOGIN_LIMIT_PER_MINUTE` / `AUTH_SENSITIVE_LIMIT_PER_15MIN` / `AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN` | `10` / `5` / `3`                                                           | API                                         |
| `JWT_ISSUER` / `JWT_AUDIENCE`                                                                               | `vrp-api` / `vrp`                                                          | API                                         |
| `JWT_PRIVATE_KEY` / `JWT_PUBLIC_KEY`                                                                        | _(unset → ephemeral pair; required in production)_                         | API                                         |
| `ACCESS_TOKEN_TTL_SECONDS` / `REFRESH_TOKEN_TTL_DAYS`                                                       | `900` / `30`                                                               | API                                         |
| `COOKIE_SECURE` / `COOKIE_DOMAIN`                                                                           | _(secure in production)_ / _(unset)_                                       | API                                         |
| `EMAIL_VERIFICATION_TTL_HOURS` / `PASSWORD_RESET_TTL_MINUTES`                                               | `24` / `30`                                                                | API                                         |
| `ARGON2_MEMORY_KIB` / `ARGON2_TIME_COST`                                                                    | `65536` / `3`                                                              | API                                         |
| `EMAIL_PROVIDER`                                                                                            | `smtp` (`memory` for tests)                                                | API, worker                                 |
| `EMAIL_FROM` / `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS`                        | Mailpit defaults                                                           | worker                                      |
| `OPENAPI_ENABLED`                                                                                           | `true` outside production                                                  | API                                         |
| `PGBOSS_SCHEMA`                                                                                             | `pgboss`                                                                   | API, worker                                 |
| `OPERATOR_NOTIFICATION_EMAIL`                                                                               | _(unset → no operator notice)_                                             | API (e-mail on application submit)          |
| `STORAGE_PROVIDER` / `STORAGE_ENDPOINT` / `STORAGE_REGION`                                                  | `s3` / `http://localhost:9000` / `us-east-1`                               | API (photos; `memory` in tests)             |
| `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`                                                                 | `minioadmin` / `minioadmin` (refused in production)                        | API                                         |
| `STORAGE_BUCKET_PRIVATE` / `STORAGE_BUCKET_PUBLIC` / `STORAGE_PUBLIC_URL`                                   | `vrp-private` / `vrp-public` / `http://localhost:9000/vrp-public`          | API (variant URLs)                          |
| `STORAGE_FORCE_PATH_STYLE` / `STORAGE_AUTO_CREATE_BUCKETS`                                                  | `true` / `true` outside production                                         | API                                         |
| `BOOKING_QUOTE_SECRET`                                                                                      | _(unset → per-process secret; required in production, ≥ 32 chars)_         | API (signed quote tokens)                   |
| `BOOKING_QUOTE_TTL_MINUTES`                                                                                 | `15`                                                                       | API                                         |
| `THREAD_POSTS_PER_15MIN`                                                                                    | `30`                                                                       | API (dispute open / message posts per IP)   |
| `LAUNCH_MODE`                                                                                               | `staging` (`production` requires live PayHere)                             | API (Phase 10 go-live rules)                |
| `TRUST_PROXY_HOPS`                                                                                          | `0` (1 behind Railway, 2 behind Cloudflare + Railway)                      | API (client IP from forwarded headers)      |
| `HSTS_ENABLED`                                                                                              | `true` in production                                                       | API                                         |
| `ADMIN_MFA_REQUIRED` / `MFA_ISSUER`                                                                         | `true` in production (cannot be `false` there) / `Vehicle Rental Platform` | API (admin TOTP, Phase 10)                  |
| `APP_DATA_ENCRYPTION_KEY` / `APP_DATA_ENCRYPTION_KEY_PREVIOUS`                                              | documented development key (refused in production) / _(unset)_             | API (AES-256-GCM envelopes, MFA secrets)    |
| `SMTP_REQUIRE_TLS`                                                                                          | `true` in production                                                       | worker (STARTTLS when `SMTP_SECURE=false`)  |
| `SENTRY_DSN` / `APP_RELEASE`                                                                                | _(unset → error reporting off)_ / _(unset)_                                | API, worker (envelope error reporter, logs) |

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

| Variable                                                          | Default                                                   | Used by                                                                                                             |
| ----------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                                             | `http://localhost:4000/api/v1`                            | browser                                                                                                             |
| `API_INTERNAL_URL`                                                | `http://localhost:4000/api/v1`                            | server rendering                                                                                                    |
| `NEXT_PUBLIC_MAP_STYLE_URL`                                       | `https://tiles.openfreemap.org/styles/liberty`            | browser (MapLibre style; free, no key)                                                                              |
| `NEXT_PUBLIC_WEB_URL`                                             | `http://localhost:3000`                                   | metadata, `robots.txt`, `sitemap.xml` (Phase 10)                                                                    |
| `NEXT_PUBLIC_IMAGE_ORIGINS` / `NEXT_PUBLIC_MAP_ORIGINS`           | `http://localhost:9000` / `https://tiles.openfreemap.org` | Content-Security-Policy `img-src` / `connect-src` (comma-separated origins; the style URL's origin is always added) |
| `NEXT_PUBLIC_SUPPORT_EMAIL` / `NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL` | `support@localhost` / `privacy@localhost`                 | footer and legal pages; required by `production:check`                                                              |

`.env.example` is grouped **Local / Staging / Production** and holds placeholders only; `pnpm production:check --env-file <file>` tells you what a production file is missing without printing any value. SMS variables do not exist (SMS is deferred).

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

## Reviews, notifications and reminders (local)

Phase 8 closes the trust loop (TECH_DECISIONS D57–D60): a completed rental can be reviewed, every lifecycle step also lands in an in-app feed, and three reminders are sent by the worker.

1. **Review.** After the provider records the return, the customer's booking page shows **Leave a review** (`/bookings/[id]/review`: overall stars, optional sub-ratings, comment). The review is published immediately under "First name L.", the provider is notified and can **Reply** once from `/provider/reviews`, and the vehicle page shows the average and the list. Reviews can be edited while the review window (`platform_settings.review_window_days`, 14 days) is open. Admins hide (reason required) or unhide from `/admin/reviews`; both are audited and e-mailed to the customer.
2. **Notifications.** The bell in the header polls `GET /notifications/unread-count`; `/notifications` lists the feed with mark-read and mark-all-read. Rows are written in the same database transaction as the e-mails, so what you see in Mailpit is what the feed shows.
3. **Reminders.** The worker (`pnpm dev:worker`) runs `reminders.sweep` every minute: one payment reminder 6 h before the payment deadline (`payment_reminder_hours_before`), one pickup reminder 24 h before pickup to both parties (`pickup_reminder_hours_before`), one review reminder 3 days after completion when no review exists (`review_reminder_days_after`). Each reminder is deduplicated at the database (`notifications.dedupe_key`), so restarting the worker never resends. To try one locally, move the booking's `confirm_by` / `starts_at` with `psql` and watch the next sweep.
4. **Provider metrics** appear on the provider dashboard and the public provider card: completed rentals, acceptance rate and typical response time (percentages only from 3 decided requests), plus the rating.
5. **Tourist guidance** (licence requirements, IDP + recognition permit, deposits) is shown on the vehicle page, the booking form and accepted / confirmed bookings. It is informational; items marked "confirm before travelling" await operator / legal confirmation.
6. **Indicative currency.** Set `platform_settings.indicative_exchange_rates` to `{ "asOf": "2026-10-13T00:00:00Z", "source": "…", "rates": { "USD": 0.0033 } }` (units of foreign currency per LKR) and users whose display currency is not LKR see "≈ USD …" next to prices. Nothing is converted for quotes or payments; no FX feed is called.
7. **SMS is not sent.** The texts for the time-critical events live in `apps/api/src/modules/notifications/email/sms-templates.ts`; a gateway and a registered sender id are a production decision.

## Phase 9 — operating the marketplace (local)

Phase 9 makes the console sufficient to run the marketplace without an engineer (TECH_DECISIONS D61–D66; procedures in [docs/OPERATIONS_RUNBOOK.md](docs/OPERATIONS_RUNBOOK.md)). **Roles:** `admin` (created with `pnpm admin:grant --email you@example.com`) operates users, providers, listings, bookings, payments, disputes, reviews, documents, reports and reads the audit log; `super_admin` (`pnpm admin:grant --email you@example.com --role super_admin`) additionally changes settings and reference data. Every mutating action writes an `audit_events` row in the same transaction and asks for a reason where it affects a person, listing or booking; the API validates all of it regardless of the UI.

1. **Overview.** `/admin` shows the queues as counts with links: applications and listings awaiting review, documents pending / expiring / expired, open disputes, payments needing a human, refunds due, accepted bookings awaiting payment, pickups today, no-show candidates, recent cancellations, hidden reviews, suspended users / providers / listings.
2. **Users.** `/admin/users` (search by e-mail or name; filters) → `/admin/users/[id]`. **Suspend** (reason) revokes every session and refresh token at once — the user's next request fails with `403 ACCOUNT_SUSPENDED` — and e-mails them; **Reactivate** reverses it. **Anonymise** (reason + typing the account e-mail) is refused while the user has an open booking, an open dispute, an unresolved payment or a refund due, or is an admin; otherwise the account becomes "Deleted user" with a non-deliverable e-mail, driver snapshots read "Former customer", an owned provider profile is scrubbed and suspended, and bookings / payments / reviews keep their history. Irreversible.
3. **Documents.** A provider uploads at `/provider/documents`: an identity document (and business registration for a registered business) plus, per vehicle, the certificate of registration, revenue licence, insurance certificate and optionally the emission certificate (PDF / JPEG / PNG by content, ≤ 10 MB, with document number and dates; a new upload supersedes the previous one of the same type). Admins review at `/admin/documents` (filters: status incl. the derived `expired` / `superseded`, scope, provider, expiring within _n_ days): **Open** streams the file as a download (every admin view is audited — there are no shareable links), then **Approve** (optionally setting the expiry), **Reject** (reason) or **Request replacement** (reason; the current document stays valid). "Verified vehicle" appears publicly only while CR + revenue licence + insurance are approved and in date, "Verified provider" only while the identity document (and business registration) is; otherwise the badge stays "Platform-approved provider". Documents are not required for approval or searchability.
4. **Document expiry sweep.** The worker (`pnpm dev:worker`) runs `documents.expiry-sweep` once a day at 01:00 UTC (06:30 Colombo): one reminder per 30 / 14 / 7 / 0-day threshold (in-app + e-mail, deduplicated at the database) and, on the expiry day, if `platform_settings.auto_pause_on_document_expiry` is `true` and the revenue licence or insurance lapsed, the listing is paused by the system (audit `vehicle.auto_paused`; bookings are never cancelled). To try it locally, set a document's `expires_on` to today with `psql` (`update verification_documents set expires_on = current_date where id = '…'`) and either wait for the schedule or restart the worker, which runs the sweep on the next tick; then approve the renewed document and **Reactivate** the listing from `/admin/vehicles/[id]`.
5. **Listings.** `/admin/vehicles` searches by text, category and place. `/admin/vehicles/[id]` has an operations panel (publicly searchable and why not, photo count, documents, open bookings, auto-pause / suspension reason) with **Pause** (reason), **Reactivate** (refused with a list unless the provider is active, the listing has ≥ 3 photos and no revenue licence / insurance is expired), **Correct category** (an active category, reason) and **Remove photo** (reason; a live listing that drops below 3 photos goes back to `changes_requested` for the provider to fix). Scooter and tuk-tuk cannot be activated from the console until the product decision is made. Admins never edit prices or other provider-controlled fields.
6. **Bookings.** `/admin/bookings` searches by partial reference, customer name / e-mail, vehicle, provider, status and a rental period. On `/admin/bookings/[id]`, **Cancel** first shows a preview for the chosen actor — on behalf of the customer (full refund only ≥ `cancellation_full_refund_hours` before pickup, otherwise the advance is forfeited), on behalf of the provider (full refund) or by the platform (full refund, status `cancelled_by_platform`) — then cancels through the state machine with a reason; an active rental cannot be cancelled (the provider records the return). Any refund due lands under `/admin/payments` and is recorded by hand (Phase 7); nothing is refunded automatically. **Resend** re-sends one of the lifecycle e-mails that fit the current state (confirmation, payment reminder, pickup reminder, cancellation notice, review request). There is no way to confirm a booking from the console: only a verified gateway notification does that.
7. **Disputes.** A customer opens one from `/bookings/[id]/dispute`, a provider from `/provider/bookings/[id]/dispute` (reason + description) within `dispute_window_days` (14) of completion / no-show / cancellation; one per booking; both parties can post in the thread. Admins work `/admin/disputes` → `/admin/disputes/[id]`: **Start review**, public **Message** (both parties notified), private **Internal note**, **Resolve** (resolution code + public note) or **Reject** (public note). A resolution never moves money — `refund_recommended` means "go to `/admin/payments` and record the refund".
8. **Settings.** `/admin/settings` (super admin to save) edits the typed allow-list: response / payment / no-show windows, contact reveal stage, cancellation threshold, search radius, review and dispute windows, reminder lead times, auto-pause, the money pair and the indicative exchange rates. High-impact keys need a reason; a stale edit (someone saved first) is refused with `409 SETTING_STALE` — reload and retry. **Money pair rule:** `advance_percentage` must equal `default_commission_rate` (change both in the same save), otherwise `409 SETTING_MONEY_MODEL_UNSUPPORTED` and nothing is saved. Changes apply to new bookings / decisions only; existing bookings keep their price and advance snapshot.
9. **Reference data.** `/admin/reference` (super admin to edit) activates or deactivates districts, creates and edits places (town centres with a default radius, aliases, launch-area flag) and edits categories. Nothing is deleted: an inactive place disappears from suggestions and new provider locations while existing locations and bookings stay intact.
10. **Audit log.** `/admin/audit` lists `audit_events` (filters by actor, action prefix, target and time); metadata is scrubbed of secret-like keys and IPs are not shown. Read-only.
11. **Reports.** `/admin/reports` computes a Colombo date range live: booking funnel, status counts, GMV, advances / refunds / refund due / anomalies and an _estimated_ platform revenue, supply and demand (bookings by place and category, searches and zero-result searches from `search_logs`, which stores criteria only — never IPs or users), operations and a per-provider table. **Export CSV** for the overview, the providers and the zero-result searches (cells are formula-escaped for spreadsheets). There are no settlements or payouts: under the current money model the platform holds only its commission.

## Phase 10 — production readiness (local)

Phase 10 hardens what exists without changing the product (TECH_DECISIONS D67–D73; [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md), [docs/security/](docs/security/), [docs/runbooks/](docs/runbooks/), [docs/legal/](docs/legal/)). Everything below runs locally; nothing needs a vendor account.

1. **Admin two-factor authentication.** Locally the policy is off by default; set `ADMIN_MFA_REQUIRED=true` in `.env` to try it. Sign in as an admin → the console redirects to `/account/security` → **Set up authenticator** (password → QR code / secret, shown once → confirm with a code → eight recovery codes, shown once). Next login: e-mail + password, then the 6-digit code (or a recovery code). Five wrong codes lock the factor for 15 minutes. `pnpm admin:mfa-report` lists who is enrolled; `pnpm admin:mfa-reset --email … --reason …` removes a lost authenticator (audited, signs out everywhere). Secrets are stored only as AES-256-GCM envelopes under `APP_DATA_ENCRYPTION_KEY`; recovery codes only as hashes.
2. **Privacy requests.** `/account/privacy`: **Download my data** (allow-listed JSON, `GET /users/me/export`) and **Request account deletion** (type the e-mail; `202`; the request is a record, nothing is deleted). Admins work the queue at `/admin/privacy-requests`: record a request on someone's behalf, start review, internal note, export for an access request, **Complete deletion** (runs the Phase 9 anonymisation with all its blockers), reject. All audited; the user is notified at each step.
3. **Legal pages.** `/privacy`, `/terms`, `/cancellation-policy` render the typed drafts from `packages/contracts/src/legal/content/` with a draft banner and highlighted `[PLACEHOLDER: …]` / `[LEGAL REVIEW REQUIRED]` markers; in production they are withheld (404) until a document is `approved` with no markers. Edit the TypeScript source, run `pnpm legal:render`, and commit the regenerated `docs/legal/*_DRAFT.md` (CI fails on drift).
4. **Retention sweep.** The worker runs `retention.sweep` daily at 02:00 UTC; periods are super-admin settings in the **Retention** group of `/admin/settings` (rejected documents 30 days, superseded 90 days, search logs 400 days, driver snapshots off). `pnpm retention:preview` (after `pnpm build`) shows what the next run would delete; `--apply` runs it now. Each run writes `audit_events` `retention.sweep_completed`.
5. **System page.** `/admin/system` (`GET /admin/system/worker`) shows the worker heartbeat (the minute sweep), registered schedules and per-queue counts. Stop the worker and watch it turn unhealthy after three minutes.
6. **Security headers.** The API answers with a strict CSP, HSTS (production), no-referrer and frame deny; the web app sets a nonce-based CSP per request in `apps/web/src/proxy.ts` (`pnpm --filter @vrp/web test` covers the exact header strings). Client IPs behind a proxy come from `TRUST_PROXY_HOPS`.
7. **Production configuration check.** Copy the Production block of `.env.example` to a file, fill it, then `pnpm production:check --env-file that-file --web-env-file apps/web/.env.production`. It prints PASS / WARN / FAIL per variable and exits 1 on any FAIL; `--live` additionally runs read-only connectivity checks (database and migrations, both buckets, SMTP verify, MFA report).
8. **Container images.** From the repository root: `docker build -f apps/api/Dockerfile -t vrp-api .` (API, worker `node dist/worker.js`, migrator `node node_modules/@vrp/database/dist/migrate.js`) and `docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_API_URL=… --build-arg NEXT_PUBLIC_WEB_URL=… --build-arg NEXT_PUBLIC_IMAGE_ORIGINS=… --build-arg NEXT_PUBLIC_MAP_ORIGINS=… -t vrp-web .`. Both run as the `node` user and contain no `.env`. Release and rollback sequence: `docs/DEPLOYMENT.md` §4–5.
9. **Performance dataset.** `pnpm perf:seed` creates an isolated `vehicle_rental_perf` database with 400 providers and 10,000 approved listings; start an API against it (`DATABASE_URL=…/vehicle_rental_perf API_PORT=4100 pnpm --filter @vrp/api start`) and run `pnpm perf:load --scenario search --base-url http://localhost:4100/api/v1` (also `booking`, `conflict`) and `pnpm perf:explain`. Phase 10 results (laptop): search p95 476 ms at 10 concurrent workers (281 ms on the 2026-10-18 re-run); conflict drill 1 accepted / 24 × 409.
10. **Supply readiness.** `pnpm supply:report` counts active providers, approved and searchable vehicles, document-verified listings and the launch towns covered, and prints `BUSINESS GO-LIVE GATE — MET` or `— NOT MET` against the 20–40 vehicle target.
11. **Browser suite.** `pnpm build && pnpm e2e` starts the built web app, API and worker (fake gateway, Mailpit, MinIO) and runs the Playwright suite in `apps/e2e`: customer, provider and admin happy paths, key failures, account security (password change) and axe accessibility checks (31 tests, about 2–3 minutes). It drives the installed Google Chrome by default (`PLAYWRIGHT_CHANNEL=msedge` for Edge; an empty `PLAYWRIGHT_CHANNEL=` uses Playwright's bundled Chromium after `pnpm --filter @vrp/e2e install:browsers`). Details and the console / accessibility policy: `apps/e2e/README.md`.
12. **Backup drill.** `docs/runbooks/BACKUP_AND_RESTORE.md` §4 restores a `pg_dump` of the development database into `vehicle_rental_restore_drill` and compares counts (run 2026-10-18; see the log in §7).

## Local realistic demo

A believable marketplace for visual review, completely separate from test data:

```bash
pnpm db:setup      # local services, migrations and reference data (once)
pnpm demo:seed     # creates / tops up the vehicle_rental_demo database
pnpm demo:dev      # web (http://localhost:3000) + API against the demo database
pnpm demo:worker   # second terminal: the worker against the demo database
```

- **Fictional data.** Six invented South Coast rental businesses and their listings (`apps/api/scripts/demo/demo-data.ts`): no real people or businesses, contact numbers in the unassignable `+94 11 0000 xxx` range, `@demo.vrp.invalid` accounts with a random password that is never printed (use "Forgot password" + Mailpit at http://localhost:8025 to look around as a demo provider). Prices are demo values, not market data. No bookings, payments or reviews are fabricated; listings show "No reviews yet".
- **Separate from E2E data.** The browser suite (`pnpm e2e`) and the smoke scripts write to the development database (`vehicle_rental`); the demo lives in its own database, so neither ever sees the other. Your own local accounts stay in `vehicle_rental` (register again in the demo if you want to try a booking there).
- **Licensed photos.** Demo photography is from Unsplash / Pexels under their free licences, stored in `apps/api/scripts/demo/photos` and uploaded through the API's own photo pipeline (re-encoded, EXIF/GPS stripped, WebP variants, originals in the private bucket). Source, photographer and licence of every file: [docs/DEMO_ASSETS.md](docs/DEMO_ASSETS.md).
- **One stack at a time.** The demo uses the same ports and build folders as `pnpm dev` / `pnpm dev:worker`: stop those first (`demo:dev` refuses to start while ports 3000 / 4000 are in use).
- **Local only.** `demo:seed` and the `demo:*` launchers refuse `NODE_ENV=production`, any `LAUNCH_MODE`, and non-`localhost` database or storage hosts; production and staging never run them (the scripts are not in the images).
- **Reset.** `pnpm demo:seed --reset` deletes the demo photos from MinIO, drops `vehicle_rental_demo` and seeds it again. It never touches `vehicle_rental` or `vehicle_rental_test`.
- **Old E2E records in the development database.** They are not deleted automatically (they include bookings, payments, audit events and anonymised accounts that cannot be attributed safely). If you do not need anything in `vehicle_rental`, including your own local accounts, you can start it from scratch: `pnpm db:down`, `docker volume rm vehicle-rental_db-data`, then `pnpm db:setup` (this deletes **all** local development data).

## Staging (go-live Step 1)

Staging runs the Phase 10 images in production mode with `LAUNCH_MODE=staging` on Railway + Neon (TECH_DECISIONS D10, D77). The operator procedure, variable matrix, cost, dashboard steps, rollback and teardown are in [docs/runbooks/STAGING_DEPLOYMENT.md](docs/runbooks/STAGING_DEPLOYMENT.md). A production-mode API and worker start only with real SMTP, S3 and PayHere **sandbox** credentials (there is no bypass), and sign-in needs the staging web and API on one registrable domain. After a deploy, run `pnpm smoke:staging` against the public URLs. No staging resource exists yet.

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

Phase 8 suites: `reviews` (eligibility and ownership, validation and rejected client ids, one review per booking, edit inside / outside the window, provider reply rules, admin hide / unhide with audit and notifications, per-vehicle and per-provider aggregates with one-decimal rounding, keyset pagination, provider metrics incl. automatic-decline exclusion and the minimum sample, public JSON privacy scan, OpenAPI) and `notifications` (lifecycle rows with safe links and no payment data, feed scoping / pagination / idempotent read / read-all, link and metadata guards, payment / pickup / review reminders driven with an explicit `now` — threshold, once, retry-safe, not after payment, expiry, cancellation or a review). Unit tests cover the review mappers, the Phase 8 e-mail and SMS templates, the review / notification / guidance / currency contracts. The web suite covers the new client routes.

Phase 9 suites: `admin-users` (search / detail, suspend with session revocation, reactivate, anonymisation blockers and effects, self / admin protections), `admin-documents` (provider upload by content type and size, supersession, owner-only streaming, admin queue filters incl. derived statuses, approve / reject / request-replacement, audited reads, badges, the expiry sweep with an explicit `now` and auto-pause), `admin-listings` (text / category / place search, operations panel, pause, validated reactivation, category correction, photo removal back to `changes_requested`, protected categories), `admin-bookings-ops` (search filters, cancellation preview vs settlement, cancel on behalf of each actor and by the platform, the cancellation-vs-late-payment race in both orders, re-send allow-list, no confirmation route), `disputes` (eligibility and window, one per booking, participant scoping and privacy scan, append-only thread, admin review / messages / internal note / resolve / reject, rate limit), `admin-settings` (typed validation, stale token, high-impact reason, money-pair invariant, radius ordering, per-key audit, snapshots untouched), `admin-reference` (districts / places / categories, deactivate-not-delete, protected categories, no DELETE) and `admin-reports` (exact decimal deltas for funnel / GMV / money, zero-result searches, CSV format and formula escaping, privacy scan). Every suite asserts RBAC per route and the audit action / actor / target of each mutation. Unit: `csv.test.ts`.

Phase 10 suites: `admin-mfa` (enrolment with password check, one-time secret and recovery codes, the login challenge, replay refusal within a step, recovery-code login, lock after repeated wrong codes, the guard on admin routes, disable / regenerate, the 8-hour admin session class), `security-headers` (strict CSP, HSTS, frame deny, no-referrer, CORS for configured origins only incl. preflight and `null`, 413 on oversized JSON / form bodies, the `__Secure-` cookie prefix and clearing), `security-proxy` (trusted hops, client-prepended `X-Forwarded-For` ignored, `X-Real-IP`, socket fallback), `privacy` (export allow-list and attachment headers, deletion request and the duplicate guard, admin queue transitions, completion through the anonymisation blockers, rejection, audit rows) and `retention` (dry run vs apply, object-before-row for documents, driver-snapshot switch, bounded batches). Unit: `totp.test.ts` (RFC 6238 vectors, window, replay), `data-encryption.test.ts` (envelope format, AAD binding, previous-key rotation), `error-reporter.test.ts` (DSN parsing, event and envelope shape, no PII fields), `env.schema.test.ts` (a production golden configuration plus every rejection rule and the staging exception), the web `csp.test.ts` (exact header strings), and `legal.test.ts` in contracts (drift between the typed content and `docs/legal`). The browser suite lives in `apps/e2e` (`pnpm e2e`; Playwright + axe) and is not part of `pnpm test` because it builds and starts the full stack.

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint → build → typecheck → migrate + seed → test → format check → legal-text drift check → `pnpm audit --prod --audit-level high` → gitleaks (full history, `.gitleaks.toml` allow-list for test fixtures) against a PostGIS service container, then a second job builds the API / worker and web container images without pushing them. It needs no secrets. [`.github/dependabot.yml`](.github/dependabot.yml) proposes grouped dependency updates (npm weekly, GitHub Actions and Docker base images monthly; major framework versions excluded) once the repository is on GitHub; the remediation time frames are in `docs/SECURITY_AND_PRIVACY.md` §14. Deployment is intentionally not configured: the release procedure is written in `docs/DEPLOYMENT.md` and waits for the external gates in `docs/runbooks/GO_LIVE_CHECKLIST.md`.

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
- **No reminder arrives** — the worker must be running; reminders fire on the minute sweep only inside their window (6 h before the payment deadline, 24 h before pickup, 3 days after completion) and only once per booking (`select dedupe_key from notifications where dedupe_key like 'booking:%'`).
- **A review cannot be created** — the booking must be `completed` and younger than `review_window_days`; `409 ALREADY_REVIEWED` means the booking already has one (edit it from the booking page instead).
- **Saving settings fails with `SETTING_MONEY_MODEL_UNSUPPORTED`** — `advance_percentage` and `default_commission_rate` must stay equal (the platform holds no provider money); change both in one save. `SETTING_STALE` means someone saved first: reload and retry.
- **No document expiry reminder / auto-pause** — the sweep runs once a day (01:00 UTC) in the worker; check `select dedupe_key from notifications where dedupe_key like 'document:%'` and `platform_settings.auto_pause_on_document_expiry`; only an approved, current revenue licence or insurance certificate pauses a listing.
- **A listing cannot be reactivated** — the `409` lists why: provider suspended, fewer than 3 photos, or an expired revenue licence / insurance; fix the cause (approve the renewed document) and retry.
- **Every admin call answers `403 MFA_REQUIRED`** — `ADMIN_MFA_REQUIRED` is on and the account has no confirmed authenticator (`details[].issue = enrolment_required`) or the session has not completed the code (`challenge_required`): open `/account/security` and enrol, or sign in again and enter the code. `429 MFA_LOCKED` means five wrong codes; wait 15 minutes.
- **An admin lost the authenticator and the recovery codes** — `pnpm admin:mfa-reset --email <admin> --reason "<why>"` (database access; audited `mfa.reset`), then enrol again at the next sign-in.
- **`pnpm production:check` fails** — the output names the variable and the rule (never the value); fix the file and rerun. `--live` needs network access to the database, the buckets and the SMTP host named in the file.
- **The retention sweep deleted nothing** — periods are settings (`/admin/settings` → Retention) and `0` means keep; `pnpm retention:preview` shows the candidates per class. Driver-snapshot purging is off by default.
- **The API starts but every response has `Content-Security-Policy: default-src 'none'`** — expected for the JSON API; it only relaxes when Swagger UI or the fake checkout page is served (never in production).
- **The web app shows "draft" banners on `/privacy`, `/terms`, `/cancellation-policy`** — the legal texts are drafts (`status: draft`, placeholders present); in production those pages answer 404 until approved. Edit `packages/contracts/src/legal/content/*.ts` and run `pnpm legal:render`.
- **Playwright cannot find Chromium** — `pnpm --filter @vrp/e2e install:browsers` once per machine.
