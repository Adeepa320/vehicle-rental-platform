# API Design

**Status:** Draft v0.1 for review (2026-10-02). Phases 1–5 are implemented locally; each implemented group carries an "As implemented" note recording deviations from this draft (Auth §3.0, Users §4, Providers §5.0, Locations §6.0, Vehicles §7.0, Photos §7.2, Public vehicles & search §8.0, Reference & places §9.0, Uploads §12, Admin §13.0).
**Related:** [ARCHITECTURE.md](ARCHITECTURE.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md), [USER_FLOWS.md](USER_FLOWS.md)

---

## 1. Conventions

| Topic          | Convention                                                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL       | `https://api.<domain>/api/v1` (production), `http://localhost:4000/api/v1` (local). The `/api` prefix is the NestJS global prefix; `v1` is the URI version. (Implemented in Phase 1; this document's shorter `/v1` paths are relative to that base.) |
| Style          | REST, JSON request/response, `application/json; charset=utf-8`                                                                                                                                                                                       |
| Versioning     | URI version `v1` under the `/api` prefix. Additive changes are non-breaking; breaking changes require `v2` and a decision record                                                                                                                     |
| IDs            | UUIDs (v7). Public vehicle and provider URLs also accept `slug`                                                                                                                                                                                      |
| Authentication | `Authorization: Bearer <access JWT>` (15 min). Refresh via httpOnly cookie (`web`) or body (`mobile`). See [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)                                                                                        |
| Authorization  | Role-based guards (`customer`, `provider`, `admin`, `super_admin`) + ownership checks in services                                                                                                                                                    |
| Time           | ISO 8601 with offset. Clients send `Asia/Colombo` local times with offset (`2026-11-12T09:00:00+05:30`); server stores UTC                                                                                                                           |
| Money          | Decimal strings (`"7500.00"`) plus `currency` (`"LKR"`)                                                                                                                                                                                              |
| Pagination     | Cursor-based: `?limit=20&cursor=<opaque>` → `{ data: [...], nextCursor: string \| null }`. Search uses `offset` (bounded, max page 10) because it needs a stable total count                                                                         |
| Idempotency    | `Idempotency-Key: <uuid>` header required on `POST /bookings` and `POST /bookings/{id}/payments/checkout`; replayed within 24 h returns the original response                                                                                        |
| Validation     | All inputs validated with the shared Zod schemas in `packages/contracts`; validation errors → `400` with field details                                                                                                                               |
| Rate limiting  | Per-IP and per-user buckets (see §13 and SECURITY doc). `429` with `Retry-After`                                                                                                                                                                     |
| Errors         | Uniform envelope (§2)                                                                                                                                                                                                                                |
| Localisation   | `Accept-Language: en \| si \| ta` affects human-readable `message` strings and vehicle category names only                                                                                                                                           |
| OpenAPI        | To be generated from the Zod contracts and served at `/api/v1/openapi.json` (non-production). Deferred to Phase 2 when the first request DTOs exist (TECH_DECISIONS D18)                                                                             |
| Health         | `GET /api/v1/health` (liveness, no dependencies) and `GET /api/v1/ready` (database, PostGIS, migrations; 200 or 503 with the same body shape) — implemented in Phase 1                                                                               |

### 1.1 Error envelope

```json
{
  "error": {
    "code": "BOOKING_CONFLICT",
    "message": "This vehicle is no longer available for the selected dates.",
    "details": [{ "field": "startsAt", "issue": "must be in the future" }],
    "requestId": "01J9X3..."
  }
}
```

Common codes: `VALIDATION_ERROR` (400), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `BOOKING_CONFLICT` (409), `STALE_VERSION` (409), `QUOTE_CHANGED` (409), `INVALID_STATE_TRANSITION` (409), `RATE_LIMITED` (429), `PAYLOAD_TOO_LARGE` (413), `UNSUPPORTED_MEDIA_TYPE` (415), `INTERNAL` (500).

### 1.2 Standard objects

`Money`: `{ "amount": "7500.00", "currency": "LKR" }`
`GeoPoint`: `{ "lat": 5.9485, "lng": 80.4718 }`
`Image`: `{ "id": "...", "thumb": "https://...", "medium": "https://...", "large": "https://...", "width": 1600, "height": 1067 }`
`Actor` (on events): `{ "type": "provider", "id": "..." }`

---

## 2. Endpoint index

| Group               | Endpoints (MVP unless marked _Later_)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auth                | `POST /auth/register`, `POST /auth/login`, `POST /auth/otp/request`, `POST /auth/otp/verify`, `POST /auth/refresh`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/password/forgot`, `POST /auth/password/reset`, `POST /auth/email/verify`, `GET /auth/oauth/google` _Later_                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Users               | `GET /users/me`, `PATCH /users/me`, `PUT /users/me/driver-details`, `DELETE /users/me/driver-details`, `POST /users/me/phone/change`, `POST /users/me/delete-request`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Providers           | `POST /providers`, `GET /providers/me`, `PATCH /providers/me`, `POST /providers/me/submit-verification`, `GET /providers/me/documents`, `POST /providers/me/documents`, `DELETE /providers/me/documents/{id}`, `PUT /providers/me/bank-details`, `GET /providers/me/dashboard`, `GET /providers/me/ledger`, `GET /providers/{idOrSlug}` (public)                                                                                                                                                                                                                                                                                                                                                                                                           |
| Locations           | _Phase 4 implemented:_ `GET/POST /providers/me/locations`, `GET/PATCH/DELETE /providers/me/locations/{id}` (DELETE = deactivate). _Original:_ `GET /providers/me/locations`, `POST /providers/me/locations`, `PATCH /providers/me/locations/{id}`, `DELETE /providers/me/locations/{id}`                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Vehicles (provider) | _Phase 4 implemented:_ `GET/POST /providers/me/vehicles`, `GET/PATCH /providers/me/vehicles/{id}`, `POST …/{id}/submit`, `POST …/{id}/deactivate`, `POST …/{id}/activate`. _Original:_ `GET /providers/me/vehicles`, `POST /providers/me/vehicles`, `GET /providers/me/vehicles/{id}`, `PATCH /providers/me/vehicles/{id}`, `DELETE /providers/me/vehicles/{id}`, `POST /providers/me/vehicles/{id}/photos`, `PATCH /providers/me/vehicles/{id}/photos/order`, `DELETE /providers/me/vehicles/{id}/photos/{photoId}`, `POST /providers/me/vehicles/{id}/documents`, `DELETE /providers/me/vehicles/{id}/documents/{docId}`, `POST /providers/me/vehicles/{id}/submit`, `POST /providers/me/vehicles/{id}/pause`, `POST /providers/me/vehicles/{id}/resume` |
| Vehicles (public)   | _Phase 5 implemented:_ `GET /vehicles/search`, `GET /vehicles/{idOrSlug}` (§8.0). _Original:_ `GET /vehicles/{idOrSlug}`, `GET /vehicles/{id}/availability`, `GET /vehicles/{id}/quote`, `GET /vehicles/{id}/reviews`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Availability        | _Phase 4 implemented:_ `GET /providers/me/vehicles/{id}/availability?from&to`, `GET/POST /providers/me/vehicles/{id}/blocks`, `DELETE …/blocks/{blockId}`. _Original:_ `GET /providers/me/vehicles/{id}/calendar`, `POST /providers/me/vehicles/{id}/blocks`, `DELETE /providers/me/vehicles/{id}/blocks/{holdId}`                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Search & places     | _Phase 5 implemented:_ `GET /vehicles/search` (replaces `/search/vehicles`), `GET /places/suggest` (§9.0). _Original:_ `GET /search/vehicles`, `GET /search/map`, `GET /places/suggest`, `GET /places/{idOrSlug}`, `GET /vehicle-categories`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Bookings            | `POST /bookings`, `GET /bookings`, `GET /bookings/{idOrRef}`, `GET /bookings/{id}/events`, `POST /bookings/{id}/cancel`, `POST /bookings/{id}/accept`, `POST /bookings/{id}/decline`, `POST /bookings/{id}/pickup`, `POST /bookings/{id}/return`, `POST /bookings/{id}/no-show`, `GET /bookings/{id}/contact`, `POST /bookings/{id}/disputes`, `GET /bookings/{id}/disputes/{disputeId}`, `POST /disputes/{id}/messages`                                                                                                                                                                                                                                                                                                                                   |
| Payments            | `POST /bookings/{id}/payments/checkout`, `POST /payments/payhere/notify` (webhook), `GET /bookings/{id}/payments`, `POST /bookings/{id}/payments/record` (provider manual)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Reviews             | `POST /bookings/{id}/review`, `GET /providers/{id}/reviews`, `POST /reviews/{id}/reply`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Notifications       | `GET /notifications`, `POST /notifications/{id}/read`, `POST /notifications/read-all`, `GET /notifications/unread-count`, `PUT /notifications/preferences` _Later_, `POST /devices` _Later_                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Uploads             | _Phase 5 implemented as API uploads:_ `POST /providers/me/vehicles/{id}/photos` (§7.2); no presign flow yet. _Original:_ `POST /uploads/presign`, `POST /uploads/{fileId}/complete`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Admin               | see §13 (Phase 3 implemented `/admin/provider-applications…`, `/admin/providers…`). Reference (Phase 3): `GET /reference/districts`, `GET /reference/places`, `GET /reference/vehicle-categories`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| System              | `GET /health`, `GET /ready`, `GET /openapi.json`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

---

## 3. Auth

### 3.0 As implemented in Phase 2 (2026-10-03)

The lean Phase 2 implements e-mail + password accounts only. Differences from the original design below are deliberate and documented in TECH_DECISIONS D23–D29:

| Endpoint                                          | Status   | Notes                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`                             | ✓        | Body `{ fullName, email, password, acceptTerms: true, preferredLanguage?, countryCode? }` (no phone). Server stamps `terms_version`. `201 { user, verification: { emailSent } }`. `409 EMAIL_ALREADY_REGISTERED`. Roles cannot be supplied.                                                                                                                            |
| `POST /auth/email/verify`                         | ✓        | `{ token }` from the e-mailed link (`WEB_APP_URL/verify-email?token=…`), 24 h, single use. `200 { verified: true, email }`; `400 TOKEN_INVALID` / `TOKEN_EXPIRED`.                                                                                                                                                                                                     |
| `POST /auth/email/resend-verification`            | ✓        | `{ email }` → always `202 { message }`; max 3 tokens per account per 15 min (silently dropped beyond).                                                                                                                                                                                                                                                                 |
| `POST /auth/login`                                | ✓        | `{ email, password, client?: 'web' \| 'mobile' }`. `200 { tokenType: 'Bearer', accessToken, expiresIn, user, refreshToken? }`; web gets the refresh token as the `vrp_refresh` HttpOnly cookie (path `/api/v1/auth`), mobile in the body. `401 INVALID_CREDENTIALS`, `403 EMAIL_NOT_VERIFIED`, `403 ACCOUNT_SUSPENDED`. Login is blocked until the e-mail is verified. |
| `POST /auth/refresh`                              | ✓        | Cookie or `{ refreshToken }`. Rotates within the family; reuse revokes the family. Origin/Referer must be an allowed web origin (CSRF). `401 REFRESH_INVALID` clears the cookie.                                                                                                                                                                                       |
| `POST /auth/logout`                               | ✓        | Revokes the presented refresh token, clears the cookie, `204`. Public (works with an expired access token).                                                                                                                                                                                                                                                            |
| `POST /auth/logout-all`                           | ✓        | Bearer required. Revokes all refresh tokens and sets `users.sessions_revoked_at`, which invalidates outstanding access tokens immediately. `204`.                                                                                                                                                                                                                      |
| `POST /auth/password/forgot`                      | ✓        | `{ email }` → always `202 { message }`; 30-minute single-use link `WEB_APP_URL/reset-password?token=…`.                                                                                                                                                                                                                                                                |
| `POST /auth/password/reset`                       | ✓        | `{ token, newPassword }` → `200 { message }`; revokes every session, marks the e-mail verified, sends a "password changed" notice.                                                                                                                                                                                                                                     |
| `POST /auth/otp/request`, `POST /auth/otp/verify` | deferred | Phone/SMS OTP arrives with the SMS phase; the e-mail link flow covers verification until then.                                                                                                                                                                                                                                                                         |
| `GET /auth/oauth/google`                          | later    | Unchanged.                                                                                                                                                                                                                                                                                                                                                             |

Rate limits (per IP, defaults): login 10/min; register, forgot, resend 5/15 min; verify/reset 20/15 min; refresh/logout 60/min; plus the global limit. OpenAPI for all of the above: `GET /api/docs-json`, UI at `/api/docs` (non-production).

### 3.1 `POST /auth/register` (original design)

Create an account with email+password, or phone-first (password optional, OTP login).

- **Auth:** none. Rate limit 5/min/IP, 20/day/IP.
- **Body**
  ```json
  {
    "fullName": "Nimal Perera",
    "email": "nimal@example.com",
    "phone": "+94771234567",
    "password": "correct horse battery",
    "countryCode": "LK",
    "preferredLanguage": "en",
    "acceptTerms": true,
    "termsVersion": "2026-10"
  }
  ```
- **Validation:** `fullName` 2–100 chars; at least one of `email` (RFC 5322, lowercased) / `phone` (E.164); `password` ≥ 10 chars, not in breached list (zxcvbn score ≥ 3), required when `email` given and `phone` absent; `acceptTerms` must be `true`.
- **Response 201**
  ```json
  {
    "user": {
      "id": "...",
      "fullName": "...",
      "email": "...",
      "emailVerified": false,
      "phone": "+94771234567",
      "phoneVerified": false,
      "roles": ["customer"]
    },
    "verification": { "emailSent": true, "smsSent": true }
  }
  ```
  No tokens are issued until the email or phone is verified (`POST /auth/otp/verify`).
- **Errors:** `409 CONFLICT` (`email`/`phone` already registered — response is identical in timing to avoid enumeration beyond this explicit code; see security doc), `400 VALIDATION_ERROR`.

### 3.2 `POST /auth/otp/request`

- **Auth:** none. Rate limit 3/15 min per destination, 10/day per destination, 20/day per IP.
- **Body:** `{ "channel": "sms" | "email", "destination": "+94771234567", "purpose": "verify_phone" | "login" | "verify_email" | "password_reset" }`
- **Response 202:** `{ "expiresInSeconds": 600, "resendAfterSeconds": 60 }` (always 202, even if destination unknown, to prevent enumeration).

### 3.3 `POST /auth/otp/verify`

- **Body:** `{ "channel": "sms", "destination": "+94771234567", "purpose": "verify_phone", "code": "482913", "client": "web" | "ios" | "android" }`
- **Validation:** 6 digits; ≤5 attempts per code; code unexpired.
- **Response 200:** `{ "accessToken": "<jwt>", "expiresIn": 900, "user": {...} }` plus `Set-Cookie: rt=<refresh>; HttpOnly; Secure; SameSite=Lax; Path=/v1/auth` for `web`, or `"refreshToken": "..."` in the body for mobile clients.
- **Errors:** `400 OTP_INVALID`, `400 OTP_EXPIRED`, `429 OTP_ATTEMPTS_EXCEEDED`.

### 3.4 `POST /auth/login`

- **Body:** `{ "identifier": "nimal@example.com", "password": "...", "client": "web" }` (identifier = email or phone).
- **Response 200:** same shape as 3.3. If the user has `admin` role, response is `{ "mfaRequired": true, "challengeId": "..." }` and the client must call `POST /auth/otp/verify` with `purpose: "login"`.
- **Errors:** `401 INVALID_CREDENTIALS` (same message for unknown user/wrong password), `403 ACCOUNT_SUSPENDED`, `403 VERIFICATION_REQUIRED`, `429`.

### 3.5 `POST /auth/refresh`

- **Auth:** refresh token (cookie or body). Rotates the token; reuse of a rotated token revokes the whole family.
- **Response 200:** new access token (+ rotated refresh).
- **Errors:** `401 REFRESH_INVALID`.

### 3.6 `POST /auth/logout`, `POST /auth/logout-all`

Revoke current refresh token / all tokens of the user. `204`.

### 3.7 Password reset

`POST /auth/password/forgot` `{ "email" }` → `202` always. `POST /auth/password/reset` `{ "token", "newPassword" }` → `204`; revokes all sessions.

---

## 4. Users

### `GET /users/me`

Returns the profile, roles, verification flags, `providerId` if any, `hasDriverDetails`, notification unread count.

_Phase 2 implementation:_ returns the `User` contract (`id, email, emailVerified, fullName, phone, roles, status, preferredLanguage, preferredCurrency, countryCode, createdAt`). `providerId`, `hasDriverDetails` and the unread count arrive with their phases.

### `PATCH /users/me`

Body: `fullName`, `preferredLanguage`, `preferredCurrency`, `countryCode`, `avatarFileId`. Email/phone changes go through dedicated OTP flows.

_Phase 2 implementation:_ `fullName`, `phone` (unverified, nullable), `preferredLanguage`, `preferredCurrency`, `countryCode`. Unknown keys such as `roles` or `status` are rejected with `400 VALIDATION_ERROR`. `avatarFileId` waits for file storage.

### `PUT /users/me/driver-details` (deferred to the booking phase; no identity data is collected before then)

- **Body:** `{ "licenceNumber": "B1234567", "licenceCountry": "LK", "licenceExpiresOn": "2029-04-30", "licenceClass": "B", "idpNumber": null, "idDocType": "nic", "idDocNumber": "199012345678", "dateOfBirth": "1990-05-01", "licenceFileId": null, "consent": true }`
- Stored encrypted; `consent` must be true. Response returns **masked** values only (`"licenceNumber": "B12•••67"`).

### `POST /users/me/delete-request`

Starts account deletion (anonymisation after the retention checks); `202`. Blocked (`409 ACTIVE_BOOKINGS`) while any booking is `requested|accepted|confirmed|active`.

---

## 5. Providers

### 5.0 As implemented in Phase 3 (2026-10-03)

The lean Phase 3 (TECH_DECISIONS D30–D36) replaces the "become a provider instantly, then upload documents" model below with a **reviewed application**. A verified customer fills in a structured application and submits it; an operator reviews it manually (phone call / e-mail — **no documents are collected**); approval creates the profile and grants the `provider` role atomically. Phone numbers are collected but **not verified** (no SMS provider yet).

| Endpoint                                                                                     | Status      | Notes                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /providers/me/application`                                                              | Implemented | Applicant view of the own application (`ProviderApplication`): form fields, `status`, `reviewReason`, `canEdit`, `canSubmit`, timestamps. `404 NOT_FOUND` before the first save. Admin-only fields (`adminNotes`, `reviewedBy`) are never returned here.                                                                                                                                                   |
| `PUT /providers/me/application`                                                              | Implemented | Creates or updates the draft (`ProviderApplicationDraftSchema`, strict: unknown keys such as `status`, `roles`, `reviewReason` → `400 VALIDATION_ERROR`). Allowed only in `draft` / `changes_requested` (`409 INVALID_STATE_TRANSITION` otherwise). District, place and category ids are checked against the active gazetteer (`400` with per-field details).                                              |
| `POST /providers/me/application/submit`                                                      | Implemented | Body `{ acceptProviderAgreement: true }`. Requires a verified e-mail (`403 EMAIL_NOT_VERIFIED`), a submittable status (`409`) and every required field (`400` listing what is missing). Records agreement version `2026-10`, audits `provider_application.submitted`, e-mails the applicant (and the operator inbox when `OPERATOR_NOTIFICATION_EMAIL` is set). Rate limit: `sensitive` (5 / 15 min / IP). |
| `GET /providers/me`                                                                          | Implemented | Own provider profile (`ProviderProfile`, incl. `status`, `phoneVerified: false`, `suspensionReason`). `404` until approved.                                                                                                                                                                                                                                                                                |
| `PATCH /providers/me`                                                                        | Implemented | Contact, description, address, website and delivery flags only (`UpdateProviderProfileRequestSchema`). Requires an **active** profile (`403 PROVIDER_SUSPENDED` while suspended). Audited as `provider_profile.updated`.                                                                                                                                                                                   |
| `POST /providers` (instant provider)                                                         | Replaced    | By the application flow above.                                                                                                                                                                                                                                                                                                                                                                             |
| `POST /providers/me/documents`, `POST /providers/me/submit-verification`                     | Deferred    | No documents or object storage in Phase 3 (SECURITY_AND_PRIVACY §5 note).                                                                                                                                                                                                                                                                                                                                  |
| `PUT /providers/me/bank-details`, `GET /providers/me/dashboard`, `GET /providers/{idOrSlug}` | Deferred    | Settlements, metrics and the public provider page arrive with vehicles and bookings.                                                                                                                                                                                                                                                                                                                       |

Application states: `draft → submitted → under_review → changes_requested → submitted …`; `submitted | under_review → approved | rejected`. `rejected` is terminal in Phase 3. Every transition is one status-conditioned `UPDATE … WHERE status IN (…)`; a lost race returns `409 INVALID_STATE_TRANSITION`.

### 5.1 `POST /providers`

Become a provider (adds `provider` role, creates profile in `unverified`).

- **Auth:** customer with verified phone. **Body:** `{ "type": "individual" | "business", "displayName", "legalName?", "businessRegistrationNo?", "description?", "publicPhone", "whatsapp?", "publicEmail?" }`
- **Validation:** `displayName` 3–60 chars, unique slug derived; business → `legalName` and `businessRegistrationNo` required.
- **Response 201:** provider profile. **Errors:** `409 ALREADY_PROVIDER`, `403 PHONE_NOT_VERIFIED`.

### 5.2 Documents

`POST /providers/me/documents` `{ "type": "nic_front", "fileId": "<from presign>", "expiresOn?": "2030-01-01" }` → `201 { id, type, status: "pending_review" }`.
`POST /providers/me/submit-verification` → `202` moves `unverified|rejected → pending_review` once the required document set is present (individual: NIC front+back or passport; business: BR + owner NIC). Error `400 DOCUMENTS_MISSING` lists what is missing.

### 5.3 `PUT /providers/me/bank-details`

`{ "bankName", "bankBranch", "accountName", "accountNumber" }` → stored encrypted, response masked. Required before first settlement (admin cannot mark paid otherwise).

### 5.4 `GET /providers/me/dashboard`

`{ pendingRequests, upcomingPickups, activeRentals, unpaidAccepted, earnings: { pendingSettlement: Money, paidThisMonth: Money }, metrics: { acceptanceRate, avgResponseMinutes, ratingAvg, ratingCount }, alerts: [ { type: "document_expiring", vehicleId, expiresOn } ] }`

### 5.5 `GET /providers/{idOrSlug}` (public)

`{ id, slug, displayName, type, verificationStatus, verified: true, memberSince, completedBookingsCount, ratingAvg, ratingCount, avgResponseMinutes, description, logo, locations: [ { id, name, town, approxPoint } ], vehicles: [...cards] }` — no phone/email.

---

## 6. Locations

### 6.0 As implemented in Phase 4 (2026-10-03)

Routes are under `/providers/me/locations`, guarded by `ActiveProviderGuard` (approved, active provider). District and gazetteer place are **required**; the pin is **optional** (typed in, validated against the Sri Lanka bounding box; no geocoding or map API, TECH_DECISIONS D41). Delivery settings live on the vehicle in this phase (flag + flat fee), not on the location.

| Endpoint                              | Notes                                                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /providers/me/locations`         | Active first, primary first; each row carries `vehicleCount` (non-rejected vehicles using it)                                                                                                                                            |
| `POST /providers/me/locations`        | `{ name, districtId, placeId, addressText, point?, pickupInstructions?, isPrimary? }` → `201`. The first location becomes primary. `400` with field details for inactive district, place outside district, coordinates outside Sri Lanka |
| `GET /providers/me/locations/{id}`    | `404` for unknown ids and other providers' locations alike                                                                                                                                                                               |
| `PATCH /providers/me/locations/{id}`  | Same fields plus `isPrimary: true` (moves the flag; `false` is refused) and `isActive` (reactivate / deactivate)                                                                                                                         |
| `DELETE /providers/me/locations/{id}` | Soft: deactivates (`204`); `409 LOCATION_IN_USE` while any non-rejected vehicle uses it                                                                                                                                                  |

`ProviderLocation` = `{ id, providerId, name, districtId, placeId, addressText, point: { lat, lng } | null, pickupInstructions, isPrimary, isActive, vehicleCount, createdAt, updatedAt }`. No public endpoint exposes locations yet; when one does it must round the point (SECURITY_AND_PRIVACY §13).

### `POST /providers/me/locations`

- **Body:** `{ "name": "Mirissa office", "addressLine1": "...", "addressLine2?": "...", "placeId": "<places.id>", "point": { "lat": 5.9485, "lng": 80.4718 }, "pickupInstructions?": "...", "deliveryAvailable": true, "deliveryRadiusKm?": 15, "deliveryFeeFlat?": "1500.00", "isPrimary": false }`
- **Validation:** point inside Sri Lanka bounding box (5.7–10.0 N, 79.5–82.0 E); `placeId` must belong to an active district; delivery fields required together.
- **Response 201:** location. **Errors:** `400 DISTRICT_NOT_ACTIVE`.

`PATCH` same fields; `DELETE` is soft and refused with `409 LOCATION_IN_USE` if active vehicles reference it.

---

## 7. Vehicles (provider)

### 7.0 As implemented in Phase 4 (2026-10-03)

A listing is created as a `draft` with only its category and completed in place; the contracts' `vehicleSubmissionIssues` checklist (required fields, category-specific fields from `VEHICLE_CATEGORY_RULES`, pricing consistency) is returned on every read as `submissionIssues` and enforced at `submit` and again at admin approval. Photos, documents, `rentalModeOffer`, `driverFeePerDay`, `turnaroundHours`, `advanceNoticeHours`, `features` and `slug` are deferred (TECH_DECISIONS D37).

| Endpoint                                      | Notes                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /providers/me/vehicles`                  | Summaries, newest first                                                                                                                                                                                                                                                                                                                    |
| `POST /providers/me/vehicles`                 | `CreateVehicleRequestSchema` (strict; `categoryId` required, everything else optional) → `201 draft`. `400` for unknown/inactive category or location, category-inapplicable fields (e.g. doors on a bike), malformed money; `409 CONFLICT` when the registration number is already used by one of the provider's vehicles                 |
| `GET /providers/me/vehicles/{id}`             | `Vehicle` view: all fields, `editable: all \| operational \| none`, `canSubmit`, `submissionIssues`, `reviewReason`, `suspensionReason`. Full registration number (owner only)                                                                                                                                                             |
| `PATCH /providers/me/vehicles/{id}`           | `draft` / `changes_requested`: any field. `approved` / `inactive`: operational fields only — identity fields (`VEHICLE_IDENTITY_FIELDS`: category, make, model, year, specs, plate, colour) answer `400 … locked after approval`. Other states: `409 INVALID_STATE_TRANSITION`. Cross-field pricing rules are checked on the merged result |
| `POST /providers/me/vehicles/{id}/submit`     | `draft \| changes_requested → submitted`; `400` with the checklist when incomplete (incl. inactive pickup location); audited; e-mails the provider and the optional operator inbox. Rate limit `sensitive`                                                                                                                                 |
| `POST /providers/me/vehicles/{id}/deactivate` | `approved → inactive` (provider takes the listing offline)                                                                                                                                                                                                                                                                                 |
| `POST /providers/me/vehicles/{id}/activate`   | `inactive → approved`                                                                                                                                                                                                                                                                                                                      |

**Pricing fields (LKR, decimal strings, `numeric(12,2)`):** `dailyRate` (500–1,000,000), `weeklyRate` (daily ≤ weekly ≤ 7×daily), `monthlyRate` (≥ weekly, ≤ 30×daily), `securityDeposit` (0–5,000,000), `includedKmPerDay` (null = unlimited; when set `extraKmRate` 0–10,000 is required), `minRentalDays` 1–90, `maxRentalDays` ≤ 365. **Rules:** `minRenterAge` 18–80, `minLicenceYears` 0–50, `fuelPolicy` `full_to_full | same_to_same | included`, `deliveryAvailable` + `deliveryFee` (0–100,000; null = on request), `pickupNotes`. **Plate:** `registrationNumber` upper-cased, lenient Sri Lankan format, unique per provider, never public (`maskRegistrationNumber` → `CAB-••34`).

### 7.1 `POST /providers/me/vehicles`

- **Body**
  ```json
  {
    "categoryId": "car",
    "make": "Toyota",
    "model": "Aqua",
    "year": 2018,
    "registrationNumber": "CAB-1234",
    "transmission": "automatic",
    "fuelType": "hybrid",
    "seats": 5,
    "doors": 5,
    "engineCc": null,
    "colour": "White",
    "features": ["ac", "bluetooth"],
    "description": "...",
    "locationId": "...",
    "rentalModeOffer": "both",
    "pricing": {
      "currency": "LKR",
      "dailyRate": "7500.00",
      "weeklyRate": "45000.00",
      "monthlyRate": null,
      "driverFeePerDay": "3000.00",
      "securityDepositAmount": "25000.00",
      "includedKmPerDay": 100,
      "extraKmRate": "40.00",
      "minRentalDays": 1,
      "maxRentalDays": 30,
      "turnaroundHours": 2,
      "advanceNoticeHours": 12
    },
    "minDriverAge": 21
  }
  ```
- **Validation:** `year` 1990..currentYear+1; `registrationNumber` matches `^[A-Z]{2,3}-?\d{4}$` or legacy numeric formats (lenient, uppercased); `seats` 1–60; rates `> 0`, `weeklyRate < dailyRate*7` if given; `driverFeePerDay` required when `rentalModeOffer ≠ self_drive`; `includedKmPerDay` null or > 0 and then `extraKmRate` required.
- **Response 201:** vehicle in `draft`.

### 7.2 Photos

**As implemented in Phase 5 (2026-10-04, TECH_DECISIONS D42–D43).** Photos are uploaded **through the API** as `multipart/form-data` (field `file`), not via presigned URLs: one round trip, server-side content validation and no browser-facing storage credentials or CORS on the bucket. Routes are under `ActiveProviderGuard`; photos can be changed while the listing is a `draft` or has `changes_requested`.

| Endpoint                                              | Notes                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /providers/me/vehicles/{id}/photos`              | Display order; `{ id, sortOrder, isPrimary, width, height, variants: { thumb, medium, large }, createdAt }`                                                                                                                                                                                                                                 |
| `POST /providers/me/vehicles/{id}/photos`             | `file` ≤ 10 MB, JPEG/PNG/WebP decided by the bytes (`415 UNSUPPORTED_MEDIA_TYPE` otherwise, incl. SVG and executables), ≥ 320×240, ≤ 50 MP; `413 PAYLOAD_TOO_LARGE`; `409 CONFLICT` at 12 photos. EXIF orientation applied, all metadata stripped, WebP variants 400/1000/1600 px (longest side) → public bucket; original → private bucket |
| `PATCH /providers/me/vehicles/{id}/photos/order`      | `{ photoIds }` listing every current photo once; the first becomes primary                                                                                                                                                                                                                                                                  |
| `DELETE /providers/me/vehicles/{id}/photos/{photoId}` | Soft-deletes the row, renumbers the rest, removes objects best-effort                                                                                                                                                                                                                                                                       |

Submission and approval require **≥ 3 photos** (`submissionIssues` lists `photos`). The provider and admin vehicle views carry `photos[]`; summaries carry `photoCount` and `thumbnailUrl`. Public responses expose only the variant URLs.

`POST /providers/me/vehicles/{id}/photos` `{ "fileId": "..." }` (file must be `uploaded`, purpose `vehicle_photo`, owned by caller) → `201 { photoId, status: "processing" }`. Variants are generated asynchronously; `GET` shows `variants` when ready. Max 15 photos. `PATCH .../photos/order` `{ "photoIds": [...] }`.

### 7.3 Documents

`POST /providers/me/vehicles/{id}/documents` `{ "type": "insurance_certificate", "fileId", "documentNumber?", "issuedOn?", "expiresOn" }`. `expiresOn` required for `revenue_licence` and `insurance_certificate`, must be in the future.

### 7.4 `POST /providers/me/vehicles/{id}/submit`

Draft → `pending_review` (or `active` directly, per `platform_settings.vehicle_review_required`). Preconditions: ≥3 photos, pricing complete, location set, provider `verified`. Error `400 LISTING_INCOMPLETE` with a checklist.

`pause` → `active → paused` (existing confirmed bookings unaffected; vehicle hidden from search). `resume` → `paused → active`.

---

## 8. Vehicles (public), availability and quotes

### 8.0 As implemented in Phase 4 (2026-10-03)

No public vehicle, availability or quote endpoint exists yet (customer discovery is a later phase). The provider-side availability of §8.4 is implemented on `vehicle_holds` (TECH_DECISIONS D40):

| Endpoint                                               | Notes                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /providers/me/vehicles/{id}/availability?from&to` | `{ vehicleId, status, bookable, from, to, available, holds[] }` — `bookable` is `status = approved`; `available` is `bookable` and no hold intersects the half-open window `[from, to)`; range ≤ 400 days                                                                                                                                                                             |
| `GET /providers/me/vehicles/{id}/blocks?from&to`       | Holds (current and upcoming by default) — `{ id, vehicleId, kind, startsAt, endsAt, reason, note, createdBy, createdAt }`                                                                                                                                                                                                                                                             |
| `POST /providers/me/vehicles/{id}/blocks`              | `{ startsAt, endsAt, reason: maintenance \| provider_unavailable \| rented_offline \| reserved_offline \| other, note? }` → `201`. End after start, ≤ 366 days, not entirely in the past; vehicle must be `approved` or `inactive` (`409` otherwise). Overlap with any hold → `409 AVAILABILITY_CONFLICT` listing the conflicts; the database exclusion constraint is the final guard |
| `DELETE /providers/me/vehicles/{id}/blocks/{blockId}`  | `204`; only `kind = block` rows of the caller's own vehicle                                                                                                                                                                                                                                                                                                                           |

`BOOKING_CONFLICT`, holds of `kind = booking` and the public calendar arrive with the booking phase.

**Phase 5 — public discovery (2026-10-04, TECH_DECISIONS D44–D46).** Unauthenticated, customer-safe projections only (allow-list mappers; see SECURITY_AND_PRIVACY §13).

| Endpoint                                   | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /vehicles/search`                     | Query: `placeId` (gazetteer place → centre + `defaultRadiusKm`, or `radiusKm` 1–50), `districtId`, `startsAt`+`endsAt` (both or none, ≤ 90 days, ≤ 365 days ahead), `categoryId`, `transmission`, `fuelType`, `minSeats`, `hasAc`, `deliveryAvailable`, `minDailyRate`/`maxDailyRate`, `sort` (`relevance` default, `distance`, `price_asc`, `price_desc`), `limit` ≤ 50, `cursor`. Returns `{ data: PublicVehicleCard[], nextCursor, criteria }`. Only **searchable** listings: `approved`, provider `active`, location active, category active, ≥ 3 photos. With dates: `NOT EXISTS` hold overlap and `minRentalDays ≤ days ≤ maxRentalDays`; each card carries an `estimate` |
| `GET /vehicles/{idOrSlug}?startsAt&endsAt` | Public listing page: specs, description, `photos[]`, `pricing`, `rules`, `place`, `approxPoint`, provider summary (`slug, displayName, description, yearsOperating, approvedSince (YYYY-MM), primaryPlace, districtId, vehicleCount, platformApproved: true`) and, with a window, `availability { available, meetsRentalLength, days, estimate }`. `404` unless searchable                                                                                                                                                                                                                                                                                                      |

Place search: `(location.place_id = :place) OR ST_DWithin(location.geom, centre, radius)`; distance `ST_Distance` (null without a pin). **Default sort** = distance from the centre (pin-less listings last), then daily rate, then id; without a place: daily rate, then id. Cursors are keyset over the sort keys and reject a different sort. `estimate` = monthly rate for whole 30-day months, weekly rate for whole weeks, daily rate for the rest, never above plain daily pricing; labelled "Not a booking quote". §8.1's `unavailableDates`, §8.2 and the §8.3 quote engine remain for the booking phase.

### 8.1 `GET /vehicles/{idOrSlug}`

Returns the public listing: specs, photos, pricing summary, `provider` public card, `location: { town, district, approxPoint (rounded to ~500 m), deliveryAvailable, deliveryRadiusKm, deliveryFeeFlat }`, `requirements`, `policies: { cancellation, fuel, mileage }`, `ratingAvg`, `ratingCount`, `unavailableDates` for the next 90 days (array of `[start, end)` ISO ranges derived from holds). Vehicles not `active` return `404` to non-owners.

### 8.2 `GET /vehicles/{id}/availability?from=2026-11-01&to=2027-01-31`

`{ "unavailable": [ { "start": "...", "end": "..." } ], "minRentalDays": 1, "advanceNoticeHours": 12 }`. Max 180-day window.

### 8.3 `GET /vehicles/{id}/quote`

- **Query:** `startsAt`, `endsAt`, `rentalMode=self_drive|with_driver`, `pickupType=at_location|delivery`, `deliveryPoint=lat,lng?`
- **Auth:** none (public pricing).
- **Response 200**
  ```json
  {
    "available": true,
    "rentalDays": 5,
    "currency": "LKR",
    "lines": [
      { "code": "base_rental", "label": "5 days × LKR 7,500", "amount": "37500.00" },
      { "code": "driver", "label": "Driver × 5 days", "amount": "15000.00" },
      { "code": "delivery", "label": "Delivery (8 km)", "amount": "1500.00" }
    ],
    "subtotal": "54000.00",
    "customerFee": "0.00",
    "total": "54000.00",
    "deposit": "25000.00",
    "advanceDue": "5400.00",
    "balanceDue": "48600.00",
    "includedKmTotal": 500,
    "extraKmRate": "40.00",
    "quoteToken": "<signed, 15 min>",
    "reasons": []
  }
  ```
  When `available=false`, `reasons` explains (`outside_min_days`, `too_soon`, `date_conflict`, `outside_delivery_radius`).
- **Validation:** `endsAt > startsAt`; `startsAt ≥ now + advanceNoticeHours`; duration ≤ `maxRentalDays`; delivery point within radius.

### 8.4 Calendar & blocks (provider)

`GET /providers/me/vehicles/{id}/calendar?from&to` → holds with `kind`, `bookingRef`, `status`.
`POST /providers/me/vehicles/{id}/blocks` `{ "startsAt", "endsAt", "reason": "maintenance", "note?" }` → `201`; `409 BOOKING_CONFLICT` with `conflicts: [ { bookingRef, start, end } ]`.
`DELETE .../blocks/{holdId}` → `204` (only `kind=block`).

---

## 9. Search & places

### 9.0 As implemented in Phase 3 (2026-10-03)

Public, read-only reference lists for forms (no search yet): `GET /reference/districts` (all districts with `isActive`), `GET /reference/places?districtId=` (active places, optionally filtered by district: `id, slug, name, districtId, kind`), `GET /reference/vehicle-categories` (active categories). **Phase 5 (2026-10-04):** `GET /places/suggest?q=&limit=` is implemented on the gazetteer — name prefix or contains match plus alias prefix match, active places in active districts only, launch areas and `search_rank` first — returning `{ id, slug, name, kind, districtId, districtName, isLaunchArea }`. §9.1 `GET /search/vehicles` is implemented as `GET /vehicles/search` (§8.0) with cursor pagination instead of `page`/`pageSize`, and without `total`/`facets`/cache; §9.2 `GET /search/map` and §9.4 `GET /vehicle-categories` remain later.

### 9.1 `GET /search/vehicles`

- **Query**
  | Param                      | Type                                                     | Notes                                                                      |
  | -------------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------- |
  | `placeId` or (`lat`,`lng`) |                                                          | One required. `placeId` resolves to the place centre and `defaultRadiusKm` |
  | `radiusKm`                 | 1–50                                                     | default from place or 15                                                   |
  | `startsAt`, `endsAt`       | ISO                                                      | required                                                                   |
  | `category`                 | csv of category ids                                      |                                                                            |
  | `transmission`, `fuelType` | csv                                                      |                                                                            |
  | `seatsMin`                 | int                                                      |                                                                            |
  | `priceMin`, `priceMax`     | decimal per day                                          |                                                                            |
  | `rentalMode`               | self_drive / with_driver                                 |                                                                            |
  | `deliveryAvailable`        | bool                                                     |                                                                            |
  | `verifiedOnly`             | bool, default true                                       |                                                                            |
  | `sort`                     | recommended / price_asc / price_desc / distance / rating |                                                                            |
  | `page`, `pageSize`         | ≤ 10, ≤ 24                                               |                                                                            |
- **Response 200**
  ```json
  { "query": { "center": {"lat":5.95,"lng":80.47}, "radiusKm": 15, "rentalDays": 5 },
    "total": 42,
    "data": [ { "id": "...", "slug": "...", "title": "Toyota Aqua 2018", "categoryId": "car",
                "image": { "thumb": "..." }, "transmission": "automatic", "fuelType": "hybrid", "seats": 5,
                "rentalModes": ["self_drive", "with_driver"], "deliveryAvailable": true,
                "distanceKm": 2.3, "point": {"lat":..., "lng":...},
                "pricing": { "perDay": "7500.00", "total": "37500.00", "deposit": "25000.00", "currency": "LKR" },
                "provider": { "id": "...", "displayName": "...", "verified": true, "ratingAvg": 4.8, "ratingCount": 21 },
                "badges": ["verified_provider", "verified_vehicle"] } ],
    "facets": { "category": { "car": 20, "scooter": 15 }, "transmission": { "automatic": 12 } } }
  ```
  `total` and `facets` are computed in the same query (window function + grouped counts) and cached for 30 s per normalised query.
- **Errors:** `400 VALIDATION_ERROR` (missing dates, radius out of range, window > 90 days).

### 9.2 `GET /search/map?bbox=w,s,e,n&startsAt&endsAt&...filters`

Lighter payload (`id, point, perDay, categoryId`) for up to 200 pins; the client clusters.

### 9.3 `GET /places/suggest?q=mir&limit=8`

Prefix/alias match on the curated gazetteer (active districts first, then others): `[ { id, slug, name, kind, district, point, isLaunchArea } ]`. Rate limit 60/min/IP; results cached 1 h.

### 9.4 `GET /vehicle-categories`

Active categories with localised names and counts of active vehicles.

---

## 10. Bookings

### 10.1 `POST /bookings`

- **Auth:** customer (verified email or phone). Header `Idempotency-Key`.
- **Body**
  ```json
  {
    "vehicleId": "...",
    "startsAt": "2026-11-12T09:00:00+05:30",
    "endsAt": "2026-11-17T09:00:00+05:30",
    "rentalMode": "self_drive",
    "pickupType": "at_location",
    "deliveryAddress": null,
    "deliveryPoint": null,
    "returnType": "at_location",
    "returnAddress": null,
    "quoteToken": "<from quote>",
    "drivers": [
      {
        "fullName": "Nimal Perera",
        "licenceNumber": "B1234567",
        "licenceCountry": "LK",
        "licenceExpiresOn": "2029-04-30",
        "idpNumber": null,
        "idDocType": "nic",
        "idDocNumber": "199012345678",
        "phone": "+94771234567"
      }
    ],
    "useSavedDriverDetails": false,
    "customerNote": "Arriving by train at 08:30",
    "acceptPolicies": true
  }
  ```
- **Validation:** vehicle `active`; quote token valid and matches params; `drivers` required and ≥1 when `rentalMode=self_drive` (ignored for `with_driver`); licence expiry after `endsAt`; customer must not already have a `requested|accepted` booking for the same vehicle overlapping these dates; max 3 open requests per customer.
- **Behaviour:** re-prices server side; if different from the quote → `409 QUOTE_CHANGED` with the new quote. Creates booking `requested` with `respondBy = min(now + response window, startsAt − 2 h)`. Fires notifications.
- **Response 201:** full booking object (see 10.3). **Errors:** `409 BOOKING_CONFLICT` (vehicle no longer free), `409 QUOTE_CHANGED`, `403 VERIFICATION_REQUIRED`, `429 TOO_MANY_OPEN_REQUESTS`.

### 10.2 `GET /bookings?role=customer|provider&status=...&from&to&cursor`

Lists bookings visible to the caller. Providers see their vehicles' bookings; customers their own.

### 10.3 `GET /bookings/{idOrRef}`

Visible to the customer, the provider, and admins. Response:

```json
{ "id": "...", "ref": "SLR-7F3K2Q", "status": "accepted", "version": 3,
  "vehicle": { "id", "slug", "title", "image", "categoryId", "registrationNumber": "CAB-1234 (only when confirmed+)" },
  "provider": { "id", "displayName", "verified": true },
  "customer": { "id", "firstName": "Nimal", "memberSince": "2026-02-01", "completedBookings": 2, "phoneVerified": true },
  "startsAt": "...", "endsAt": "...", "rentalDays": 5, "rentalMode": "self_drive",
  "pickup": { "type": "at_location", "locationName": "Mirissa office",
              "address": "<only when confirmed+>", "point": "<only when confirmed+>", "instructions": "<confirmed+>" },
  "price": { "...quote shape..." },
  "payments": [ { "id", "type": "advance", "method": "payhere", "status": "paid", "amount": "5400.00", "paidAt": "..." } ],
  "timers": { "respondBy": null, "payBy": "2026-11-10T14:00:00+05:30" },
  "drivers": [ { "fullName": "Nimal Perera", "licenceCountry": "LK", "licenceExpiresOn": "2029-04-30",
                 "licenceNumber": "<masked for provider until confirmed; full after>" } ],
  "handover": { "pickedUpAt": null, "pickupOdometerKm": null, "pickupFuelLevel": null, "depositCollected": null },
  "return": { "returnedAt": null, "extraCharges": [], "depositReturned": null },
  "policies": { "cancellation": "full_refund_48h" },
  "contact": { "available": false, "revealAt": "confirmed" },
  "allowedActions": ["cancel", "pay"],
  "createdAt": "..." }
```

`allowedActions` is computed per caller role and state so clients do not duplicate the state machine.

### 10.4 Provider transitions

| Endpoint                      | From → To            | Body                                                                                                                                                                                                    | Errors                                                                                             |
| ----------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /bookings/{id}/accept`  | requested → accepted | `{ "version": 1, "providerNote?": "..." }`                                                                                                                                                              | `409 BOOKING_CONFLICT`, `409 STALE_VERSION`, `409 INVALID_STATE_TRANSITION`, `410 REQUEST_EXPIRED` |
| `POST /bookings/{id}/decline` | requested → declined | `{ "version", "reason": "vehicle_unavailable" \| "requirements_not_met" \| "other", "note?" }`                                                                                                          | as above                                                                                           |
| `POST /bookings/{id}/pickup`  | confirmed → active   | `{ "version", "odometerKm": 45210, "fuelLevel": 6, "depositCollected": { "amount": "25000.00", "method": "cash" }, "balanceCollected": { "amount": "48600.00", "method": "card_in_person" }, "note?" }` | `400` if before `startsAt − 24h`, `409`                                                            |
| `POST /bookings/{id}/return`  | active → completed   | `{ "version", "odometerKm": 45810, "fuelLevel": 5, "extraCharges": [ { "label": "Extra 100 km", "amount": "4000.00" } ], "depositReturned": "21000.00", "note?" }`                                      | `409`                                                                                              |
| `POST /bookings/{id}/no-show` | confirmed → no_show  | `{ "version", "contactAttemptNote": "Called 3 times" }`                                                                                                                                                 | `400 GRACE_PERIOD_NOT_ELAPSED`                                                                     |

Every transition writes a `booking_events` row and returns the updated booking.

### 10.5 `POST /bookings/{id}/cancel`

- **Auth:** customer (own) or provider (own vehicle). Body `{ "version", "reason": "...", "note?" }`.
- **Behaviour:** computes `cancellationFeeAmount` from the policy and the current time; releases the hold; if a paid advance exists, creates a `refund` payment in `pending` for admin execution (MVP) and ledger entries; notifies the other party.
- **Response 200:** booking with `cancellation: { fee, refundDue }`. **Errors:** `409 INVALID_STATE_TRANSITION` (e.g. already `active`).

### 10.6 `GET /bookings/{id}/contact`

Returns `{ "phone": "+94...", "whatsappUrl": "https://wa.me/94...?text=...", "email": "..." }` of the counterparty once the booking reaches the reveal stage (`platform_settings.contact_reveal_stage`). Logs `contact_revealed` event. `403 CONTACT_NOT_AVAILABLE_YET` otherwise.

### 10.7 Disputes

`POST /bookings/{id}/disputes` `{ "type": "deposit", "description", "claimedAmount?", "attachmentFileIds?": [] }` → `201`. Allowed from `active`, `completed`, `no_show`, `cancelled_*` within 14 days. `POST /disputes/{id}/messages` for the thread.

---

## 11. Payments

### 11.1 `POST /bookings/{id}/payments/checkout`

Creates (or reuses) a pending `advance` payment and returns the parameters for PayHere Checkout.

- **Auth:** the booking's customer; booking must be `accepted` and before `payBy`. Header `Idempotency-Key`.
- **Body:** `{ "returnPath": "/bookings/SLR-7F3K2Q" }`
- **Response 200**
  ```json
  {
    "paymentId": "...",
    "gateway": "payhere",
    "checkoutUrl": "https://sandbox.payhere.lk/pay/checkout",
    "fields": {
      "merchant_id": "...",
      "return_url": "...",
      "cancel_url": "...",
      "notify_url": "...",
      "order_id": "PAY-01J9...",
      "items": "Booking SLR-7F3K2Q advance",
      "currency": "LKR",
      "amount": "5400.00",
      "first_name": "Nimal",
      "last_name": "Perera",
      "email": "...",
      "phone": "...",
      "address": "",
      "city": "",
      "country": "Sri Lanka",
      "hash": "<md5 upper>"
    }
  }
  ```
  The browser submits these fields to `checkoutUrl` as a form POST (`application/x-www-form-urlencoded`; live `https://www.payhere.lk/pay/checkout`, sandbox `https://sandbox.payhere.lk/pay/checkout`). The server never receives card data. `hash = UPPER(md5(merchant_id + order_id + amount_2dp + currency + UPPER(md5(merchant_secret))))`, computed server side; the merchant secret is per registered domain.
- **Errors:** `409 INVALID_STATE_TRANSITION`, `410 PAYMENT_WINDOW_EXPIRED`, `409 ALREADY_PAID`.

### 11.2 `POST /payments/payhere/notify` (webhook)

- **Auth:** none (public URL); request authenticated by recomputing `UPPER(md5(merchant_id + order_id + payhere_amount + payhere_currency + status_code + UPPER(md5(merchant_secret))))` with a timing-safe compare against `md5sig`. Also validates `merchant_id` and that `payhere_amount`/`payhere_currency` equal the stored payment. MD5 of a shared secret is PayHere's only authenticity control, so amount matching and idempotency are mandatory, not optional.
- **Body:** `application/x-www-form-urlencoded` as sent by PayHere (`merchant_id, order_id, payment_id, payhere_amount, payhere_currency, status_code, md5sig, method, status_message, card_holder_name, card_no (masked), card_expiry, custom_1, custom_2`).
- **Behaviour:** store in `payment_webhook_events` (idempotent on `payment_id + status_code`); map `status_code` `2` → paid, `0` → pending, `-1` → cancelled, `-2` → failed, `-3` → chargedback; on `paid`, transactionally transition `accepted → confirmed`, write ledger entries, enqueue notifications. Always respond `200` quickly; processing is in-transaction but small; retries are safe.
- Exact field names and status codes must be confirmed against the PayHere Checkout API documentation during Phase 7 (see TECH_DECISIONS.md).

### 11.3 `POST /bookings/{id}/payments/record`

Provider records in-person money (balance, deposit, extra charges, deposit refund): `{ "type": "balance", "method": "cash", "amount": "48600.00", "note?" }` → `201`. These rows are informational for the customer's record and for disputes; they do not move platform money.

### 11.4 Refunds (MVP: admin)

`POST /admin/payments/{id}/refund` `{ "amount", "reason", "method": "payhere_portal" | "bank_transfer", "reference" }` → records a refund the admin has executed. Card payments are refunded in the PayHere merchant portal (same-day = instant void; after settlement 5–10+ days; PayHere documentation is ambiguous on partial refunds — verify). Payments made through wallets/bank methods (Genie, eZ Cash, Frimi, HelaPay…) cannot be refunded through PayHere and are refunded by bank transfer; the cancellation flow therefore asks the customer for bank details when the original method was non-card. Automated refunds via the Refund API are a later phase.

---

## 12. Reviews, notifications, uploads

### Reviews

`POST /bookings/{id}/review` `{ "rating": 5, "ratingVehicle?": 5, "ratingCommunication?": 4, "ratingValue?": 5, "comment?": "..." }` — booking must be `completed`, caller the customer, within 14 days, no existing review → `201`. `GET /vehicles/{id}/reviews?cursor`, `GET /providers/{id}/reviews?cursor` → public, author shown as first name + initial. `POST /reviews/{id}/reply` (provider, once).

### Notifications

`GET /notifications?cursor&unreadOnly` → feed. `POST /notifications/{id}/read`, `POST /notifications/read-all` → `204`. `GET /notifications/unread-count`.

### Uploads (direct to storage)

**Phase 5 (2026-10-04):** the only uploads are vehicle listing photos, implemented as **API uploads** (`POST /providers/me/vehicles/{id}/photos`, §7.2) rather than the presign/complete pair below — simpler and more reliable for an MVP with ≤ 12 photos per listing, and it keeps storage credentials and bucket CORS out of the browser (TECH_DECISIONS D43). The presigned direct-to-storage flow stays the design for larger files (documents, dispute attachments) when those arrive.

`POST /uploads/presign` `{ "purpose": "vehicle_photo" | "provider_document" | "vehicle_document" | "avatar" | "dispute_attachment", "mimeType": "image/jpeg", "sizeBytes": 2345678, "fileName": "front.jpg" }`

- Validation: MIME allow-list per purpose (photos: jpeg/png/webp/heic ≤ 10 MB; documents: jpeg/png/pdf ≤ 10 MB); purpose must be allowed for the caller's role.
- Response `201 { "fileId", "uploadUrl", "method": "PUT", "headers": { "Content-Type": "image/jpeg" }, "expiresInSeconds": 300 }` (presigned S3-compatible URL to the public or private bucket by purpose).
  `POST /uploads/{fileId}/complete` → server HEADs the object, verifies size/MIME magic bytes, marks `uploaded`, enqueues processing. Files never attached to an entity within 24 h are deleted by a job.

---

## 13. Admin (`/admin/...`, roles `admin` / `super_admin`)

### 13.0 As implemented in Phase 3 (2026-10-03)

| Endpoint                                                                                               | Purpose                                                                                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /admin/provider-applications?status=&limit=&cursor=`                                              | Review queue; keyset pagination (`{ data, nextCursor }`), newest first; optional status filter                                                                                                                                                                           |
| `GET /admin/provider-applications/{id}`                                                                | Full application incl. `adminNotes`, `reviewedBy` / `reviewedAt`, applicant `{ id, email, fullName, emailVerified, memberSince }`                                                                                                                                        |
| `POST /admin/provider-applications/{id}/start-review` `{ adminNotes? }`                                | `submitted → under_review`                                                                                                                                                                                                                                               |
| `POST /admin/provider-applications/{id}/request-changes` `{ reason (5–1000), adminNotes? }`            | `submitted \| under_review → changes_requested`; the reason is shown to the applicant and e-mailed                                                                                                                                                                       |
| `POST /admin/provider-applications/{id}/approve` `{ adminNotes? }`                                     | `submitted \| under_review → approved` in **one transaction**: re-validates required fields, creates `provider_profiles` (+ service areas, categories), appends `provider` to `users.roles` (idempotent; other roles untouched), writes the audit row, queues the e-mail |
| `POST /admin/provider-applications/{id}/reject` `{ reason, adminNotes? }`                              | `submitted \| under_review → rejected` (terminal in Phase 3); the reason is e-mailed                                                                                                                                                                                     |
| `GET /admin/providers?status=&limit=&cursor=`, `GET /admin/providers/{id}`                             | Approved providers (`active` / `suspended`) with owner details                                                                                                                                                                                                           |
| `POST /admin/providers/{id}/suspend` `{ reason }`, `POST /admin/providers/{id}/reactivate` `{ note? }` | Suspension is a profile status; the `provider` role stays and `ActiveProviderGuard` blocks provider-only actions while suspended; the provider is e-mailed                                                                                                               |

All admin routes require the `admin` or `super_admin` role (`RolesGuard`; roles are read from the database on every request) and write an `audit_events` row in the same transaction (`provider_application.review_started | changes_requested | approved | rejected`, `provider_profile.suspended | reactivated`). Wrong-state calls return `409 INVALID_STATE_TRANSITION`; unknown ids `404`. Admin accounts are created only with `pnpm admin:grant --email … [--role admin|super_admin]` (audited as `admin.role_granted`, actor `system`); there is no admin UI for granting roles yet and admin MFA is a production-hardening item (SECURITY_AND_PRIVACY §2.1). The `verify / reject / request-info / suspend / unsuspend` row below is superseded by this table; documents, users, bookings, disputes, settlements, reports, settings and audit-log endpoints belong to later phases.

**Phase 4 — vehicle review (2026-10-03).** Same pattern (`RolesGuard`, status-conditioned transitions, audit + e-mail in one transaction):

| Endpoint                                                                                             | Purpose                                                                                                              |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/vehicles?status=&providerId=&limit=&cursor=`                                             | Review queue; keyset pagination; filter by status and/or provider                                                    |
| `GET /admin/vehicles/{id}`                                                                           | Full listing incl. `adminNotes`, reviewer, `provider { id, displayName, status, owner }`, embedded pickup `location` |
| `POST /admin/vehicles/{id}/start-review` `{ adminNotes? }`                                           | `submitted → under_review`                                                                                           |
| `POST /admin/vehicles/{id}/request-changes` `{ reason, adminNotes? }`                                | `submitted \| under_review → changes_requested`; reason shown to the provider and e-mailed                           |
| `POST /admin/vehicles/{id}/approve` `{ adminNotes? }`                                                | `submitted \| under_review → approved`; completeness re-checked inside the transaction (`400` rolls back)            |
| `POST /admin/vehicles/{id}/reject` `{ reason, adminNotes? }`                                         | `submitted \| under_review → rejected` (terminal)                                                                    |
| `POST /admin/vehicles/{id}/suspend` `{ reason }`, `POST /admin/vehicles/{id}/reactivate` `{ note? }` | `approved \| inactive → suspended` (never available while suspended) and `suspended → approved`                      |

Audit actions: `vehicle.review_started | changes_requested | approved | rejected | suspended | reactivated` (admin), `vehicle.created | updated | submitted | deactivated | activated`, `vehicle_block.created | deleted`, `provider_location.created | updated | deactivated` (provider). The `GET /admin/vehicles?status=pending_review …` row below is superseded.

| Endpoint                                                                                                                                                                                                                    | Purpose                                                                                                                                     |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /admin/providers?status=pending_review&q=`                                                                                                                                                                             | Verification queue / search                                                                                                                 |
| `GET /admin/providers/{id}`                                                                                                                                                                                                 | Full profile incl. documents (signed URLs, 2-min expiry, access logged)                                                                     |
| `POST /admin/providers/{id}/verify` `{ note? }` / `reject` `{ reason }` / `request-info` `{ message }` / `suspend` `{ reason }` / `unsuspend`                                                                               | Verification decisions                                                                                                                      |
| `GET /admin/vehicles?status=pending_review` / `GET /admin/vehicles/{id}` / `POST .../approve` / `reject` `{ reason }` / `pause` `{ reason }`                                                                                | Vehicle review                                                                                                                              |
| `GET /admin/documents/{id}/url`                                                                                                                                                                                             | Short-lived signed URL for a private document                                                                                               |
| `GET /admin/users?q=` / `GET /admin/users/{id}` / `POST .../suspend` / `unsuspend` / `POST .../anonymise`                                                                                                                   | User management                                                                                                                             |
| `GET /admin/bookings?status&q&from&to` / `GET /admin/bookings/{id}` / `POST .../cancel` `{ reason, refundDecision }` / `POST .../resend-notification` / `POST .../record-payment`                                           | Booking operations                                                                                                                          |
| `GET /admin/disputes?status` / `POST /admin/disputes/{id}/resolve` `{ outcome, resolvedAmount?, note }` / `reject`                                                                                                          | Disputes                                                                                                                                    |
| `POST /admin/payments/{id}/refund` `{ amount, reference, reason }`                                                                                                                                                          | Record executed refund                                                                                                                      |
| `GET /admin/settlements?status` / `POST /admin/settlements/generate` `{ periodStart, periodEnd }` / `POST /admin/settlements/{id}/approve` / `mark-paid` `{ reference, paidAt }` / `GET /admin/settlements/{id}/export.csv` | Manual settlement cycle                                                                                                                     |
| `GET /admin/reports/overview?from&to`                                                                                                                                                                                       | KPIs: searches, zero-result searches by place, views, requests, acceptance %, paid %, GMV, commission, cancellations, top places/categories |
| `GET /admin/settings` / `PUT /admin/settings` (super_admin)                                                                                                                                                                 | Platform settings with audit                                                                                                                |
| `GET /admin/audit-logs?actor&action&from&to`                                                                                                                                                                                | Audit trail                                                                                                                                 |
| `GET /admin/places` / `POST` / `PATCH` / `PATCH /admin/districts/{id}` `{ isActive }`                                                                                                                                       | Expand service area                                                                                                                         |
| `GET /admin/vehicle-categories` / `POST` / `PATCH`                                                                                                                                                                          | Manage categories                                                                                                                           |

All admin mutations require a `reason` where indicated and write `admin_audit_logs`.

---

## 14. Rate limits (initial values)

| Scope                     | Limit                                                                 |
| ------------------------- | --------------------------------------------------------------------- |
| Global per IP             | 300 req/min                                                           |
| Auth endpoints per IP     | 20 req/min; OTP request 3 per 15 min per destination                  |
| Search per IP             | 60 req/min                                                            |
| `POST /bookings` per user | 10 per hour                                                           |
| Uploads presign per user  | 60 per hour                                                           |
| Webhook endpoint          | 600 req/min (PayHere IPs only if published; otherwise signature-only) |

---

## 15. Background jobs that complement the API

| Job                | Schedule     | Effect                                                                     |
| ------------------ | ------------ | -------------------------------------------------------------------------- |
| `expire-requests`  | every minute | `requested` past `respondBy` → `expired`; notify                           |
| `expire-unpaid`    | every minute | `accepted` past `payBy` → `expired`; release hold; notify                  |
| `payment-reminder` | every 15 min | `accepted` with `payBy − 6h` passed → reminder                             |
| `pickup-reminder`  | hourly       | `confirmed` with `startsAt − 24h` → reminder both parties                  |
| `no-show-prompt`   | hourly       | `confirmed` with `startsAt + 3h` passed and no pickup → prompt provider    |
| `review-prompt`    | daily        | `completed` 1 day ago without review → email                               |
| `document-expiry`  | daily        | warn at 30/14/7/0 days; auto-pause vehicle on expiry if setting enabled    |
| `provider-metrics` | daily        | recompute acceptance rate, response time                                   |
| `cleanup`          | daily        | orphan uploads, expired OTPs/tokens, purge driver snapshots past retention |

---

## 16. Example end-to-end (happy path)

1. `GET /places/suggest?q=mir` → pick Mirissa.
2. `GET /search/vehicles?placeId=…&startsAt=…&endsAt=…&category=scooter`.
3. `GET /vehicles/honda-dio-2021-mirissa-k3p9` and `GET /vehicles/{id}/quote?…` → `quoteToken`.
4. `POST /auth/otp/request` + `POST /auth/otp/verify` (phone) → tokens.
5. `POST /bookings` (Idempotency-Key) → `requested`.
6. Provider: `POST /bookings/{id}/accept` → `accepted`, hold created.
7. Customer: `POST /bookings/{id}/payments/checkout` → PayHere form → pays.
8. PayHere → `POST /payments/payhere/notify` → `confirmed`; both notified; `GET /bookings/{id}/contact` now works.
9. Provider: `POST /bookings/{id}/pickup` → `active`; later `POST /bookings/{id}/return` → `completed`.
10. Customer: `POST /bookings/{id}/review`.
