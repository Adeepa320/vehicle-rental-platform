# Security and Privacy

**Status:** Draft v0.1 for review (2026-10-02)
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md) §9–10, [API_DESIGN.md](API_DESIGN.md)

> This document describes engineering controls. It is not legal advice. Items marked **[legal review]** must be confirmed with a Sri Lankan lawyer before launch, particularly obligations under the Personal Data Protection Act No. 9 of 2022 (PDPA). See [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md) appendix and [TECH_DECISIONS.md](TECH_DECISIONS.md) for the research notes that informed this.

---

## 1. Threat model (what we are protecting, from whom)

| Asset                                                             | Threats                                                            | Impact                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------- |
| Identity documents (NIC, passport, driving licence), bank details | Data breach, insider misuse, over-collection                       | Identity theft, regulatory penalties, loss of trust |
| Customer contact details and location                             | Scraping by competitors/spammers, stalking                         | Harassment, churn                                   |
| Booking and payment integrity                                     | Fake webhooks, replayed requests, double bookings, price tampering | Financial loss, disputes                            |
| Provider listings                                                 | Fake listings, stolen photos, fraudulent "verified" claims         | Trust collapse                                      |
| Accounts                                                          | Credential stuffing, OTP brute force, session theft                | Account takeover                                    |
| Admin panel                                                       | Privilege escalation, lateral movement                             | Full compromise                                     |
| Availability                                                      | Abusive bots creating requests, holding calendars                  | Provider churn                                      |

Principles: least privilege, least data, defence in depth, secure defaults, auditability.

---

## 2. Authentication

### 2.1 Methods

| Method                 | MVP   | Notes                                                                                                                                                                                                |
| ---------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email + password       | ✓     | Argon2id (memory 64 MiB, iterations 3, parallelism 1, tuned on target hardware); minimum 10 characters; checked against a breached-password list (k-anonymity API or bundled list); zxcvbn score ≥ 3 |
| Phone OTP (SMS)        | ✓     | Primary for Sri Lankan customers and all providers                                                                                                                                                   |
| Email OTP / magic link | ✓     | Verification and login for tourists without SMS access                                                                                                                                               |
| Google sign-in         | Later | OAuth 2.0 with PKCE; account linking only after email ownership is confirmed                                                                                                                         |
| Admin MFA              | ✓     | Email OTP on every admin login in MVP; TOTP app (RFC 6238) in Phase 10                                                                                                                               |

### 2.2 Session model

- **Access token:** JWT (ES256 or EdDSA), 15 minutes, claims `sub`, `roles`, `pid` (provider id), `sid` (session id), `iat`, `exp`, `aud`, `iss`. Not stored server side. Signing keys rotated via `kid`.
- **Refresh token:** opaque 256-bit random, 30 days (admins 8 hours), stored hashed (SHA-256) in `refresh_tokens` with a `family_id`. On every refresh the token is **rotated**; presenting an already-rotated token revokes the entire family (reuse detection) and alerts the user.
- **Web:** refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/v1/auth`; access token kept in memory only (never `localStorage`). CSRF for the refresh route mitigated by `SameSite=Lax` + custom header requirement (`X-Requested-With`) + origin check.
- **Mobile (future):** refresh token in platform secure storage; sent in the request body to `/auth/refresh`.
- `logout-all` revokes every session; password change and suspension do the same.

### 2.3 OTP security

- 6 digits from a CSPRNG; stored as HMAC-SHA256 with a server key; never logged.
- TTL 10 minutes; single use; max 5 verification attempts per code; then invalidate.
- Request limits: 3 per 15 minutes and 10 per day per destination; 20 per day per IP; global SMS budget circuit breaker (alert + block when spend exceeds a daily cap, to contain SMS-pumping fraud).
- Enumeration resistance: `otp/request` and `password/forgot` always return `202`; response times padded.
- Phone-number sanity: E.164 normalisation, Sri Lankan numbers validated against known prefixes; international numbers allowed for tourists but SMS to premium/high-risk prefixes blocked.
- OTP message template includes the service name and "never share this code".

### 2.4 Password handling

- Never logged, never emailed. Reset via single-use, 30-minute, hashed token.
- Password change requires current password (or recent OTP) and invalidates other sessions.
- No password hints, no security questions.

---

## 3. Authorization (RBAC + ownership)

### 3.1 Roles

| Role                 | Grants                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `customer` (default) | Own profile, search, bookings as customer, reviews on own bookings                                               |
| `provider`           | Everything a customer can do, plus own provider profile, locations, vehicles, bookings on own vehicles, ledger   |
| `admin`              | Verification, moderation, booking operations, disputes, settlements, reports, reading private documents (logged) |
| `super_admin`        | Admin + platform settings, admin user management, category/district management                                   |

Roles are claims in the access token; **ownership** is enforced in services (`booking.customer_id = caller` or `booking.provider_id = caller.pid`). Guards never trust client-supplied ids for ownership; they filter queries by the caller.

### 3.2 Rules worth stating explicitly

- Providers see customer PII (full licence number, phone) only from the configured reveal stage (`confirmed` by default), and only for their own bookings.
- Customers see provider phone/exact address only from the reveal stage.
- Registration numbers, exact pickup pins and documents are never in public responses.
- Admin document access produces an `admin_audit_logs` row with the document id.
- Admin accounts cannot be created through registration; only a `super_admin` can grant `admin`, and the grant is audited.
- Provider staff accounts (future `provider_members`) will have scoped permissions (e.g. `manage_bookings` without `view_ledger`).

---

## 4. Input validation and API hardening

- Every request body, query and path parameter validated by Zod schemas (shared `packages/contracts`); unknown fields rejected (`strict`).
- Output DTOs are explicit allow-lists; never serialise ORM entities directly (prevents accidental PII leakage when a column is added).
- SQL only through the query builder with parameters; raw SQL fragments (PostGIS) use bound parameters.
- Size limits: JSON bodies 256 KB; uploads via presigned URLs only (API never proxies file bytes).
- Security headers (Helmet): `Content-Security-Policy` (nonce-based; map tiles and storage origins allow-listed), `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (geolocation=self).
- CORS: API allows only the web origin(s); credentials allowed only for those.
- Rate limiting as per API_DESIGN §14, keyed by IP (with trusted proxy headers only from the CDN) and by user id when authenticated.
- Request ids on every request; propagated to logs and error responses.
- Timing-safe comparisons for all secrets, signatures and codes.
- Dependency hygiene: lockfile committed, `npm audit`/Renovate in CI, no post-install scripts from untrusted packages.

---

## 5. File upload and document security

| Control                 | Detail                                                                                                                                                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct-to-storage       | Clients upload via short-lived (5 min) presigned PUT URLs bound to a single key, content type and max size. The API never streams file bytes.                                                                                            |
| Buckets                 | `public` (vehicle photos, avatars, logos) served via CDN; `private` (identity, vehicle documents, dispute attachments, licence photos) never public, no listing.                                                                         |
| Validation              | MIME allow-list by purpose; server verifies magic bytes on `complete`; images re-encoded by the processing job (strips EXIF including GPS; defeats polyglot files); PDFs size-limited and served with `Content-Disposition: attachment`. |
| Access to private files | Only via API-issued signed URLs with ≤ 2-minute expiry, issued to the owner or an admin, every issuance logged.                                                                                                                          |
| Malware scanning        | Not in MVP (images are re-encoded; PDFs are only opened by admins in the browser's sandboxed viewer). ClamAV job is a Phase 10 option.                                                                                                   |
| Retention               | See §8.                                                                                                                                                                                                                                  |

---

## 6. Personal data inventory and minimisation

| Data                                                                                        | Collected from                    | Purpose                                                                                                                | Minimisation decision                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Name, email, phone                                                                          | All users                         | Account, notifications, booking communication                                                                          | Required; phone optional for tourists                                                                                                                                                                                                |
| Password hash                                                                               | Users with password               | Auth                                                                                                                   | Argon2id                                                                                                                                                                                                                             |
| Country of residence                                                                        | Optional                          | Tourist vs local UX, licence guidance                                                                                  | Optional                                                                                                                                                                                                                             |
| Driving licence number, country, expiry, class                                              | Self-drive customers              | Provider must verify driver eligibility; disputes                                                                      | Collected **per booking**, encrypted, purged after retention window; saving to profile is opt-in                                                                                                                                     |
| ID document type/number (NIC or passport)                                                   | Self-drive customers              | Provider identity check at handover; fraud deterrence                                                                  | Number only (encrypted); **no photo of the customer's ID in MVP**; provider sees the number only after confirmation                                                                                                                  |
| IDP number, Sri Lankan permit type/expiry (DMT temporary licence or AAC recognition permit) | Foreign self-drive customers      | Foreign drivers need an IDP plus a Sri Lankan permit; 2026 police operations held owners liable for unlicensed renters | Optional fields with guidance; the provider performs the physical check at handover; we do not store document images in MVP; three-wheeler bookings by foreigners show a restriction notice (DMT reportedly issues no such licences) |
| Date of birth                                                                               | Only when minimum-age rules apply | Age eligibility                                                                                                        | Optional, encrypted; consider replacing with "I am over N" attestation **[product decision]**                                                                                                                                        |
| Provider identity documents (NIC/passport/BR)                                               | Providers                         | Verification (trust)                                                                                                   | Required for the verified badge; private bucket; retained while the account is active                                                                                                                                                |
| Vehicle documents (CR, revenue licence, insurance)                                          | Providers                         | Verification; expiry tracking                                                                                          | Required for verified-vehicle badge                                                                                                                                                                                                  |
| Bank account details                                                                        | Providers                         | Settlements                                                                                                            | Encrypted; needed only once there is money to pay                                                                                                                                                                                    |
| Precise location (customer)                                                                 | Browser geolocation               | Nearby search                                                                                                          | Used in the request only; **never stored** (only the search centre rounded to ~1 km in optional analytics)                                                                                                                           |
| Provider location pin                                                                       | Providers                         | Pickup                                                                                                                 | Public only as approximate point until confirmation                                                                                                                                                                                  |
| Delivery address                                                                            | Customers choosing delivery       | Delivery                                                                                                               | Stored on the booking; purged with the driver snapshot                                                                                                                                                                               |
| Booking history, reviews                                                                    | Both                              | Trust signals                                                                                                          | Retained; anonymised on account deletion                                                                                                                                                                                             |
| IP, user agent                                                                              | Everyone                          | Security, rate limiting, audit                                                                                         | 90-day retention in logs                                                                                                                                                                                                             |

Explicit non-goals: no selfies/biometrics, no copies of customer NIC/passport in MVP, no continuous location tracking, no tracking pixels beyond privacy-respecting analytics.

---

## 7. Data protection: PDPA-aligned controls

Sri Lanka's PDPA (Act No. 9 of 2022, amended by Act No. 22 of 2025) establishes processing principles, controller/processor obligations, data-subject rights and a Data Protection Authority. Status as researched on 2026-10-02 (**[legal review]** to confirm): the Authority has existed since 2023; the originally announced 18 March 2025 commencement of the substantive parts was withdrawn; **Part I (principles) and Part III (controller/processor duties: DPO, breach notification, DPIA, cross-border) commence on 1 January 2027** (Gazette 2498/16 of 22 July 2026); Part II (data-subject rights), Part IV (unsolicited messages) and Part VII (administrative penalties, up to LKR 10 million per directive breach) have no commencement date yet. The Act applies to processing by entities established in Sri Lanka regardless of where servers sit, so Singapore hosting does not take us out of scope. Draft regulations (Oct 2024) set a DPO threshold of ≥25,000 data subjects or ≥20 persons processing, treat location tracking as "monitoring", and list cross-border transfer instruments (binding corporate rules, agreements with enforceable rights, codes, certification, impact assessment, board resolution). No controller registration is currently required. We build to Parts I–III from day one so penalties switching on later requires no rebuild.

| PDPA theme             | Engineering control                                                                                                                                                     |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Lawful basis & consent | Terms and privacy policy versioned (`users.terms_version`); explicit consent checkbox for driver details with purpose text; separate marketing consent (off by default) |
| Purpose limitation     | Data inventory above; new uses require a doc update and, where needed, re-consent                                                                                       |
| Data minimisation      | §6 decisions; per-booking collection; masking in UI                                                                                                                     |
| Accuracy               | Users can edit profile data; documents re-uploadable                                                                                                                    |
| Storage limitation     | Retention schedule §8 enforced by jobs                                                                                                                                  |
| Security               | Encryption in transit (TLS 1.2+), at rest (provider disk encryption + application-level AES-256-GCM for sensitive columns), access control, audit                       |
| Transparency           | Privacy policy in English, Sinhala and Tamil; plain-language "what the provider will see" notice before booking                                                         |
| Data-subject rights    | `GET /users/me` export (JSON) and deletion request endpoint (anonymisation); admin tooling for access requests; 30-day SLA **[legal review]**                           |
| Breach response        | Incident runbook (Phase 10): triage, containment, notification to the Authority and affected users within the statutory window **[legal review]**                       |
| Cross-border transfer  | Hosting region documented (ARCHITECTURE.md); processor list (hosting, email, SMS, payment, storage) maintained in the privacy policy; DPAs with vendors where offered   |
| Children               | Service is 18+ (self-drive requires a licence); no features targeted at minors                                                                                          |
| DPO / contact          | Named privacy contact email on the policy page; formal DPO appointment **[legal review]**                                                                               |

---

## 8. Data retention schedule (initial assumptions, pending legal review)

| Data                                                                            | Retention                                                                   | Mechanism                                           |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Account profile                                                                 | Life of account; anonymised on deletion                                     | `anonymise` job                                     |
| Booking records, payments, ledger, invoices                                     | 7 years (financial/tax)                                                     | Never deleted; PII fields reference anonymised user |
| Booking driver snapshots (`booking_drivers` encrypted fields, delivery address) | 90 days after booking end / cancellation                                    | Nightly purge job nulls encrypted columns           |
| Saved driver details (profile)                                                  | Until user deletes or account deletion                                      | User action                                         |
| Provider identity documents                                                     | While provider is active + 1 year after closure; rejected documents 30 days | Job                                                 |
| Vehicle documents                                                               | While vehicle active + 1 year; superseded documents 90 days                 | Job                                                 |
| OTP codes                                                                       | 24 hours                                                                    | Job                                                 |
| Refresh tokens                                                                  | Expiry + 30 days                                                            | Job                                                 |
| Access/application logs                                                         | 90 days                                                                     | Log platform retention                              |
| Admin audit logs                                                                | 2 years                                                                     | Append-only                                         |
| Webhook payloads                                                                | 2 years (sanitised: masked card numbers only)                               | Append-only                                         |
| Analytics events                                                                | 13 months, pseudonymous                                                     | Analytics tool                                      |

---

## 9. Encryption and secrets

- **Transport:** TLS everywhere, HSTS preload, HTTP → HTTPS redirect, TLS 1.2 minimum. Internal service-to-DB connections use TLS where the provider supports it.
- **At rest (platform):** managed Postgres and object storage encryption at rest enabled.
- **At rest (application):** `*_enc` columns encrypted with AES-256-GCM using a data-encryption key wrapped by a key-encryption key stored in the hosting provider's secret manager; ciphertext stores `key_id` to allow rotation; HMAC-SHA256 for searchable hashes.
- **Secrets:** environment variables injected by the platform; `.env` files git-ignored; secrets never printed in logs; rotation procedure documented in Phase 10; separate credentials per environment (sandbox PayHere keys in staging only).
- **Backups:** daily automated backups with encryption, 30-day retention, restore tested quarterly (Phase 10 DoD).

---

## 10. Payment security

- Card data never touches our servers: PayHere hosted checkout; PCI DSS scope stays at SAQ-A level **[verify with PayHere onboarding]**.
- Checkout parameters are generated server side; the `hash` is computed with the merchant secret server side; amount and currency come from the stored booking, never from the client.
- Webhook (`notify_url`) verification: `md5sig` recomputed with the merchant secret, `merchant_id` match, amount/currency match against the stored payment, status code mapping, idempotent processing by `payment_id + status_code`, raw payload stored. Webhooks that fail verification are logged and ignored (`200` returned to avoid retries storms, with alert).
- `return_url` is informational only; status is never updated from the browser redirect.
- Refunds (MVP manual) require admin role + reason + reference; later API-driven refunds will require 4-eyes approval above a threshold.
- Ledger entries are append-only; settlement totals are derived, never edited.

---

## 11. Abuse and fraud controls

| Risk                             | Control                                                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Fake providers / stolen photos   | Verification gate before publishing; reverse-image checks manual in MVP; admin review of first listing                          |
| Fake bookings tying up calendars | Requests do not hold calendars; max 3 open requests per customer; verified contact required; provider acceptance; expiry timers |
| Scraping listings                | Rate limits, bot detection at CDN (Cloudflare), no bulk export endpoints, approximate locations only                            |
| SMS pumping                      | Per-destination and per-IP caps, daily SMS budget circuit breaker, block of known high-risk prefixes                            |
| Account takeover                 | Argon2id, breached-password check, OTP limits, refresh rotation with reuse detection, login alerts for new devices (email)      |
| Review manipulation              | One review per completed booking only; provider cannot review-trade (no provider→customer reviews in MVP); admin moderation     |
| Admin compromise                 | MFA, short sessions, IP allow-list optional, audit logs, least privilege roles                                                  |

---

## 12. Logging, monitoring and audit

- Structured JSON logs (pino) with `requestId`, `userId` (not names), route, latency, status. **Redaction** list applied before emit: passwords, tokens, OTP codes, licence/ID numbers, bank accounts, full phone numbers (last 3 digits kept), card data.
- Audit trails: `booking_events` (all booking transitions), `admin_audit_logs` (all admin actions), `payment_webhook_events` (all gateway callbacks), document access events.
- Alerts: webhook signature failures, OTP rate-limit trips, exclusion-constraint violations spike (sign of a bug), failed job retries, 5xx rate, SMS budget threshold.
- Error tracking (Sentry) with PII scrubbing enabled.

---

## 13. Location data specifics

- Customer "current location" is used to centre a search and compute distances in that request only. It is not persisted with the user identity. Search analytics (if enabled) store the centre rounded to 0.01° (~1 km) without a user id.
- Provider locations are precise in the database but exposed publicly only as an approximate point (rounded to ~500 m) until a booking is confirmed.
- Delivery addresses are treated as booking PII (§8).
- Map tiles are requested by the browser directly from the tile provider; the provider sees the viewer's IP, which is disclosed in the privacy policy (processor list).

---

## 14. Secure development lifecycle

- Branch protection and code review for every change; CI runs typecheck, lint, tests, dependency audit, secret scanning (gitleaks), and a container scan.
- Threat-model review at the end of Phase 6 (booking) and Phase 7 (payments).
- Pre-launch (Phase 10): external penetration test or at minimum an OWASP ASVS Level 1 self-assessment; checklist stored in `docs/`.
- Security contact (`security@<domain>`) and a simple responsible-disclosure page.

---

## 15. Open items requiring decisions

1. **[legal review]** PDPA: confirm the 1 January 2027 commencement scope, the DPO threshold once regulations are final, the cross-border instrument we adopt for Singapore hosting (draft directive lists several), and the 72-hour breach-notification expectation in the draft rules; confirm SLTDA registration duties and stamp duty on hire agreements.
2. **[product]** Whether to collect date of birth or use an age attestation.
3. **[product]** Contact reveal stage: at `accepted` (helps coordinate before paying) vs `confirmed` (prevents off-platform deals). Recommendation: `confirmed`.
4. **[product]** Whether to require a licence photo upload from customers (stronger trust for providers vs more sensitive data). Recommendation: not in MVP; physical check at handover.
5. **[ops]** Retention numbers in §8 are assumptions to validate.
