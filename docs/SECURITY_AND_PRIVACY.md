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

**Phase 3 note (2026-10-03):** admin MFA is **not implemented yet**. Admin accounts are created exclusively with the audited `pnpm admin:grant` CLI (requires database access; no hard-coded admin, no credentials in source) for existing, verified accounts, and use the normal e-mail + password login with the customer session model. E-mail-OTP/TOTP on admin login, shorter admin sessions and a `super_admin` UI for granting roles are **production-hardening items** that must ship before the admin console is reachable from the public internet.

### 2.2 Session model

- **Access token:** JWT (ES256 or EdDSA), 15 minutes, claims `sub`, `roles`, `pid` (provider id), `sid` (session id), `iat`, `exp`, `aud`, `iss`. Not stored server side. Signing keys rotated via `kid`.
- **Refresh token:** opaque 256-bit random, 30 days (admins 8 hours), stored hashed (SHA-256) in `refresh_tokens` with a `family_id`. On every refresh the token is **rotated**; presenting an already-rotated token revokes the entire family (reuse detection) and alerts the user.
- **Web:** refresh token in an `HttpOnly; Secure; SameSite=Lax` cookie scoped to `/v1/auth`; access token kept in memory only (never `localStorage`). CSRF for the refresh route mitigated by `SameSite=Lax` + custom header requirement (`X-Requested-With`) + origin check.
- **Mobile (future):** refresh token in platform secure storage; sent in the request body to `/auth/refresh`.
- `logout-all` revokes every session; password change and suspension do the same.

**As implemented in Phase 2 (2026-10-03):**

- Access tokens: EdDSA (Ed25519) via `jose`, 15 minutes, claims `sub`, `roles`, `sid` (refresh family), `iat`, `exp`, `iss`, `aud`, `jti`. Keys come from `JWT_PRIVATE_KEY`/`JWT_PUBLIC_KEY` (required in production); development and tests generate an ephemeral pair per process. `kid` rotation is a later addition.
- The auth guard loads the user row on every request (one primary-key lookup) and rejects tokens when the account is suspended/deleted or when `iat` precedes `users.sessions_revoked_at`. Logout-all, password reset and suspension therefore invalidate outstanding access tokens immediately, not after 15 minutes. Roles are taken from the row, not the token.
- Refresh tokens: 32 random bytes (base64url), SHA-256 at rest, 30 days (8 hours for admin roles), one family per login. Rotation claims the old row atomically (`revoked_at IS NULL → now()`), so concurrent use of one token cannot double-issue; any presentation of a revoked/rotated token revokes the whole family.
- Web cookie: `vrp_refresh`, `HttpOnly`, `SameSite=Lax`, `Secure` in production (configurable), path `/api/v1/auth` so it never accompanies other API calls; cleared on logout and on failed refresh.
- **CSRF strategy:** the only cookie-authenticated endpoints are `refresh`, `logout` and `logout-all`. They are protected by (1) `SameSite=Lax`, which withholds the cookie from cross-site POSTs; (2) an `OriginGuard` that rejects any request whose `Origin` (or `Referer`) is not one of `CORS_ORIGINS`; (3) CORS with credentials enabled only for those origins. The design's `X-Requested-With` requirement was dropped as redundant with (2). Access tokens are bearer headers held in memory, which CSRF cannot use.
- Mobile clients receive the refresh token in the response body and send it back in the body; no cookie is set.

### 2.3 OTP security

**Phase 2 note:** phone/SMS OTP is deferred (no SMS provider is configured). E-mail verification and password reset use **link tokens** instead of codes: 256-bit random, SHA-256 at rest in `one_time_tokens`, single use (consumed atomically), 24-hour (verification) / 30-minute (reset) expiry, at most 3 issued per account and purpose per 15 minutes (excess requests return `202` and do nothing), plus per-IP throttles. Requesting a new token supersedes the previous one. Raw tokens exist only inside the e-mail; they are never logged (e-mail payloads are not logged, addresses are masked).

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

**As implemented in Phase 2:** Argon2id with `memoryCost` 64 MiB, `timeCost` 3, `parallelism` 1 (`ARGON2_*` env; tests lower it). Policy: 10–128 characters, not a listed common password, not a single repeated character, not containing the e-mail local part or the user's name. The breached-password (k-anonymity) and zxcvbn checks remain Phase 10 items. Unknown e-mail and wrong password both return `401 INVALID_CREDENTIALS` after an equal-cost Argon2 verification (timing equalisation). Brute force is limited per IP (10 login attempts/min by default); a per-account lockout was deliberately **not** added because it hands attackers a denial-of-service lever against victims; revisit with risk-based signals in Phase 10. Password reset also marks the e-mail as verified (it proves ownership) and e-mails a "password changed" notice.

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

**As implemented in Phases 2–3:** `RolesGuard` reads roles from the user row on every request (not from token claims), so grants and revocations apply immediately. The `provider` role is granted only inside the approval transaction of a provider application — never from any client-writable field (all request schemas are strict and reject `roles`, `status` and review fields) — and `admin` / `super_admin` only through the audited CLI. `ActiveProviderGuard` additionally requires an active (not suspended) provider profile for provider-only actions. Applicant endpoints are all `/providers/me/...`; there is no by-id applicant endpoint, so one user cannot read another user's application.

### 3.2 Rules worth stating explicitly

- Providers see customer PII (full licence number, phone) only from the configured reveal stage (`confirmed` by default), and only for their own bookings.
- Customers see provider phone/exact address only from the reveal stage.
- Registration numbers, exact pickup pins and documents are never in public responses.
- Admin document access produces an `admin_audit_logs` row with the document id.
- Admin accounts cannot be created through registration; only a `super_admin` can grant `admin`, and the grant is audited. _(Phase 3: granted with `pnpm admin:grant` by someone with database access; the `super_admin` UI comes later. Every grant writes `audit_events` `admin.role_granted`.)_
- Trust wording: UI and e-mails say **"Approved provider"** / **"Platform-reviewed"**, never "Government ID verified" or "identity verified", because Phase 3 verification is a manual operator check of contact details and operating area, not a document check.
- Inventory ownership (Phase 4): every location, vehicle and availability-block query is scoped by the caller's provider id, so another provider's resource is `404` (ids are not enumerable). `ActiveProviderGuard` fronts all inventory routes; suspended providers receive `403 PROVIDER_SUSPENDED`. Request schemas are strict (`status`, `providerId`, review fields are rejected); identity fields are locked once a vehicle is approved; a provider can never approve, suspend or reactivate a vehicle (admin role required).
- Booking privacy (Phase 6): a booking is readable only by its customer, the vehicle's provider and admins — everyone else gets `404`. Responses are built by one role-aware allow-list mapper: the customer sees the registration number, exact pickup address, instructions and pin **only from the reveal stage** (`platform_settings.contact_reveal_stage`, default `confirmed`); the provider sees the customer's first name until then, the full name afterwards, and the driver snapshot from the start (that is what they decide on). Contact details (e-mail, phone, `wa.me` link) are never embedded in booking objects; they come from `GET /bookings/{id}/contact`, participants only, `403 CONTACT_NOT_AVAILABLE_YET` before the stage, and every reveal is written to the booking timeline. Customers cannot accept / decline / pick up (provider routes sit behind `ActiveProviderGuard`), providers cannot confirm (admin role), and the temporary `confirm-for-testing` action of Phase 6 was removed in Phase 7 (bookings are confirmed only by a verified gateway notification, §10). Prices are never taken from the client; `version` must match on every transition; the `Idempotency-Key` registry is scoped per customer. `booking_events.metadata` carries codes and ids only, never notes or contact data, and the table refuses updates; since 2026-10-06 customer and provider responses receive only a per-action allow-list projection of it (`VISIBLE_EVENT_METADATA` in `booking.mappers.ts`: no internal payment, hold or booking ids and no gateway references), while admins get the stored metadata for troubleshooting.
- Reviews (Phase 8): only the customer of a `completed` booking can create or edit its single review, inside the review window; identity fields come from the locked booking row and strict schemas reject client ids, status and moderation fields. Public review JSON is an allow-list (`review.mappers.ts`): ratings, comment, provider reply, dates and a first-name-plus-initial display name — never full names, e-mails, user or booking ids, travel dates or hidden reasons (e2e scans the raw JSON). Once a provider reply exists the customer review is locked (`409 REVIEW_LOCKED_AFTER_REPLY`), checked inside the transaction that holds the review row `FOR UPDATE` and again in the guarded UPDATE, so a public reply can never end up under a later-edited text. Providers reply once and only to published reviews of their own vehicles (`ActiveProviderGuard`, others `404`); only admins hide / unhide, with a required reason, an `audit_events` row and a customer notification. Comments are stored verbatim and rendered as text (React escapes; e-mails HTML-escape), never as HTML.
- Notifications (Phase 8): the feed is scoped to the caller (`user_id` in every query; another user's id is `404`); titles and bodies are platform-written, `link_path` is validated as an application-relative path on insert (no scheme, no `//`), `metadata` holds booking / review ids only and refuses payment, gateway or contact keys, and neither `metadata` nor `dedupe_key` is ever returned. Reminder sweeps are idempotent through the unique dedupe key, so a retry cannot resend. Provider metrics expose aggregates only (counts, percentages above a minimum sample, an average response time) — no customer, booking, payment or revenue data.
- Admin operations (Phase 9, TECH_DECISIONS D61–D66): every mutating admin endpoint is `RolesGuard` (`admin` / `super_admin`; settings and reference data `super_admin` only) + a strict Zod body + an `audit_events` row in the same transaction, with a reason wherever a person, listing or booking is affected. Admins cannot suspend or anonymise themselves; only a `super_admin` may suspend or reactivate another admin; privileged accounts are never anonymised. Suspension sets `sessions_revoked_at` and revokes every refresh token so the next request is refused with `403 ACCOUNT_SUSPENDED`. `GET /admin/users/{id}` never returns password hashes, tokens or session rows; anonymisation (§8) requires the account e-mail typed as confirmation and is refused while any retention blocker exists.
- Verification documents (Phase 9): uploaded only through the API under `ActiveProviderGuard` for the caller's own provider (and own vehicle), sniffed by content, stored under server-generated keys in the private bucket; the storage key and the bytes never appear in JSON. Reads are authenticated streaming endpoints for the owner (`404` for anyone else's document) and for admins, and **every admin read is audited** (`document.viewed`); there are no signed URLs. `expired` / `superseded` are derived, so a lapsed document can never keep a badge. Public responses carry only the `documentsVerified` booleans — never document types, numbers, dates or ids. See §5.
- Listing moderation (Phase 9): admins pause, reactivate (validated), correct the category and remove photos, each with a reason and an audit row; they never edit prices or provider-controlled commercial fields and never create listings on a provider's behalf. A listing that drops below the photo minimum returns to `changes_requested` rather than being padded. Protected categories (scooter, tuk-tuk) cannot be activated from the console.
- Booking operations (Phase 9): admin cancellation goes through the booking state machine (`BookingsService.cancelByAdmin`; new `cancelled_by_platform`), never from `active` or a final status, with `version` checks and the same refund function as the real settlement; there is **no manual, fake or admin confirmation path** and no generic status route. Re-sends are an allow-list of templates whose recipient, subject and body are derived server-side; the response carries only a masked recipient; nothing free-text leaves the console.
- Disputes (Phase 9): only the booking's customer or the vehicle's owner can open, read or post (everyone else `404`); participant JSON is an allow-list (`modules/disputes/dispute.mappers.ts`: no internal note, e-mails, phones, user ids or assigned admin; authors appear as role labels / display names, "Former customer" after anonymisation); messages are append-only at the database; opening and posting are rate-limited per IP (`THREAD_POSTS_PER_15MIN`). A resolution never moves money.
- Settings (Phase 9): `PUT /admin/settings` is `super_admin` only, validated per key against the typed allow-list, optimistic (`409 SETTING_STALE`), reason-required for high-impact keys, guarded by the `advance_percentage = default_commission_rate` invariant, and audited per key with before / after; changes affect new decisions only — never stored price or advance snapshots.
- Audit viewer (Phase 9): read-only; `metadata` keys matching `secret | token | hash | sig | password | card | cookie | authorization` are dropped before serving; `ip` is never exposed; there is no write route.
- Search logs (Phase 9): `search_logs` stores normalised criteria and the first-page result count only — never an IP address, user id, session, free text or coordinates — and is written best-effort after the response is computed, so logging can never fail a search.
- CSV exports (Phase 9): RFC 4180 quoting, UTF-8 BOM, CRLF; cells starting with `=`, `+`, `-`, `@`, tab or CR are prefixed with `'` to defeat spreadsheet formula injection; exports contain aggregates and provider display names only — no e-mails, secrets, tokens or object keys.
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

**Phase 3 note (2026-10-03):** no identity or business documents are collected; provider verification is a manual operator process (phone / e-mail). Document collection and the signed-URL controls in this table arrive together in a later phase.

**Phase 5 (2026-10-04) — vehicle listing photos, the first files (TECH_DECISIONS D42–D43):** uploads go **through the API** (`multipart/form-data`, ≤ 10 MB, one file per request) under `ActiveProviderGuard` and the caller's own vehicle in an editable state; the browser never holds storage credentials. The server **sniffs the bytes with sharp** (JPEG/PNG/WebP only — SVG, GIF, executables and mislabelled files are refused with `415`), rejects images below 320×240 or above 50 megapixels (image-bomb guard), applies EXIF orientation, **strips all metadata** (EXIF/GPS, ICC, XMP) and writes three WebP variants. Object keys are server-generated from UUIDs (`vehicles/<vehicleId>/<photoId>/…`) and checked against a strict pattern; client paths are never used. Originals live in a **private** bucket, variants in a **public-read** bucket served from `STORAGE_PUBLIC_URL`. Storage is **MinIO, development-only**, through the S3 API (`@aws-sdk/client-s3`); no cloud storage account exists and the production provider remains a deployment decision (D7). At most 12 photos per listing; removal soft-deletes the row and deletes the objects best-effort. Malware scanning is still not in MVP.

**Phase 9 (2026-10-15) — verification documents as implemented (TECH_DECISIONS D61):** provider identity / business-registration documents and vehicle CR / revenue licence / insurance / emission certificates are uploaded **through the API** (`POST /providers/me/documents`, `multipart/form-data`, ≤ 10 MB, one file) under `ActiveProviderGuard` for the caller's own provider and vehicle. The server **sniffs the bytes** (PDF, JPEG, PNG only — `415` for anything else by content, `413` oversized), records `sha256`, `mime_type` and `size_bytes`, and stores the original under a server-generated key `documents/<providerId>/<documentId>.<ext>` in the **private** bucket; the key is never returned. Reads are **authenticated streaming endpoints** — `GET /providers/me/documents/{id}/content` (owner only; others `404`) and `GET /admin/documents/{id}/content` (every read audited `document.viewed`) — with `Content-Disposition: attachment` and `Cache-Control: private, no-store`; **no signed URLs are issued**, so there is no link to share, forward or leak through logs. Admin decisions (approve / reject / request replacement) are audited and notified. A new upload supersedes the previous one of the same type; nothing is deleted yet (retention jobs pending). Malware scanning remains a Phase 10 option; documents are never rendered inline.

| Control                 | Detail                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Direct-to-storage       | Clients upload via short-lived (5 min) presigned PUT URLs bound to a single key, content type and max size. The API never streams file bytes. _Not applied (Phases 5 and 9): photos and documents are API uploads; the browser never holds storage credentials._                                                                                                                  |
| Buckets                 | `public` (vehicle photos, avatars, logos) served via CDN; `private` (identity, vehicle documents, dispute attachments, licence photos) never public, no listing. _Applies (Phase 9): documents and photo originals in the private bucket, photo variants in the public bucket._                                                                                                   |
| Validation              | MIME allow-list by purpose; server verifies magic bytes on `complete`; images re-encoded by the processing job (strips EXIF including GPS; defeats polyglot files); PDFs size-limited and served with `Content-Disposition: attachment`. _Applies (Phase 9): bytes sniffed at upload (PDF / JPEG / PNG), ≤ 10 MB, served as attachments; document images are stored as uploaded._ |
| Access to private files | Only via API-issued signed URLs with ≤ 2-minute expiry, issued to the owner or an admin, every issuance logged. _Replaced (Phase 9): authenticated streaming endpoints for the owner and admins, every admin read logged; no signed URLs at all._                                                                                                                                 |
| Malware scanning        | Not in MVP (images are re-encoded; PDFs are only opened by admins in the browser's sandboxed viewer). ClamAV job is a Phase 10 option. _Unchanged._                                                                                                                                                                                                                               |
| Retention               | See §8. _Phase 9: retention jobs not yet implemented; superseded and rejected documents are kept with their timestamps._                                                                                                                                                                                                                                                          |

---

## 6. Personal data inventory and minimisation

**Phase 6 (2026-10-04) — booking data as implemented:** a booking stores the driver's **name, country of residence (optional), licence-issuing country and licence expiry date** only (`booking_drivers`); licence numbers, ID numbers, IDP numbers and document images are **not** collected (the provider checks the physical licence at handover) because the field-encryption helpers of §5 do not exist yet. Booking notes (customer, provider, decline, cancellation, no-show, handover) are free text shown to the other party and bounded to 500–1000 characters. The timeline (`booking_events`) stores action codes, status changes, reason codes and ids — never notes or contact data. Contact details are revealed to the counterparty only from the configured stage and each reveal is logged. Bookings cascade-delete with the user account (`ON DELETE CASCADE`), which also removes the driver snapshot, timeline and idempotency rows; the retention windows below still apply once account deletion and anonymisation are implemented.

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

**Phase 9 (2026-10-15) — anonymisation as implemented (TECH_DECISIONS D65).** Anonymisation is **admin-driven** (`POST /admin/users/{id}/anonymise`, reason + the account e-mail typed as confirmation; the self-service deletion request is still unbuilt and will reuse the same service) and refused (`409 ACCOUNT_ANONYMISATION_BLOCKED`) while the account has an open booking as customer or provider, an open dispute, an unresolved payment or a refund due, or holds `admin` / `super_admin`. **Removed:** e-mail (replaced by `deleted+<id>@anonymised.invalid`), full name ("Deleted user"), phone, country, password (unusable marker), all sessions / refresh tokens / one-time tokens, provider-application contact fields, the driver name on booking snapshots ("Former customer"), and the contact name, phone, WhatsApp, address, website and description of an owned provider profile (which is suspended as "Owner account anonymised"). **Kept** (financial / audit retention): user id and `deleted_at`, bookings, payments and payment events, reviews (shown as "Former customer"), disputes and messages, notifications, audit rows and the booking driver snapshot's licence country and expiry. The action is irreversible and audited `user.anonymised`; a courtesy e-mail goes to the old address. Not yet implemented: the nightly purge of driver snapshots, document retention purges (superseded / rejected documents are kept), `search_logs` pruning (rows hold no personal data).

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

**As implemented in Phase 7 (2026-10-06, TECH_DECISIONS D53–D56).** Checkout fields and the PayHere `hash` are computed server side from `bookings.advance_amount` (`POST /bookings/{id}/payments/checkout`, customer only, strict empty body); the response never contains the merchant secret, and the merchant secret, hashes and signatures are never logged. `POST /payments/payhere/notify` is the only unauthenticated mutating route: it recomputes `md5sig` from the received strings with a timing-safe compare **before any database write**, checks `merchant_id`, the order, the currency and the amount against the stored attempt, and always answers `200` (a forged, replayed or unknown message only produces a `payment_events` row with `signature_valid` and a `reason`, so there is nothing for an attacker to learn or to retry). Idempotency is the unique `(gateway, gateway_payment_id)` plus status-conditioned updates in one transaction (lock order vehicle → booking → payment); a verified success is never downgraded by a later message, and a success for a booking that can no longer be confirmed is recorded with an anomaly and a refund due instead of touching the booking or the calendar. `return_url` / `cancel_url` carry no outcome: the status page polls the API. Nothing from the gateway is stored raw — `payment_events.metadata` holds codes, ids, amounts and reasons; card holder, masked card number and expiry are discarded on receipt; no card data ever reaches the platform (hosted checkout). Refunds require the admin role, a reason and a reference (manual) or merchant-API credentials (gateway), are audited, and are never executed automatically; the four-eyes rule above a threshold remains future work. The fake gateway and its simulator routes are refused in production by the environment schema (`PAYMENT_GATEWAY=fake` rejected; merchant credentials and a public `PAYHERE_NOTIFY_URL` required for `payhere`). PCI scope: hosted checkout; SAQ-A still to be confirmed at onboarding.

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
  **Phase 3:** implemented as `audit_events` (actor, action, target, reason, metadata, ip), written in the same transaction as the change: every admin review decision, suspension / reactivation, application submission, provider profile update and CLI role grant. Application logs mask e-mail addresses and never contain reasons, notes or form contents.
  **Phase 9 (2026-10-15):** every mutating admin endpoint (users, documents, listings, bookings, disputes, settings, reference data) writes `audit_events` with a reason where a person, listing or booking is affected; settings and reference changes carry `before` / `after` in `metadata`; **every admin document read** is logged as `document.viewed`; system actions (`vehicle.auto_paused`) are recorded with actor `system`. `GET /admin/audit-events` is a **read-only** viewer (filters on actor, action prefix, target, time; keyset pagination) that drops `metadata` keys matching `secret | token | hash | sig | password | card | cookie | authorization` and never exposes `ip`; no route updates or deletes rows. Document access events are therefore in the same table as every other admin action.
- Alerts: webhook signature failures, OTP rate-limit trips, exclusion-constraint violations spike (sign of a bug), failed job retries, 5xx rate, SMS budget threshold.
- Error tracking (Sentry) with PII scrubbing enabled.

---

## 13. Location data specifics

- Customer "current location" is used to centre a search and compute distances in that request only. It is not persisted with the user identity. Search analytics (if enabled) store the centre rounded to 0.01° (~1 km) without a user id.
- Provider locations are precise in the database but exposed publicly only as an approximate point (rounded to ~500 m) until a booking is confirmed.
  **Phase 4 (2026-10-03):** coordinates are optional and typed in by the provider (no geocoding, no map API); district and gazetteer place are the required location data. Precise points, addresses, pickup instructions and full registration numbers are returned only to the owning provider and to admins. No public endpoint exposes locations or vehicles yet; the contracts ship `maskRegistrationNumber` for the first public view.
  **Phase 5 (2026-10-04):** public search and listing pages (`GET /vehicles/search`, `GET /vehicles/{slug}`) are built by allow-list mappers only. Location is exposed as `approxPoint` — the provider pin **snapped to a 0.005° grid (≈ 550 m)** or the town centre when there is no pin (`source: approximate | place`) — plus town and district names. They never contain the registration number (not even masked), address, pickup instructions or notes, exact coordinates, provider phone/WhatsApp/e-mail, internal names or admin/review notes. Map tiles come from a configurable open style URL (OpenFreeMap by default); the tile host sees viewer IPs as noted above. An e2e privacy test asserts the forbidden strings are absent from the raw JSON.
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
