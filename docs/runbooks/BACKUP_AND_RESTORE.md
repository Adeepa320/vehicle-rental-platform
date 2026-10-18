# Runbook: backup and restore

**Status:** v0.1 (2026-10-17), Phase 10. Audience: the operator and the on-call engineer.
**Production state:** no production database exists yet. Every vendor step below is **EXTERNAL GATE — NOT EXECUTED** until the Neon or Supabase account is created (docs/TECH_DECISIONS.md D10: the choice is still open). The local drill in section 4 can and should be run now.
**Related:** [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md), [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md), [../security/DATA_RETENTION.md](../security/DATA_RETENTION.md) §3.7, docs/ARCHITECTURE.md §13, README.md "Database workflow".

## 1. What must be protected

| Asset                                                                                                        | Where                                                 | Backup mechanism                                                                                                                                                                                                                                     | Status                       |
| ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| PostgreSQL database (all tables, `drizzle` migration schema, `pgboss` schema, PostGIS and citext extensions) | Neon or Supabase, Singapore                           | Vendor automated daily backups and point-in-time recovery (PITR); plus a monthly `pg_dump` kept off-vendor for long retention (section 3)                                                                                                            | EXTERNAL GATE — NOT EXECUTED |
| Object storage `vrp-private` (photo originals, verification documents)                                       | Cloudflare R2                                         | **R2 has no bucket versioning.** Protection is: bucket locks (prevent delete and overwrite for a period), lifecycle rules only for intended expiry, and application-level discipline (objects deleted only by the retention sweep or with their row) | EXTERNAL GATE — NOT EXECUTED |
| Object storage `vrp-public` (WebP photo variants)                                                            | Cloudflare R2                                         | Derivable from the private originals (`processVehiclePhoto`); not backed up separately. A rebuild job does not exist yet (note for DISASTER_RECOVERY.md §3)                                                                                          | EXTERNAL GATE — NOT EXECUTED |
| Secrets and configuration                                                                                    | Railway environment variables (sealed where possible) | Recorded in the operator's password manager at creation; never in the repository. See [SECRET_ROTATION.md](SECRET_ROTATION.md)                                                                                                                       | EXTERNAL GATE — NOT EXECUTED |
| Source code and migrations                                                                                   | Git (GitHub)                                          | Distributed by nature; every migration is in `packages/database/drizzle/`                                                                                                                                                                            | In place                     |
| Platform settings                                                                                            | `platform_settings` table                             | Part of the database backup; defaults are in `packages/database/src/seed/data/platform-settings.ts`                                                                                                                                                  | In place                     |

## 2. Targets (proposals, to be confirmed with the vendor plan)

| Target                    | Proposal                                                                                                          | Note                                                                                                                     |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| RPO (maximum data loss)   | ≤ 24 hours with daily backups; ≤ 5 minutes where PITR is enabled                                                  | PITR window and granularity depend on the plan chosen; record the actual values here after account creation              |
| RTO (time to serve again) | ≤ 4 hours for a database restore; ≤ 1 hour for an application rollback                                            | Assumes the on-call engineer is reachable; see the escalation table in INCIDENT_RESPONSE.md                              |
| Backup retention          | Daily backups kept 30 days; monthly `pg_dump` kept 12 months, then deleted                                        | DATA_RETENTION.md §3.7 and §6 question 8 (LEGAL REVIEW REQUIRED: anonymised data persists in backups until they age out) |
| Drill frequency           | Local drill before go-live and after every migration that changes constraints; production restore drill quarterly | Record every drill in section 7                                                                                          |

## 3. Production backups (to configure at account creation)

1. **Enable automated backups and PITR** on the managed database. Record plan, retention days and PITR window in section 2. (EXTERNAL GATE — NOT EXECUTED)
2. **Monthly logical dump.** From a trusted machine with the production `DATABASE_URL` (read-only role preferred): `pg_dump --format=custom --no-owner --no-privileges --file=vrp-YYYY-MM.dump "$DATABASE_URL"`. Encrypt the file (for example with `age` or GPG) and store it in a storage location separate from the database vendor; record the SHA-256. Never keep a dump on a laptop longer than the drill needs. (EXTERNAL GATE — NOT EXECUTED)
3. **Object storage.** On `vrp-private`: set a bucket lock covering at least the document retention periods (DATA_RETENTION.md §3.5) so that an accidental delete or overwrite is refused; add lifecycle rules only for the retention sweep's safety net. On `vrp-public`: no lock (variants are rebuilt from originals). Record the lock rule here. (EXTERNAL GATE — NOT EXECUTED)
4. **Verify monthly** that the vendor backup list shows the expected entries and that the latest `pg_dump` restores in the drill (section 5).

Facts from the vendor documentation read on 2026-10-17 that shape this section: Railway's own volume backups keep daily 6 days, weekly 27 days and monthly 89 days and are deleted when the volume is wiped, so a Railway-hosted PostgreSQL is not the plan; R2 implements neither `PutBucketVersioning` nor object lock, only bucket locks and lifecycle rules; deleting a database project at either vendor deletes its backups, so export before any project deletion.

## 4. Local restore drill (run now, no vendor account needed)

Purpose: prove that a dump of the development database restores into a fresh database and passes validation. It never touches the main development database or any production system.

Prerequisites: `pnpm db:up` running (PostGIS container from `infra/docker-compose.yml`), a migrated and seeded development database (`pnpm db:setup`), `pg_dump` / `pg_restore` / `psql` available (either installed locally or executed inside the container with `docker compose -f infra/docker-compose.yml exec db ...`). `DATABASE_URL` points at the development database (default `postgresql://postgres:postgres@localhost:5432/vehicle_rental`; see README.md).

Step 1: dump the development database.

```sh
pg_dump --format=custom --no-owner --no-privileges --file=/tmp/vrp-drill.dump "$DATABASE_URL"
```

Step 2: create the drill database (never reuse the main name).

```sh
psql "$DATABASE_URL" -c 'DROP DATABASE IF EXISTS vehicle_rental_restore_drill;'
psql "$DATABASE_URL" -c 'CREATE DATABASE vehicle_rental_restore_drill;'
```

Step 3: restore into it. The dump carries `CREATE EXTENSION` statements for `postgis` and `citext`; the restoring role must be allowed to create extensions (the development `postgres` superuser is).

```sh
pg_restore --no-owner --no-privileges --dbname="${DATABASE_URL%/*}/vehicle_rental_restore_drill" /tmp/vrp-drill.dump
```

Step 4: validate. Run the same statements against the source and the drill database and compare.

```sql
select 'users' as t, count(*) from users
union all select 'provider_profiles', count(*) from provider_profiles
union all select 'vehicles', count(*) from vehicles
union all select 'bookings', count(*) from bookings
union all select 'vehicle_holds', count(*) from vehicle_holds
union all select 'payments', count(*) from payments
union all select 'payment_events', count(*) from payment_events
union all select 'reviews', count(*) from reviews
union all select 'audit_events', count(*) from audit_events
union all select 'verification_documents', count(*) from verification_documents
order by 1;

-- Migrations applied (must equal the source; 22 after 0021_production_readiness_triggers)
select count(*) from drizzle.__drizzle_migrations;

-- Extensions present
select extname, extversion from pg_extension where extname in ('postgis', 'citext') order by 1;

-- Constraint check: the exclusion constraint that guards availability must exist and hold
select conname, contype from pg_constraint where conname = 'vehicle_holds_no_overlap';
select count(*) as overlapping_pairs
from vehicle_holds a join vehicle_holds b
  on a.vehicle_id = b.vehicle_id and a.id < b.id
 and tstzrange(a.starts_at, a.ends_at, '[)') && tstzrange(b.starts_at, b.ends_at, '[)');
-- expected: 0

-- Append-only triggers restored (booking_events, payment_events, audit_events, dispute_messages)
select event_object_table, trigger_name from information_schema.triggers
where event_object_schema = 'public' order by 1, 2;

-- Readiness probe equivalent (what GET /api/v1/ready checks)
select 1;
```

Step 5: optional application check. Point a second API instance at the drill database (`DATABASE_URL=...vehicle_rental_restore_drill pnpm --filter @vrp/api dev` (or `start` after a build)) and call `GET /api/v1/ready`; expect `status: ready` with `database`, `postgis` and `migrations` all `up`.

Step 6: clean up.

```sh
psql "$DATABASE_URL" -c 'DROP DATABASE vehicle_rental_restore_drill;'
rm /tmp/vrp-drill.dump
```

Step 7: record the drill in section 7 (date, dump size, restore duration, counts matched yes/no, deviations).

## 5. Production restore procedure (when a production database exists)

**Never restore over the live database.** Restore into a new database or branch, validate, then switch the application to it.

1. Declare an incident (INCIDENT_RESPONSE.md) and freeze deployments.
2. Put the API into maintenance: scale the API and worker to zero on Railway, or block traffic at Cloudflare (WAF_AND_EDGE.md). Payment notifications from PayHere will fail to reach the API while it is down; reconcile them afterwards with `POST /admin/payments/{id}/reconcile` or the merchant portal (PAYHERE_GO_LIVE.md §6).
3. Choose the restore point: PITR timestamp (just before the damage) or the latest backup. Write the chosen timestamp into the incident log.
4. Restore into a **new** database or branch at the vendor (EXTERNAL GATE — NOT EXECUTED). For a logical dump, create a new database and `pg_restore` as in section 4.
5. Validate with the section 4 queries, plus: the last `audit_events` and `payment_events` timestamps match the chosen restore point; `select count(*) from drizzle.__drizzle_migrations` equals the count the deployed application expects (the API refuses to be `ready` with zero migrations and pg-boss runs its own schema migration on start).
6. **Re-apply anonymisations** performed after the restore point: list `audit_events` rows with `action = 'user.anonymised'` from the original database (if readable) and repeat them through `POST /admin/users/{id}/anonymise` (DATA_RETENTION.md §5 step 6). Re-record refunds recorded after the restore point from the merchant portal evidence.
7. Switch `DATABASE_URL` on the API and the worker to the restored database, deploy, check `GET /api/v1/ready` and `GET /api/v1/health`, then reopen traffic.
8. Keep the damaged database read-only for 7 days for forensics, then delete it.
9. Post-incident review (INCIDENT_RESPONSE.md §9).

## 6. Object storage recovery notes

- A deleted or overwritten object in R2 cannot be recovered unless a bucket lock prevented the operation. Document the lock configuration here when created.
- Verification documents have no second copy. If an object is lost, the row stays; the admin console will fail to stream it (`GET /admin/documents/{id}/content`). Mark the document with **Request replacement** (`POST /admin/documents/{id}/request-replacement`) so the provider re-uploads.
- Photo variants can be regenerated from originals; a rebuild command does not exist yet (DISASTER_RECOVERY.md §3).

## 7. Drill and restore log

| Date       | Type (local drill / production drill / real restore)                                                                                                                 | Operator                       | Dump size     | Restore duration                               | Counts matched                                                                                                                                                                                                                                                                                                                                                                     | Deviations and follow-ups                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ | ------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-10-18 | local drill (§4, inside the `vehicle-rental-db` container: `pg_dump --format=custom` of `vehicle_rental` → `pg_restore` into a fresh `vehicle_rental_restore_drill`) | engineering (Phase 10 session) | 557,892 bytes | under 10 s (dump and restore together, laptop) | yes: 13 classes compared (users 111, provider_profiles 40, vehicles 30, bookings 106, vehicle_holds 33, payments 62, payment_events 466, reviews 16, audit_events 752, verification_documents 48, user_mfa 1, privacy_requests 0, migrations 22) identical; `postgis 3.5.2` and `citext 1.6` present; `vehicle_holds_no_overlap` and the `user_mfa_set_updated_at` trigger present | `pg_restore` exit 0 with no warnings. Deviation from §4: run through `docker exec` (no local PostgreSQL client tools); the drill database was dropped afterwards. Production drill: EXTERNAL GATE — NOT EXECUTED (no production database). |
