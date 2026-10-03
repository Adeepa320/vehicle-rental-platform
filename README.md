# Vehicle Rental Platform

Sri Lankan online vehicle-rental marketplace: _search nearby vehicles → see real availability → compare transparent prices → trust verified providers → book_. Launching on the South Coast (Matara, Weligama, Mirissa, Galle, Unawatuna).

The product, architecture and roadmap are documented in [`docs/`](docs/) — start with [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/ROADMAP.md](docs/ROADMAP.md). Development rules for AI-assisted sessions are in [CLAUDE.md](CLAUDE.md).

**Current state: Phase 1 (Foundation).** The repository contains the monorepo skeleton, a NestJS API with health/readiness endpoints, a Next.js status page, the database foundation (PostGIS, migrations, reference seeds) and the worker entrypoint. No marketplace features yet.

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
  docker-compose.yml  Local PostgreSQL 17 + PostGIS 3.5 (creates dev and test databases)
docs/         Product and technical documentation (source of truth)
```

## Prerequisites

| Tool           | Version    | Notes                                                           |
| -------------- | ---------- | --------------------------------------------------------------- |
| Node.js        | 24.x       | `node --version`                                                |
| pnpm           | 12.x       | `corepack enable` installs the version pinned in `package.json` |
| Docker Desktop | any recent | for the local PostGIS database                                  |

No cloud accounts, API keys or paid services are needed for local development.

## Quick start

```bash
# 1. Install dependencies (also builds nothing yet; postinstall scripts are allow-listed)
pnpm install

# 2. Create local env files from the examples (never commit the real ones)
cp .env.example .env
cp apps/web/.env.example apps/web/.env.local

# 3. Start PostgreSQL + PostGIS, apply migrations and load the South Coast seed data
pnpm db:setup          # = pnpm db:up && pnpm db:migrate && pnpm db:seed

# 4. Run the web app (http://localhost:3000) and the API (http://localhost:4000/api/v1)
pnpm dev

# Optional: run the background worker in a second terminal
pnpm dev:worker
```

Then open <http://localhost:3000> — the status page shows whether the API is reachable and whether the database, PostGIS and migrations are ready. Direct endpoints:

- `GET http://localhost:4000/api/v1/health` — liveness
- `GET http://localhost:4000/api/v1/ready` — readiness (HTTP 200 when ready, 503 otherwise)

## Everyday commands

| Command                                        | What it does                                                             |
| ---------------------------------------------- | ------------------------------------------------------------------------ |
| `pnpm dev`                                     | Web + API in watch mode (Turborepo)                                      |
| `pnpm dev:worker`                              | Worker process (pg-boss queue; no jobs registered yet)                   |
| `pnpm build`                                   | Production builds for every package and app                              |
| `pnpm lint` / `pnpm typecheck` / `pnpm test`   | Quality gates (run before handing over work)                             |
| `pnpm check`                                   | lint + typecheck + test + build in one go                                |
| `pnpm format` / `pnpm format:check`            | Prettier                                                                 |
| `pnpm db:up` / `pnpm db:down` / `pnpm db:logs` | Manage the Docker database                                               |
| `pnpm db:migrate`                              | Apply pending SQL migrations to `DATABASE_URL`                           |
| `pnpm db:seed`                                 | Idempotent reference-data seed (districts, places, categories, settings) |
| `pnpm db:generate`                             | Generate a new migration from schema changes (see below)                 |

## Environment variables

Root `.env` (copied from [`.env.example`](.env.example)) is read by Docker Compose defaults, the database scripts, the API and the worker:

| Variable                                                          | Default                                                        | Used by                             |
| ----------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `DB_PORT` | `postgres` / `postgres` / `vehicle_rental` / `5432`            | Docker Compose                      |
| `DATABASE_URL`                                                    | `postgresql://postgres:postgres@localhost:5432/vehicle_rental` | database scripts, API, worker       |
| `DATABASE_URL_TEST`                                               | `…/vehicle_rental_test`                                        | automated tests (separate database) |
| `NODE_ENV`                                                        | `development`                                                  | API, worker                         |
| `API_PORT` / `API_HOST`                                           | `4000` / `0.0.0.0`                                             | API                                 |
| `CORS_ORIGINS`                                                    | `http://localhost:3000`                                        | API (comma-separated)               |
| `LOG_LEVEL`                                                       | `debug`                                                        | API, worker                         |
| `RATE_LIMIT_TTL_SECONDS` / `RATE_LIMIT_MAX`                       | `60` / `300`                                                   | API                                 |
| `PGBOSS_SCHEMA`                                                   | `pgboss`                                                       | worker                              |

`apps/web/.env.local` (copied from [`apps/web/.env.example`](apps/web/.env.example)):

| Variable              | Default                        | Used by          |
| --------------------- | ------------------------------ | ---------------- |
| `NEXT_PUBLIC_API_URL` | `http://localhost:4000/api/v1` | browser          |
| `API_INTERNAL_URL`    | `http://localhost:4000/api/v1` | server rendering |

Placeholders for later phases (email, SMS, storage, payments, auth keys) are listed as comments in `.env.example` and are not read by any code yet.

## Database workflow

1. Edit the Drizzle schema in `packages/database/src/schema/`.
2. `pnpm db:generate` writes a new SQL file under `packages/database/drizzle/` and updates the journal.
3. **Review the SQL.** drizzle-kit quotes PostGIS column types it does not know (`"geography(Point,4326)"`); remove the quotes. A test (`packages/database/src/__tests__/migrations.test.ts`) fails if a quoted PostGIS type slips through.
4. For SQL drizzle-kit cannot express (extensions, triggers, exclusion constraints), create an empty custom migration with `pnpm --filter @vrp/database exec drizzle-kit generate --custom --name <name>` and write the SQL by hand.
5. `pnpm db:migrate` applies it locally; migrations are forward-only (undo with a new migration).

Seeds are idempotent: reference attributes are upserted, while operational flags (`is_active`) and `platform_settings` are insert-only so admin changes in the database are never overwritten.

## Testing

```bash
pnpm test                      # everything (needs the Docker database for integration/e2e tests)
pnpm --filter @vrp/api test    # API unit + e2e (supertest against an in-process Nest app)
pnpm --filter @vrp/database test
pnpm --filter @vrp/contracts test
```

Tests that need PostgreSQL use `DATABASE_URL_TEST` and skip with a warning when it is not set. The test database is created automatically by Docker on first start (`infra/db/init/`).

## Continuous integration

[`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs install → lint → build → typecheck → migrate + seed → test → format check against a PostGIS service container. It needs no secrets. Deployment is intentionally not configured yet (see `docs/ARCHITECTURE.md` §13 for the planned hosting).

## Troubleshooting

- **`pnpm install` complains about ignored build scripts** — the allow-list lives in `pnpm-workspace.yaml` (`allowBuilds`). Run `pnpm approve-builds <pkg>` to extend it.
- **Port 5432 already in use** — set `DB_PORT` in `.env` and start with `docker compose --env-file .env -f infra/docker-compose.yml up -d`, then update `DATABASE_URL*`.
- **`/ready` reports `migrations: down`** — run `pnpm db:migrate`.
- **Test database missing** (older Docker volume) — `docker exec vehicle-rental-db psql -U postgres -c "CREATE DATABASE vehicle_rental_test;"`.
