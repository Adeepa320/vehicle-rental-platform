# Deployment

**Status:** v0.1 (2026-10-17), written with Phase 10. Describes how the approved modular monolith is packaged and run in production. Nothing in this document has been executed against a real cloud account yet: every step that needs one is marked **EXTERNAL GATE — NOT EXECUTED**.
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md) §13 (hosting decision D10), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [OPERATIONS_RUNBOOK.md](OPERATIONS_RUNBOOK.md), `docs/runbooks/*`, [README.md](../README.md).

## 1. Topology

| Service                 | Image / runtime                                    | Command                   | Port | Health                                                                         |
| ----------------------- | -------------------------------------------------- | ------------------------- | ---- | ------------------------------------------------------------------------------ |
| `web`                   | `apps/web/Dockerfile` (Next.js standalone)         | `node apps/web/server.js` | 3000 | `GET /` (2xx)                                                                  |
| `api`                   | `apps/api/Dockerfile`                              | `node dist/main.js`       | 4000 | liveness `GET /api/v1/health`, readiness `GET /api/v1/ready`                   |
| `worker`                | same image as `api`                                | `node dist/worker.js`     | —    | `GET /api/v1/admin/system/worker` (admin, MFA) — heartbeat = `reminders.sweep` |
| PostgreSQL 17 + PostGIS | managed (Neon or Supabase, Singapore — undecided)  | —                         | 5432 | provider dashboard; `/ready` checks `select 1`, PostGIS, migrations            |
| Object storage          | Cloudflare R2 (S3 API), two buckets                | —                         | —    | `production:check --live` HeadBucket                                           |
| E-mail                  | Resend over SMTP (`smtp.resend.com:587`, STARTTLS) | —                         | —    | `production:check --live` SMTP verify                                          |
| Edge                    | Cloudflare DNS / WAF / CDN in front of Railway     | —                         | —    | `docs/runbooks/WAF_AND_EDGE.md`                                                |

One API image serves both the API and the worker; they differ only in the start command. There are no microservices, queues or caches beyond PostgreSQL and pg-boss (TECH_DECISIONS D9).

## 2. Images

Build from the repository root (the Dockerfiles copy the workspace):

```bash
docker build -f apps/api/Dockerfile -t vrp-api:<git-sha> .
docker build -f apps/web/Dockerfile -t vrp-web:<git-sha> \
  --build-arg NEXT_PUBLIC_API_URL=https://api.<domain>/api/v1 \
  --build-arg NEXT_PUBLIC_WEB_URL=https://<domain> \
  --build-arg NEXT_PUBLIC_IMAGE_ORIGINS=https://img.<domain> \
  --build-arg NEXT_PUBLIC_MAP_ORIGINS=https://tiles.openfreemap.org \
  --build-arg NEXT_PUBLIC_MAP_STYLE_URL=https://tiles.openfreemap.org/styles/liberty \
  --build-arg NEXT_PUBLIC_SUPPORT_EMAIL=support@<domain> \
  --build-arg NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL=privacy@<domain> .
```

- Multi-stage; production dependencies only in the runtime stage; runs as the unprivileged `node` user; no `.env`, no `.git`, no sources (`.dockerignore`); health checks built in; `SIGTERM` is handled by Nest's shutdown hooks (API: close server, stop pg-boss gracefully within 5 s; worker: `boss.stop({ graceful: true })`).
- `NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so a web image belongs to one environment. Server-only values (`API_INTERNAL_URL`) are read at run time.
- CI builds both images on every push without pushing them (`.github/workflows/ci.yml`, job `images`). Publishing to a registry and deploying is intentionally manual until the hosting account exists.

## 3. Configuration

Every variable the API and worker read is validated at start-up by `apps/api/src/config/env.schema.ts`; production refuses insecure values (fake gateway, development encryption key, localhost / `http://` public URLs, `minioadmin`, Swagger on, MFA policy off, SMTP without TLS or auth, bucket auto-creation). The full list with defaults is in [README.md](../README.md) and `.env.example` (grouped Local / Staging / Production).

Run the validator against the exact file you intend to deploy — it never prints values:

```bash
pnpm production:check --env-file .env.production --web-env-file apps/web/.env.production
pnpm production:check --env-file .env.production --live   # + database, migrations, admin MFA, buckets, SMTP
```

Production-only / new in Phase 10: `LAUNCH_MODE` (`staging` keeps the PayHere sandbox; `production` requires `PAYHERE_ENVIRONMENT=live`), `TRUST_PROXY_HOPS` (1 behind Railway, 2 behind Cloudflare → Railway), `APP_DATA_ENCRYPTION_KEY` (+ `_PREVIOUS` during rotation), `ADMIN_MFA_REQUIRED` (forced true), `HSTS_ENABLED`, `SMTP_REQUIRE_TLS`, `SENTRY_DSN` (optional), `APP_RELEASE` (git SHA).

Secrets are platform environment variables (Railway "sealed" variables where available). Rotation procedures: `docs/runbooks/SECRET_ROTATION.md`.

## 4. Release sequence (every deploy)

Before the first production release every row of [runbooks/GO_LIVE_CHECKLIST.md](runbooks/GO_LIVE_CHECKLIST.md) must be ticked with evidence (including for the business gate); afterwards, A1–A8 of that checklist on the release commit.

1. **Snapshot / backup** the production database (provider PITR or a manual snapshot; `docs/runbooks/BACKUP_AND_RESTORE.md`).
2. **Run migrations** from the new API image, before any new code receives traffic (migrations are forward-only and additive — expand/contract for breaking changes, DATABASE_DESIGN.md §2):
   ```bash
   docker run --rm --env-file <prod env> vrp-api:<git-sha> node node_modules/@vrp/database/dist/migrate.js
   ```
   The migrator takes an advisory lock, so a concurrent run is harmless. Verify: `select count(*) from drizzle.__drizzle_migrations` matches the number of files in `packages/database/drizzle/`.
3. **Seed reference data** when a release adds districts, places, categories or settings (insert-only; never overwrites operator changes): `node node_modules/@vrp/database/dist/seed/index.js`.
4. **Deploy** `api`, then `worker`, then `web` (rolling; the previous API keeps serving until the new one is ready on `/api/v1/ready`).
5. **Smoke**: `/api/v1/health`, `/api/v1/ready`, the web home page, an admin login with MFA, `GET /admin/system/worker` healthy, one search.
6. **Monitor** for 30 minutes: 5xx rate, worker heartbeat, invalid PayHere signatures, failed jobs (`docs/runbooks/INCIDENT_RESPONSE.md` §alerts).

Railway specifics (verified 2026-10-17, see `scratchpad` external verification): set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS` (default 0 s!) to at least 15 so in-flight requests and pg-boss handlers finish on `SIGTERM`; health-check path `/api/v1/ready` (any 2xx) for the API; the worker has no HTTP port — monitor it through the admin worker status and the job tables.

## 5. Rollback

- **Application**: redeploy the previous image tag. Allowed while the schema is compatible — Phase 10 migrations only add tables and nullable columns, so the previous Phase 9 image runs on the Phase 10 schema.
- **Schema**: never roll back a migration; write a forward corrective migration (`docs/runbooks/DISASTER_RECOVERY.md` §bad migration). Restoring the database from backup is the last resort and loses writes made since the snapshot.
- **Payments emergency**: set `PAYMENT_GATEWAY`/`PAYHERE_ENVIRONMENT` back to the previous values and redeploy the API only; bookings already confirmed are untouched; the worker needs no change (`docs/runbooks/PAYHERE_GO_LIVE.md`).
- **Worker**: stop the worker deployment; queued jobs wait in PostgreSQL and are processed after restart (sweeps are idempotent through dedupe keys).
- **Edge**: Cloudflare rules can be disabled individually; DNS TTL is kept short (300 s) during launch.

## 6. Domains and URLs

| Purpose        | Example                                               | Where configured                                                            |
| -------------- | ----------------------------------------------------- | --------------------------------------------------------------------------- |
| Web            | `https://<domain>`                                    | `WEB_APP_URL`, `CORS_ORIGINS`, `NEXT_PUBLIC_WEB_URL`, Railway custom domain |
| API            | `https://api.<domain>/api/v1`                         | `API_PUBLIC_URL`, `NEXT_PUBLIC_API_URL`, Railway custom domain              |
| Public images  | `https://img.<domain>`                                | `STORAGE_PUBLIC_URL`, `NEXT_PUBLIC_IMAGE_ORIGINS`, R2 custom domain         |
| PayHere notify | `https://api.<domain>/api/v1/payments/payhere/notify` | `PAYHERE_NOTIFY_URL`; must never sit behind a browser challenge             |
| PayHere return | `https://<domain>/bookings/<id>/payment`              | built from `WEB_APP_URL`                                                    |

The refresh cookie is `__Secure-vrp_refresh`, `SameSite=Lax`, path `/api/v1/auth`, so the web and API must share a registrable domain (`<domain>` and `api.<domain>`), as D3 assumes. **EXTERNAL GATE — NOT EXECUTED:** no domain is registered yet.

## 7. Object storage (Cloudflare R2)

- Two buckets: `vrp-private` (originals, verification documents; never public) and `vrp-public` (photo variants) behind an R2 custom domain used as `STORAGE_PUBLIC_URL`. R2 encrypts at rest by default; it has **no bucket versioning** — use bucket locks / lifecycle rules and the backup policy in `docs/runbooks/BACKUP_AND_RESTORE.md`.
- API token scoped to those two buckets only (object read/write/delete; no account-level rights). `STORAGE_AUTO_CREATE_BUCKETS` stays false: buckets and policies are created by the operator.
- CORS on the public bucket is not needed (images are loaded with `<img>`, not fetched); on the private bucket nothing is public.
- **EXTERNAL GATE — NOT EXECUTED:** no R2 account exists; the local MinIO stand-in is development-only.

## 8. E-mail (Resend over SMTP)

`EMAIL_PROVIDER=smtp`, `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_SECURE=false`, `SMTP_REQUIRE_TLS=true`, `SMTP_USER=resend`, `SMTP_PASS=<API key>`, `EMAIL_FROM=Vehicle Rental Platform <no-reply@<domain>>`. Domain verification (SPF, DKIM, DMARC) happens in the Resend dashboard before the first send. Delivery failures are retried by pg-boss (5 attempts, backoff) and visible in `GET /admin/system/worker`. **EXTERNAL GATE — NOT EXECUTED.**

## 9. Observability

- Logs: pino JSON on stdout (Railway log drain → Better Stack / Axiom candidate); every line carries `service`, `environment`, `release`; request lines carry the request id, method, matched route, status, latency and the user id (never names, e-mails or query values).
- Error tracking: optional `SENTRY_DSN` (API + worker; browser only after a privacy review); events are scrubbed of headers, cookies, bodies and IPs before they leave the process.
- Uptime: external HTTP monitors on `/`, `/api/v1/health`, `/api/v1/ready` and a HEAD on the PayHere notify path; alert conditions in `docs/runbooks/INCIDENT_RESPONSE.md`. **EXTERNAL GATE — NOT EXECUTED** (no monitoring account).

## 10. Staging

Same images, `LAUNCH_MODE=staging`, PayHere sandbox credentials, a separate database branch / project, separate buckets and a separate Resend sending domain. Staging is where the PayHere sandbox certification (`docs/runbooks/PAYHERE_GO_LIVE.md`) runs with a public notify URL.

**Go-live Step 1 (2026-10-28, TECH_DECISIONS D77):** the operator procedure is [runbooks/STAGING_DEPLOYMENT.md](runbooks/STAGING_DEPLOYMENT.md). It covers service names (`vehicle-rental-staging-{web,api,worker,db}`), the variable matrix, the Railway and Neon dashboard steps, migrations as the API **pre-deploy command**, the Neon **direct** endpoint, `pnpm smoke:staging`, rollback and teardown. Two constraints apply. A production-mode API and worker start only with real SMTP, S3 and PayHere sandbox credentials; there is deliberately no bypass. Sign-in on staging needs web and API on one registrable domain (`up.railway.app` is a public suffix). **EXTERNAL GATE — NOT EXECUTED:** no Railway or Neon resource exists yet.
