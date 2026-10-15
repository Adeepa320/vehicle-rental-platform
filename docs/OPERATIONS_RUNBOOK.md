# Operations Runbook

**Status:** v0.1 (2026-10-15), written with Phase 9. Covers every manual procedure the admin console supports locally. Incident, breach, backup / restore and secret-rotation runbooks are Phase 10 deliverables and are only sketched in §9.
**Related:** [USER_FLOWS.md](USER_FLOWS.md) §3, [API_DESIGN.md](API_DESIGN.md) §13, [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [TECH_DECISIONS.md](TECH_DECISIONS.md) D53–D66, [README.md](../README.md) "Phase 9 — operating the marketplace".

## 0. Ground rules

- **Roles.** `admin` operates users, providers, listings, bookings, payments and refunds, disputes, reviews, documents, reports and reads the audit log. `super_admin` additionally changes platform settings and reference data. Accounts are created with `pnpm admin:grant --email <verified user> [--role super_admin]`; there is no admin UI for roles and no admin MFA yet (Phase 10) — treat admin credentials accordingly.
- **Everything is audited.** Every mutating action writes an `audit_events` row (actor, action, target, reason, metadata) in the same transaction as the change, and every admin document download is logged. Write reasons as if the affected person will read them (several are shown or e-mailed to them).
- **What the console cannot do, and why.** It cannot confirm a booking or record a payment (only a verified PayHere notification confirms; TECH_DECISIONS D55 / D66), cannot refund automatically (refunds are executed outside and _recorded_, D56), cannot move money through a dispute (D62), cannot edit a provider's prices or create listings (no concierge import), cannot delete reference data (deactivate instead) and cannot split the money pair (`advance_percentage` must equal `default_commission_rate`, D63). Do not look for workarounds in the database; ask for a decision record instead.
- **Wording.** "Approved provider" / "Platform-reviewed" for the Phase 3 manual check; "Verified provider" / "Verified vehicle" only while approved, in-date documents exist — the UI derives this; never promise it in writing.
- **Time.** Deadlines and calendar days are Asia/Colombo; the database stores UTC.

## 1. Provider verification

### 1.1 Review a provider application

1. **Console:** `/admin/providers` → application queue (`submitted` first). **API:** `GET /admin/provider-applications?status=submitted`.
2. Open the application: contact details, operating area, description, agreement acceptance. **Start review** (`POST …/start-review`; audit `provider_application.review_started`).
3. Call or e-mail the applicant and confirm identity of the contact, the operating area and that they actually rent vehicles. Note what you checked in `adminNotes` (internal).
4. Decide: **Approve** (`POST …/approve`; creates the profile and grants `provider` in one transaction; audit `provider_application.approved`; the applicant is e-mailed), **Request changes** with a reason the applicant will read (`…/request-changes`), or **Reject** with a reason (`…/reject`; terminal).
5. **Tell the applicant:** approval means they can list vehicles; it does not say "verified" publicly until documents are approved (§1.2).

### 1.2 Inspect, approve or reject provider documents

1. **Console:** `/admin/documents?scope=provider&status=pending` (or from the provider's page `/admin/providers/[id]`, Documents). **API:** `GET /admin/documents?scope=provider&status=pending`.
2. **Open** the document — it downloads (streamed, never rendered inline; audit `document.viewed` per download). Check that the name on the identity document matches the application contact / account name and, for a registered business, that the business registration names the same business as the profile.
3. **Approve** (`POST /admin/documents/{id}/approve { expiresOn?, note? }`; audit `document.approved`; provider notified). Set `expiresOn` when the document carries one and the provider left it empty.
   **Reject** (`…/reject { reason }`; audit `document.rejected`; provider notified with the reason) when it is unreadable, does not match, or is the wrong type.
   **Request replacement** (`…/request-replacement { reason }`) when the current document is acceptable for now but must be renewed or re-shot; it stays valid until replaced.
4. The "Verified provider" badge appears automatically once the identity document (plus business registration where applicable) is approved and in date. Nothing to toggle.
5. **If a document looks forged** — do not approve, do not reject with your suspicion as the public reason. Reject with a neutral reason ("document could not be verified"), write what you saw in the internal note on the application, and escalate (§9).
6. **Tell the provider:** what was approved / rejected and the reason; that a new upload of the same type replaces the old one; that expiry reminders will arrive 30 / 14 / 7 / 0 days before.

### 1.3 Suspend or reactivate a provider

1. **Console:** `/admin/providers/[id]` → **Suspend** `{ reason }` / **Reactivate** `{ note? }`. **API:** `POST /admin/providers/{id}/suspend | reactivate` (audit `provider_profile.suspended | reactivated`; e-mailed).
2. Suspension blocks provider-only actions and removes the provider's listings from search; **it never cancels bookings**. Read the operations panel first (`operations.bookings.open / confirmedOrActive`): decide per booking whether to cancel on behalf of the provider (§3.3, full refund) or let it run.
3. **Tell the provider:** the reason, what remains open, and what they must do to be reactivated.

## 2. Vehicle verification

### 2.1 Review a listing

1. **Console:** `/admin/vehicles?status=submitted` → listing. **API:** `GET /admin/vehicles?status=submitted`.
2. **Start review**, confirm specification, pricing and rules with the provider if anything looks off (admins never edit these), check the photos (3–12, real, not stock), then **Approve** / **Request changes** (reason) / **Reject** (reason). Audit `vehicle.review_started | approved | changes_requested | rejected`; the provider is e-mailed.
3. Approval makes the listing searchable (if the provider, location and category are active and it has ≥ 3 photos). Document verification is separate (§2.2) and not required for searchability.

### 2.2 Review vehicle documents

Same procedure as §1.2 with `scope=vehicle`. Check that the certificate of registration shows the registration number and make / model of the listing (the registration number is on `/admin/vehicles/[id]`), that the revenue licence and insurance are for that vehicle and their expiry dates are entered correctly (correct `expiresOn` on approval if not). "Verified vehicle" appears automatically while CR + revenue licence + insurance are approved, current and in date.

### 2.3 Expiry and auto-pause

- The daily sweep (`documents.expiry-sweep`, 06:30 Colombo) sends the provider one reminder per 30 / 14 / 7 / 0-day threshold. On the expiry day, if `auto_pause_on_document_expiry` is on and the expired document is the revenue licence or insurance, the listing is paused by the system (audit `vehicle.auto_paused`, status `suspended`, reason visible on the listing page). Bookings are not touched.
- **Console:** `/admin/documents?status=expired` and `?expiringWithinDays=30` are the work lists; the overview shows the counts.
- When a renewed document arrives: approve it (§2.2), then **Reactivate** the listing (§2.4). If a booking is already confirmed on a paused listing, decide with the provider whether it goes ahead (the vehicle must be legal to drive) or is cancelled on behalf of the provider (§3.3).

### 2.4 Photo moderation, pause / reactivate, category correction

1. **Pause:** `/admin/vehicles/[id]` → **Pause** `{ reason }` (`POST /admin/vehicles/{id}/suspend`; audit `vehicle.suspended`; provider notified in-app + e-mail). Use for policy breaches, safety concerns, unreachable providers.
2. **Reactivate:** **Reactivate** `{ note? }` (`POST …/reactivate`). The API checks: provider active, ≥ 3 photos, no expired revenue licence / insurance — a `409` lists what is missing. Fix the cause first (approve the renewed document; ask the provider for photos).
3. **Remove a photo:** **Remove** `{ reason }` on the photo (`POST …/photos/{photoId}/remove`; audit `vehicle_photo.removed_by_admin`; provider notified). If the listing falls below 3 photos it goes to `changes_requested` automatically so the provider uploads and resubmits — do not approve a listing with fewer photos.
4. **Correct the category:** **Correct category** `{ categoryId, reason }` (`POST …/category`; only an active category; audit `vehicle.category_corrected { from, to }`; provider notified). Scooter and tuk-tuk are inactive and cannot be chosen or activated until the product decision (PRODUCT_BRIEF §11).
5. **Tell the provider:** what changed and why; what they need to do to be live again.

## 3. Booking support

### 3.1 Find and inspect a booking

**Console:** `/admin/bookings` — search by partial reference, customer name or e-mail, vehicle, provider, status, rental period. `/admin/bookings/[id]` shows the booking, both parties with e-mails, the price and advance snapshot, the hold, every payment attempt with its events, the timeline (`booking_events`), the linked dispute and review, and the actions below. **API:** `GET /admin/bookings?q=…`, `GET /admin/bookings/{id}`.

### 3.2 Read the timeline

Each row is one transition or reveal with actor and time; metadata holds codes and ids only. Typical questions: "did the provider accept?" (`booking.accepted`), "was the advance paid?" (`booking.confirmed_by_payment` and the `paid` payment), "who cancelled?" (`booking.cancelled`, metadata `by` / `onBehalf`), "was the contact revealed?" (`booking.contact_revealed`).

### 3.3 Cancel on behalf of a party, or by the platform

1. **Console:** `/admin/bookings/[id]` → **Cancel** → choose the actor. The preview (`GET /admin/bookings/{id}/cancellation-preview?actor=customer|provider|platform`) shows whether it is allowed, the resulting status, whether the hold is released, the advance paid and the refund due or forfeited, with the hours before pickup and the threshold. It uses the same function as the real settlement — what it shows is what happens.
2. **Refund rule** (do not improvise): on behalf of the **customer** → full advance refund only if at least `cancellation_full_refund_hours` (48) before pickup, otherwise forfeited; on behalf of the **provider** → full refund; **platform** (operational reasons: safety, fraud, listing withdrawn) → full refund, status `cancelled_by_platform`. An `active` rental cannot be cancelled — the provider records the return. Final statuses are refused.
3. Confirm with a reason (`POST /admin/bookings/{id}/cancel { actor, reason, version }`; audit `booking.cancelled_by_admin`; timeline `booking.cancelled`; both parties notified in-app + e-mail). A `409 STALE_VERSION` means the booking changed meanwhile (typically the advance was just paid and it is now `confirmed`): reload, read the new preview, decide again.
4. If a refund is due, it now appears under `/admin/payments` — follow §4.3. Nothing is refunded automatically.
5. **Tell the parties:** the reason (it is e-mailed), the refund outcome and that a refund takes the usual gateway / bank time once recorded.

### 3.4 Resend a notification

**Console:** `/admin/bookings/[id]` → **Resend** → pick a template the state allows (confirmation; payment reminder while accepted and before the deadline; pickup reminder while confirmed and before pickup; cancellation notice; review request while the review window is open and no review exists). **API:** `POST /admin/bookings/{id}/resend { template }` (audit `booking.notification_resent`). E-mail only; the recipient is derived, never typed. Use when a customer says "I never got the e-mail" — check Mailpit / the mail provider first.

## 4. Payment issues

### 4.1 The anomaly queue

**Console:** `/admin/payments` lists every payment flagged `requires_manual_resolution`: `late_success` (a success arrived after the booking expired or was cancelled — the money was taken, the booking was **not** re-confirmed and no hold was recreated), `duplicate_payment`, `amount_mismatch`, `currency_mismatch`, `chargeback`, `refund_due` after a cancellation. **API:** `GET /admin/payments`, `GET /admin/payments/{id}` (with `events`).

### 4.2 Reconcile

**Check with gateway** (`POST /admin/payments/{id}/reconcile`) queries the PayHere Retrieval API when `PAYHERE_APP_ID` / `PAYHERE_APP_SECRET` are configured (otherwise `503 — not configured`; compare against the merchant portal by hand). Read `payment_events` for the attempt: a `signature_valid = false` row is a forged or misconfigured callback (§9), not a customer problem.

### 4.3 Refund due → record the refund

1. Execute the refund **outside** the platform: PayHere merchant portal (card) or bank transfer (the customer's bank details, collected by e-mail, are not stored).
2. **Record refund** on the payment (`POST /admin/payments/{id}/refund`, mode `manual` with the portal / transfer reference, or mode `gateway` to call the Refund API when credentials exist). Audit `payment.refund_recorded`; the customer is notified (`payment.refund_recorded`).
3. **Mark resolved** (`POST …/resolve`) when an anomaly needs no money movement (e.g. a duplicate that was already refunded). Audit `payment.resolved`.
4. **Never** bypass: no manual "paid" status, no editing `payments` rows, no re-confirming a booking after a late success — the customer must request again if they still want the dates.

### 4.4 A late success

The customer paid after expiry / cancellation. The booking stays expired / cancelled, the payment is `paid` with a `late_success` anomaly and a refund due. Refund per §4.3; tell the customer the dates were no longer reserved when the payment arrived and that a new request is needed.

## 5. Disputes

1. **Queue:** `/admin/disputes?status=open` (also the overview count). **API:** `GET /admin/disputes?status=open`.
2. **Read the thread** (`/admin/disputes/[id]`): who opened it, reason code, description, messages by role, both parties with e-mails, the booking summary and the payment summary. **Start review** (`POST …/start-review`; assigns you; audit `dispute.review_started`).
3. **Internal note** (`PUT …/internal-note { note }`): your findings, calls made, evidence — nobody is notified and participants never see it.
4. **Message** (`POST …/messages { body }`): a public platform message to both parties (notified). Ask for specifics; never paste one party's contact details to the other (they already have the reveal-stage contact).
5. **Resolve** (`POST …/resolve { resolutionCode, publicNote, internalNote? }`) with `no_action`, `provider_warning`, `customer_warning`, `refund_recommended`, `resolved_between_parties` or `other`, or **Reject** (`…/reject { publicNote }`). Both parties receive the public note. Audit `dispute.resolved | rejected`.
6. **Refunds are handled separately:** `refund_recommended` is a pointer. Go to the booking's payments and record the refund (§4.3) if one is due under the rules; a dispute never moves money and there are no ledger adjustments.
7. One dispute per booking; it cannot be reopened in this phase — if something new comes up, use the thread of the existing dispute while it is open or ask engineering to add a reopening rule (decision record).

## 6. User suspension and anonymisation

### 6.1 Suspend / reactivate

- **When:** abuse, fraud suspicion, repeated no-shows, a request from the account holder while a case is investigated.
- **Console:** `/admin/users/[id]` → **Suspend** `{ reason }` (`POST /admin/users/{id}/suspend`). Effects: status `suspended`, every session and refresh token revoked immediately (`403 ACCOUNT_SUSPENDED` on the next request), e-mail + in-app notice, audit `user.suspended`. Bookings, reviews and payments are untouched; a provider profile owned by the user is **not** suspended by this (do that separately, §1.3, after reading what is open).
- **Reactivate** `{ note? }` reverses it (audit `user.reactivated`; notified).
- You cannot suspend yourself; only a `super_admin` can suspend or reactivate another admin.

### 6.2 Anonymise (account deletion)

- **When:** a data-subject deletion request, or a closed account that must not keep personal data. Not a punishment — suspend for that.
- **Preconditions:** `/admin/users/[id]` shows `anonymisation.allowed` and the blockers: open bookings as customer or provider, open dispute, unresolved payment, refund due, privileged account, already anonymised. Resolve each first (cancel / complete bookings, close disputes, record refunds). Admin accounts are never anonymised — remove the role first via the CLI owner.
- **Procedure:** **Anonymise** → reason + type the account e-mail exactly (`POST /admin/users/{id}/anonymise { reason, confirmEmail }`). The API re-checks every blocker (`409 ACCOUNT_ANONYMISATION_BLOCKED` lists them).
- **Effects (one transaction):** e-mail replaced by `deleted+<id>@anonymised.invalid`, name "Deleted user", phone and country removed, password unusable, status `deleted`, all sessions / tokens revoked and one-time tokens deleted, application contact fields scrubbed, driver snapshots read "Former customer", an owned provider profile is scrubbed and suspended ("Owner account anonymised"). Bookings, payments, reviews (shown as "Former customer"), disputes and audit rows are kept for financial / legal retention. A courtesy e-mail goes to the old address. Audit `user.anonymised`.
- **Irreversible.** There is no undo; if in doubt, suspend and escalate.

## 7. Settings changes

1. **Console:** `/admin/settings` (`super_admin` to save; `admin` can read). **API:** `GET /admin/settings`, `PUT /admin/settings { changes: [{ key, value, expectedUpdatedAt }], reason? }`.
2. **Money pair:** `advance_percentage` and `default_commission_rate` must be equal — change both in the same save or the whole save is refused (`409 SETTING_MONEY_MODEL_UNSUPPORTED`). Splitting them means the platform would hold provider money (settlements, ledger, regulation) and needs a decision record first.
3. **Reason:** required when any high-impact key changes (money pair, cancellation threshold, contact reveal stage, response / payment windows, auto-pause). Write the business reason; it is in the audit log (`setting.updated` with before / after per key).
4. **Stale conflicts:** `409 SETTING_STALE` means another admin saved after you loaded the page — reload, re-read the current values, apply your change again.
5. **Effect on existing bookings:** none. Prices, advance amounts and refund thresholds are snapshotted at request / cancellation time; timers already running keep their deadlines. Only new quotes, requests, acceptances, reminders and sweeps use the new values. The worker picks up changes within a minute.
6. **Radius:** `default_search_radius_km` must be ≤ `max_search_radius_km`.

## 8. Reference data

1. **Console:** `/admin/reference` (`super_admin` to edit). **API:** `GET /admin/districts`, `PATCH /admin/districts/{id}`, `GET/POST /admin/places`, `PATCH /admin/places/{id}`, `GET /admin/vehicle-categories`, `PATCH /admin/vehicle-categories/{id}`.
2. **Activate a district** (`isActive: true`; audit `district.updated`) before adding its places; a district with no active places still yields no results.
3. **Add a place:** slug, name, kind, district, optional parent (a top-level place in the same district), aliases (what tourists type), the **town centre** coordinates and a default radius, launch-area flag, search rank (`POST /admin/places`; audit `place.created`). Places are town centres only — never a provider's pin. **Deactivate** instead of deleting (`PATCH { isActive: false }`): the place leaves suggestions, public lists and new provider locations; existing locations and bookings are untouched.
4. **Categories:** edit name, icon, sort order, licence class, active flag (audit `vehicle_category.updated`). **Scooter and tuk-tuk are protected** — activation is refused with the pending-decision reason until the product / legal decision on foreigner licensing (PRODUCT_BRIEF §11) is recorded.
5. There is no delete anywhere; reseeding never overwrites `is_active` flags you changed.

## 9. Basic incident escalation (interim until the Phase 10 runbooks)

| Symptom                                                                                                    | What to check                                                                                                                                                               | What to do                                                                                                                                                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| No e-mails, no expiries, no reminders, no document sweep                                                   | The worker is down. `pnpm dev:worker` locally; in production the worker process / its logs. `/ready` on the API.                                                            | Restart the worker. Everything queued in pg-boss is delivered afterwards; sweeps are idempotent (dedupe keys), so nothing is sent twice. Tell affected users nothing unless deadlines were missed; then extend by cancelling / re-requesting rather than editing timers. Escalate to engineering if it does not stay up. |
| A payment callback "looks wrong" (`signature_valid = false`, amount / currency mismatch, unknown order id) | `payment_events` for the attempt and the API log line `Payment notification rejected`; `PAYHERE_MERCHANT_SECRET` / `PAYHERE_NOTIFY_URL` configuration; the merchant portal. | Do not touch the booking or the payment row. If the customer was charged, reconcile (§4.2) and refund / resolve (§4.3). Repeated invalid signatures from the internet = possible forgery attempt or a secret mismatch: escalate to engineering immediately.                                                              |
| A document looks forged or an identity does not match                                                      | The document (download), the application notes, the provider's other documents and listings.                                                                                | Reject neutrally, pause the provider's listings if there is a safety risk (§2.4), do **not** tell the provider your suspicion, record the facts in internal notes, escalate to the founder / legal.                                                                                                                      |
| Suspected account compromise (user reports actions they did not take)                                      | `audit_events` / `booking_events` for the account, last login.                                                                                                              | Suspend the account (revokes every session), tell the user to reset the password through the normal flow once reactivated, escalate.                                                                                                                                                                                     |
| Data subject request (access / deletion)                                                                   | `/admin/users/[id]` for what is held and the anonymisation blockers.                                                                                                        | Access: engineering extracts the data (no self-service export yet). Deletion: §6.2 once blockers are cleared. Record the request date; PDPA artefacts and timelines are Phase 10.                                                                                                                                        |
| Anything involving money that the console does not model (chargeback letter, bank error, double refund)    | `payments` / `payment_events`, the merchant portal, bank statements.                                                                                                        | Record what the console allows (refund record / resolve with a note), keep the external references, escalate to the founder. Never edit rows by hand.                                                                                                                                                                    |

Full incident, breach-notification, backup / restore and secret-rotation runbooks, on-call and the support inbox are Phase 10 deliverables (ROADMAP).
