# Runbook: incident response

**Status:** v0.1 (2026-10-17), Phase 10. Replaces the interim table in docs/OPERATIONS_RUNBOOK.md §9. Audience: the operator (founder) and the on-call engineer.
**Related:** [DATA_BREACH_RESPONSE.md](DATA_BREACH_RESPONSE.md) (any incident that touches personal data continues there), [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md), [BACKUP_AND_RESTORE.md](BACKUP_AND_RESTORE.md), [SECRET_ROTATION.md](SECRET_ROTATION.md), [PAYHERE_GO_LIVE.md](PAYHERE_GO_LIVE.md), [WAF_AND_EDGE.md](WAF_AND_EDGE.md), [SUPPORT.md](SUPPORT.md), docs/OPERATIONS_RUNBOOK.md (console procedures).
**Ground rules:** never edit database rows by hand; never confirm a booking or mark a payment paid manually (there is no such path and none may be added); never log or paste secrets, tokens, signatures or card data into the incident log; keep the incident log in the operator's shared notes, not in the repository.

## 1. Severity levels

| Level | Definition                                                                                                 | Examples                                                                                                                                        | Response                                                                                                  |
| ----- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| SEV1  | The platform cannot take or confirm bookings, money or personal data is at risk, or an attacker has access | API or database down; payment notifications failing for everyone; admin account compromise; documents publicly reachable; data breach suspected | Act immediately, around the clock; operator and engineer both engaged; status note to users within 1 hour |
| SEV2  | A major function is degraded for many users but a workaround exists                                        | Worker down (no e-mails, expiries, reminders); photo uploads failing; map tiles down; e-mail provider rejecting                                 | Act within 1 hour during the day, next morning at night unless deadlines are being missed                 |
| SEV3  | A single user or booking is affected, or a non-critical function is broken                                 | One payment anomaly; one suspicious document; one dispute needing a decision; a report CSV failing                                              | Handle in the daily operations window using OPERATIONS_RUNBOOK.md                                         |
| SEV4  | Cosmetic or informational                                                                                  | Typo, slow page, log noise                                                                                                                      | Backlog                                                                                                   |

Raise the level when in doubt; lower it in the review.

## 2. Detection

| Signal                                                                                             | Source                                                                                                                                                                                                           |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Uptime alerts on the web app, `GET /api/v1/health`, `GET /api/v1/ready` and the PayHere notify URL | External monitor (Better Stack or UptimeRobot; EXTERNAL GATE — NOT EXECUTED). `/ready` returns `503` with per-check status (`database`, `postgis`, `migrations`) and a redacted message                          |
| Operator e-mails for payment anomalies and provider applications                                   | `OPERATOR_NOTIFICATION_EMAIL` (sent through the worker; if the worker is down these stop too)                                                                                                                    |
| The admin overview and queues                                                                      | `/admin` (overview counts), `/admin/payments` (anomaly queue), `/admin/disputes?status=open`, `/admin/documents`, `/admin/audit`                                                                                 |
| Logs                                                                                               | Railway logs for the API and worker (pino JSON; `x-request-id` on every line; secrets redacted). Key lines: `Payment notification rejected`, `Verified payment could not confirm its booking`, `Refund recorded` |
| Error monitoring                                                                                   | Sentry, if and when enabled (`SENTRY_DSN`)                                                                                                                                                                       |
| Users and providers                                                                                | Support inbox (SUPPORT.md); a report of "actions I did not take" is a compromise signal                                                                                                                          |
| Vendors                                                                                            | Status pages of Railway, Neon or Supabase, Cloudflare, PayHere, Resend (links to be added at account creation)                                                                                                   |

## 3. First fifteen minutes (any SEV1 or SEV2)

1. **Open the incident log**: time (UTC and Colombo), who noticed, what is seen, severity. One person is the incident lead; everyone else writes to the log.
2. **Check the basics**: `GET /api/v1/health` (process up), `GET /api/v1/ready` (database, PostGIS, migrations), Railway deployment list (did a deployment just happen?), the vendor status pages.
3. **Stop the bleeding before diagnosing** when money or data is at risk: see the containment table in section 4.
4. **Preserve evidence** (section 5) before restarting anything that would lose it.
5. **Tell users** if the outage is visible (section 7).

## 4. Containment actions

| Threat                              | Action                                                                                                                                                                                                                                                                                                                                             | Side effects to note                                                                                                                                                                                                                              |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compromised user account            | `/admin/users/[id]` → **Suspend** with a reason (`POST /admin/users/{id}/suspend`): status `suspended`, every refresh token revoked, next request `403 ACCOUNT_SUSPENDED`                                                                                                                                                                          | The user's bookings, reviews and payments are untouched; a provider profile owned by the user is not suspended by this (do it separately if needed)                                                                                               |
| Compromised admin account           | A `super_admin` suspends it (same route; only a super admin may act on an admin). If the second factor is in question: `pnpm admin:mfa-reset --email <admin> --reason "<why>"` (removes the factor, drops the MFA mark from every session, signs out everywhere, audited `mfa.reset`). Rotate any secret the admin could read (SECRET_ROTATION.md) | Admin MFA is required in production (`ADMIN_MFA_REQUIRED`); the admin re-enrols through the MFA endpoints (`POST /auth/mfa/enrol/start`, `POST /auth/mfa/enrol/confirm`) after reactivation. Review `/admin/audit` for everything the account did |
| Forged or failing payment callbacks | Nothing to switch off: the notify endpoint verifies `md5sig` before any write and always answers `200`; invalid signatures are recorded as `payment_events` with `signature_valid = false` and are never applied. If PayHere credentials are suspected to be leaked, rotate `PAYHERE_MERCHANT_SECRET` (SECRET_ROTATION.md §5)                      | A secret mismatch (wrong domain's secret) looks the same as forgery: check the merchant portal integration record first                                                                                                                           |
| Public exposure of private objects  | Remove public access on the bucket at the vendor; rotate `STORAGE_ACCESS_KEY` / `STORAGE_SECRET_KEY`; verify `STORAGE_BUCKET_PRIVATE` is a different bucket from `STORAGE_BUCKET_PUBLIC` in the environment; continue in DATA_BREACH_RESPONSE.md                                                                                                   | Public photo variants are meant to be public; only `vrp-private` objects count                                                                                                                                                                    |
| Corrupted or bad deployment         | Redeploy the previous Railway deployment **only if the database schema is compatible** (migrations are forward-only; an older app version cannot run on a newer schema unless the migration was additive). Otherwise fix forward (DISASTER_RECOVERY.md §4)                                                                                         | Check `GET /api/v1/ready` after the rollback; the worker must be rolled to the same version                                                                                                                                                       |
| Abuse or attack traffic             | Cloudflare WAF rules and rate limits (WAF_AND_EDGE.md). Never add a challenge to `/api/v1/payments/payhere/notify`                                                                                                                                                                                                                                 | The API's own limits (`RATE_LIMIT_MAX`, `AUTH_LOGIN_LIMIT_PER_MINUTE`, `AUTH_SENSITIVE_LIMIT_PER_15MIN`, `THREAD_POSTS_PER_15MIN`) are per process and per client IP                                                                              |
| Dangerous listing or provider       | `POST /admin/vehicles/{id}/suspend` (listing paused; existing bookings untouched), `POST /admin/providers/{id}/suspend` (profile suspended), and if needed `POST /admin/bookings/{id}/cancel` through the state machine (`cancel_by_platform`; full refund due by policy)                                                                          | Every action needs a reason and is audited; cancellations notify both parties                                                                                                                                                                     |

## 5. Evidence

- Export the relevant log lines by `x-request-id` and time window from Railway before any restart that truncates logs.
- Note `audit_events`, `booking_events` and `payment_events` ids involved (read through the console; the admin audit viewer `/admin/audit` hides IPs and secret-like keys by design). Engineering may run read-only SQL; record the query and the time.
- Screenshot vendor dashboards (PayHere merchant portal payment list, Railway deployment, Cloudflare security events).
- Keep a hash of any suspicious uploaded file rather than copying it around; the `verification_documents.sha256` column already stores one.
- Never record secrets, tokens, cookies, signatures or card data in the log.

## 6. Escalation

| Role               | Who                                                                                                                                        | When                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Incident lead      | On-call engineer, else the founder                                                                                                         | Every SEV1 / SEV2                                                                                           |
| Operator / founder | [PLACEHOLDER: FOUNDER_CONTACT]                                                                                                             | Every SEV1; any user communication; any money decision; any suspected personal-data breach                  |
| Legal counsel      | [PLACEHOLDER: LEGAL_COUNSEL_CONTACT]                                                                                                       | Suspected breach of personal data (DATA_BREACH_RESPONSE.md); forged documents; any regulator contact        |
| PayHere support    | support@payhere.lk (verified address from the PayHere documentation)                                                                       | Payments taken that we did not receive notifications for; refunds that the portal refuses; IP allow-listing |
| Hosting vendors    | Railway, Neon or Supabase, Cloudflare support channels (EXTERNAL GATE — NOT EXECUTED: record the plan's support route at account creation) | Platform-wide outage not caused by us                                                                       |
| E-mail vendor      | Resend support (EXTERNAL GATE — NOT EXECUTED)                                                                                              | Deliverability incident, domain reputation                                                                  |

## 7. User communication

- Visible outage: a short status note (banner on the web app when available, otherwise the support auto-reply) stating what is affected and when the next update comes. No cause speculation, no vendor blame, no personal data.
- Missed deadlines caused by an outage (a request expired because the provider could not answer, a payment window closed while the API was down): do not edit timers. Ask the parties to re-request; where the platform is at fault and an advance was paid, cancel by platform (full refund due) and record the refund (OPERATIONS_RUNBOOK.md §4.3).
- Individual users affected by a security event: write from the support inbox, confirm identity only through the account e-mail, never ask for passwords, and follow DATA_BREACH_RESPONSE.md for anything involving their data.
- Re-sends after a worker outage are usually unnecessary (pg-boss delivers queued jobs after restart; sweeps are idempotent). If a specific notification is truly missing, use `POST /admin/bookings/{id}/resend` from the allow-listed templates.

## 8. Scenarios

### 8.1 API outage

Check: `GET /api/v1/health` (process) and `/ready` (dependencies); Railway deployment status and logs; Cloudflare status (an edge problem looks like an origin outage). Act: if the latest deployment is the cause, roll back when schema-compatible, else fix forward; if the database is the cause, go to 8.2. Payment notifications during the outage: PayHere's retry behaviour is **not documented** (verified 2026-10-17), so reconcile every payment attempted during the window with `POST /admin/payments/{id}/reconcile` (needs `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET`) or by hand against the merchant portal (PAYHERE_GO_LIVE.md §6).

### 8.2 Database outage or corruption

Check: `/ready` shows `database: down`; vendor status page and dashboard. Act: vendor outage → wait, keep users informed, do not restore; corruption or data loss → BACKUP_AND_RESTORE.md §5 (restore into a new database, validate, switch, re-apply anonymisations). Never run the restore over the live database.

### 8.3 Worker outage

Symptoms: no e-mails, no expiries (`bookings.expire`), no reminders (`reminders.sweep`), no document sweep (`documents.expiry-sweep`), no retention sweep. `/ready` on the API stays green (it does not check the worker). Act: restart the worker; pg-boss delivers everything queued; sweeps are idempotent through dedupe keys, so nothing is sent twice. If requests expired late because the sweep did not run, the timers are still enforced from the stored deadlines when the sweep catches up; tell affected users only when a deadline was missed by the platform.

### 8.4 Object storage outage

Symptoms: photo uploads and document uploads fail (`StorageService` errors), document streaming fails; public photo variants may still load from the CDN cache. Act: vendor status; do not retry uploads in a loop; users see the API's error and can retry later. Documents are never cached, so admin review pauses until the vendor recovers.

### 8.5 Payment callback issues

Symptoms: bookings stuck in `accepted` after the customer paid; `/admin/payments` shows no `paid` row; the customer shows a PayHere receipt. Check: API logs for `Payment notification rejected` or no notify at all; `PAYHERE_NOTIFY_URL` (must be the public https URL, reachable from the internet, no challenge in front: WAF_AND_EDGE.md); `PAYHERE_MERCHANT_SECRET` belongs to the registered domain (secret is per domain). Act: reconcile (`POST /admin/payments/{id}/reconcile` or portal). If PayHere shows success but the booking has expired meanwhile, the next verified notification records a `late_success` with a refund due; follow OPERATIONS_RUNBOOK.md §4.4. Never confirm the booking by hand.

### 8.6 Invalid PayHere signature spike

Symptoms: many `payment_events` with `signature_valid = false` or many `Payment notification rejected` log lines. Two causes: (a) a secret mismatch after a rotation or a domain change (every notification fails, including real ones): verify the integration record and the deployed `PAYHERE_MERCHANT_SECRET`, roll back the rotation if needed (SECRET_ROTATION.md §5), then reconcile the affected payments; (b) forgery attempts from the internet (real payments still verify): nothing is applied; capture the source IPs from the logs, add a Cloudflare rule to rate-limit or block the sources on `/api/v1/payments/payhere/notify` **without** a challenge, and keep the evidence. In both cases no booking or payment row is touched by hand.

### 8.7 Account or admin compromise

Section 4 rows one and two. Then: read `/admin/audit` for the account and the period; reverse what can be reversed through normal routes (suspend listings, cancel bookings by platform, hide reviews); rotate secrets the admin could read (`APP_DATA_ENCRYPTION_KEY` and `JWT_*` are not readable from the console, Railway variables are only readable by Railway users); check whether personal data was read (`document.viewed` audit rows, contact reveals) and continue in DATA_BREACH_RESPONSE.md. For the admin to return: reactivate, re-enrol MFA (`/auth/mfa/enrol/start` → `/auth/mfa/enrol/confirm`), and run `pnpm admin:mfa-report --strict` to confirm every admin has a factor.

### 8.8 Corrupted deployment

Symptoms: `/ready` red after a deploy, 500s, or the worker crash-looping. Act: DISASTER_RECOVERY.md §4 (stop further deploys, snapshot, roll back only if schema-compatible, otherwise forward fix). Check `pnpm production:check` output in the deploy logs (Phase 10 validator) and the environment variables that changed with the deployment.

### 8.9 Accidental public document exposure

Symptoms: a verification document URL or object is reachable without authentication, or `STORAGE_BUCKET_PRIVATE` was pointed at the public bucket. Act: section 4 row four immediately; list the objects in the bucket and their last-access logs at the vendor; identify affected providers (`verification_documents.provider_id` for the exposed keys); this is a personal-data breach by default: DATA_BREACH_RESPONSE.md.

### 8.10 Suspicious provider document

Act per OPERATIONS_RUNBOOK.md §9: reject neutrally (`POST /admin/documents/{id}/reject` with a reason the provider will read), pause the provider's listings if there is a safety risk (`POST /admin/vehicles/{id}/suspend`), do not reveal the suspicion to the provider, record the facts in internal notes and the incident log, escalate to the founder and counsel. The document stays in private storage as evidence until counsel decides; the retention sweep must skip it (legal hold, DATA_RETENTION.md §4).

### 8.11 Double-refund concern

Symptoms: a customer reports two refunds, or the merchant portal shows a refund that the console does not, or `payments.refunded_amount` exceeds `amount` (the API refuses this: a refund larger than the remaining amount is rejected). Check: `GET /admin/payments/{id}` with its events (`payment.refund_recorded` rows carry mode, amount, reference), the merchant portal and bank statements. Act: record what the console allows (`POST /admin/payments/{id}/resolve` with a note describing the external correction); recover the overpayment outside the platform with the customer's consent; never edit `payments` rows. Escalate to the founder.

### 8.12 Unexpected booking overlap signal

Symptoms: a provider reports two bookings for the same vehicle and dates, or a customer finds the vehicle gone at pickup. The database makes a real overlap of holds impossible (`vehicle_holds_no_overlap` exclusion constraint; every hold writer locks the vehicle row first). Check: both bookings on `/admin/bookings/[id]`; their timelines; whether one is `requested` (requests never hold the vehicle), whether a manual block was deleted, or whether the provider accepted elsewhere (off-platform). Act: engineering runs the overlap query from BACKUP_AND_RESTORE.md §4 against production (expected 0); if it is not 0, treat as SEV1 and stop accepting until understood. Otherwise resolve commercially: cancel the booking that cannot be honoured by provider (full refund due) and record the refund.

## 9. Recovery and post-incident review

1. Confirm `GET /api/v1/ready` is green, the worker is processing (queue depths falling), and `/admin/payments` shows no new anomalies from the window.
2. Close the incident in the log with the timeline, impact (users, bookings, money), root cause, and what was changed.
3. Within five working days hold a short review: what was detected late, which runbook step was missing or wrong, which alert should exist. Update this runbook and, where code changes are needed, open them through the normal process with a decision record if architecture changes.
4. If personal data was involved, the breach decision log in DATA_BREACH_RESPONSE.md is part of the review.

## 10. Incident log template

```
Incident: <short title>            Severity: SEV<n>        Lead: <name>
Opened (UTC / Colombo): <time>     Closed: <time>
Detection: <signal and source>
Impact: <users / bookings / payments affected; money at risk>
Timeline:
  <UTC time> <who> <what was seen or done>
Evidence: <request ids, event ids, screenshots location; NO secrets>
Containment: <actions, routes, CLI commands used>
Communication: <who was told what, when>
Root cause: <>
Follow-ups: <owner, due date>
Personal data involved? <yes/no> -> DATA_BREACH_RESPONSE.md decision log reference
```
