# Product Requirements Document (PRD)

**Status:** Draft v0.1 for review (2026-10-02)
**Related:** [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md), [USER_FLOWS.md](USER_FLOWS.md), [MVP_SCOPE.md](MVP_SCOPE.md), [API_DESIGN.md](API_DESIGN.md), [DATABASE_DESIGN.md](DATABASE_DESIGN.md), [SECURITY_AND_PRIVACY.md](SECURITY_AND_PRIVACY.md)

Tags: **[MVP]** required for first launch · **[Later]** designed for, built after launch · **[Out]** explicitly out of scope.

---

## 1. Purpose and scope

Define what the first production release of the Platform must do for customers, providers and admins, and what it must not do, so that engineering can plan phases (ROADMAP.md) without re-deciding product questions.

In scope: web application (responsive, mobile-first), REST API, admin console, PayHere advance payment, email/SMS notifications, South Coast launch region.
Out of scope for this document: brand/visual identity, marketing site copy, legal texts (terms/privacy) beyond the requirements they impose.

## 2. User roles

| Role                       | Description                                                                   | Authentication                         |
| -------------------------- | ----------------------------------------------------------------------------- | -------------------------------------- |
| Visitor                    | Unauthenticated user browsing/searching                                       | None                                   |
| Customer                   | Registered user who books vehicles                                            | Email+password, phone OTP or email OTP |
| Provider (owner)           | Customer account with a provider profile; lists vehicles and manages bookings | Same, verified phone mandatory         |
| Provider staff **[Later]** | Additional users on a provider account with scoped permissions                | Same                                   |
| Admin                      | Platform operations: verification, moderation, bookings, disputes             | Email+password + email OTP (MFA)       |
| Super admin                | Admin plus settings, admin user management, districts/categories              | Same, TOTP **[Later]**                 |

A user may be both customer and provider. Admins are created by a super admin only.

## 3. Functional requirements

### 3.1 Accounts and identity

| ID    | Requirement                                                                                                                                                    | Tag   |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| FR-A1 | Visitors can browse, search and view vehicle and provider pages without an account                                                                             | MVP   |
| FR-A2 | Users can register with email+password, or with a phone number (SMS OTP), or email OTP; at least one verified contact channel is required to request a booking | MVP   |
| FR-A3 | Password rules: ≥10 characters, breached-password check; reset via emailed single-use link                                                                     | MVP   |
| FR-A4 | Sessions: 15-minute access tokens, 30-day rotating refresh; "log out everywhere"                                                                               | MVP   |
| FR-A5 | Profile: name, avatar, preferred language/currency, country of residence                                                                                       | MVP   |
| FR-A6 | Saved driver details (licence, ID) with explicit consent and masking in UI                                                                                     | MVP   |
| FR-A7 | Account deletion request → anonymisation after retention checks                                                                                                | MVP   |
| FR-A8 | Google sign-in                                                                                                                                                 | Later |
| FR-A9 | Customer licence photo upload for provider pre-check                                                                                                           | Later |

### 3.2 Provider onboarding and verification

| ID    | Requirement                                                                                                                                                          | Tag                  |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| FR-P1 | Any user with a verified phone can create a provider profile (individual or business)                                                                                | MVP                  |
| FR-P2 | Provider uploads identity documents (NIC front/back or passport; business: BR certificate + owner NIC) to private storage                                            | MVP                  |
| FR-P3 | Provider submits for verification; admin approves/rejects with reason; provider notified; status visible in dashboard                                                | MVP                  |
| FR-P4 | Only `verified` providers can publish vehicles (recommended; see decision list)                                                                                      | MVP                  |
| FR-P5 | Provider public profile: display name, type, verified badge, member since, completed bookings, rating, response time, description, locations (approximate), vehicles | MVP                  |
| FR-P6 | Provider contact (phone/WhatsApp) is never public; revealed to a customer only at the configured booking stage                                                       | MVP                  |
| FR-P7 | Provider bank details (encrypted) — required only when settlements are enabled                                                                                       | Later (table in MVP) |
| FR-P8 | Multi-user provider accounts with roles                                                                                                                              | Later                |
| FR-P9 | Provider metrics: acceptance rate, average response time, cancellation count (computed daily, shown to admin; acceptance rate and response time shown publicly)      | MVP                  |

### 3.3 Locations

| ID    | Requirement                                                                                                           | Tag   |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ----- |
| FR-L1 | Provider creates one or more pickup locations: name, address, nearest place (gazetteer), map pin, pickup instructions | MVP   |
| FR-L2 | Locations must be in an active district (launch: Matara, Galle)                                                       | MVP   |
| FR-L3 | Delivery option per location: available, radius (km), flat fee                                                        | MVP   |
| FR-L4 | Per-km delivery pricing, opening hours                                                                                | Later |
| FR-L5 | Customers see only an approximate location (~500 m) until confirmation; exact address and pin after                   | MVP   |

### 3.4 Vehicles and catalogue

| ID     | Requirement                                                                                                                                                                                                                                                              | Tag                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| FR-V1  | Categories are data (seeded: car, suv, van, bike; scooter and tuktuk pending decision); admins can add categories                                                                                                                                                        | MVP                                        |
| FR-V2  | Vehicle fields (MVP): category, make, model, year, registration number (private), colour, transmission, fuel, seats, engine cc (two/three-wheelers), features, description, rental mode offer (self-drive / with driver / both), home location                           | MVP                                        |
| FR-V3  | Pricing fields (MVP): currency (LKR), daily rate, optional weekly and monthly rates, driver fee per day, security deposit amount, included km per day (or unlimited) with extra-km rate, min/max rental days, turnaround hours, advance notice hours, minimum driver age | MVP                                        |
| FR-V4  | 3–15 photos per vehicle, direct upload, reorder, primary photo; variants generated                                                                                                                                                                                       | MVP                                        |
| FR-V5  | Vehicle documents: certificate of registration, revenue licence (expiry), insurance certificate (expiry), emission test (optional) → admin review → "Verified vehicle" badge                                                                                             | MVP                                        |
| FR-V6  | Document expiry reminders at 30/14/7/0 days; badge removed on expiry; optional auto-pause (setting)                                                                                                                                                                      | MVP                                        |
| FR-V7  | Vehicle status lifecycle: draft → pending_review → active ↔ paused → archived; rejected with reason                                                                                                                                                                      | MVP                                        |
| FR-V8  | Seasonal/date-range pricing overrides                                                                                                                                                                                                                                    | Later                                      |
| FR-V9  | Hourly pricing, instant book flag (default off)                                                                                                                                                                                                                          | Later                                      |
| FR-V10 | Mileage/odometer tracking across bookings                                                                                                                                                                                                                                | Later (fields captured at handover in MVP) |

### 3.5 Availability

| ID     | Requirement                                                                                                                       | Tag   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------- | ----- |
| FR-AV1 | A vehicle's unavailability is the union of booking holds and provider blocks; enforced by the database so overlaps are impossible | MVP   |
| FR-AV2 | Provider calendar per vehicle: view holds, add/remove manual blocks with reason; cannot block over a confirmed booking            | MVP   |
| FR-AV3 | Search and vehicle pages show availability only for the requested window; vehicle page shows a 90-day unavailable-dates view      | MVP   |
| FR-AV4 | Turnaround buffer per vehicle applied after each booking                                                                          | MVP   |
| FR-AV5 | iCal import/export for external channel sync                                                                                      | Later |

### 3.6 Search and discovery

| ID    | Requirement                                                                                                                                                                                                                              | Tag                                |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| FR-S1 | Search inputs: place (gazetteer suggest) **or** current location; pickup and return date-times (mandatory); category (optional)                                                                                                          | MVP                                |
| FR-S2 | Results include only vehicles free for the whole window, active, within radius; each result shows photo, title, specs, distance, provider name + badges, rating, **period total**, per-day, deposit, rental modes, delivery availability | MVP                                |
| FR-S3 | List and map views (MapLibre); map pins at approximate provider location; "search this area"                                                                                                                                             | MVP                                |
| FR-S4 | Filters: category, price/day range, transmission, fuel, seats, rental mode, delivery available, verified only (default on)                                                                                                               | MVP                                |
| FR-S5 | Sort: recommended, price asc/desc, distance, rating                                                                                                                                                                                      | MVP                                |
| FR-S6 | Empty-state guidance (widen radius, shift dates) and demand capture of zero-result searches (place, dates, category; no user identity)                                                                                                   | MVP (capture: Later if time-boxed) |
| FR-S7 | SEO landing pages per place and category, server-rendered                                                                                                                                                                                | MVP (basic)                        |
| FR-S8 | Compare drawer (up to 3), favourites                                                                                                                                                                                                     | Later                              |
| FR-S9 | Address/hotel-name autocomplete                                                                                                                                                                                                          | Later                              |

### 3.7 Pricing and quotes

| ID     | Requirement                                                                                                                                                                                                                                                                                                                           | Tag                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------ |
| FR-PR1 | Quote for a vehicle + window + options returns line items: base rental (days × rate, with weekly/monthly rate applied when thresholds met), driver fee, delivery fee, customer fee (0 in MVP), discounts (0 in MVP); subtotal; total; deposit; **amount payable now**; **amount payable at pickup**; included km total; extra-km rate | MVP                |
| FR-PR2 | Billable days = ceil(duration / 24 h), minimum 1; the rule is displayed                                                                                                                                                                                                                                                               | MVP                |
| FR-PR3 | Quote is signed and valid 15 minutes; booking creation re-validates and rejects changed prices                                                                                                                                                                                                                                        | MVP                |
| FR-PR4 | Prices in LKR; indicative display in USD/EUR/GBP with daily rate and a disclaimer                                                                                                                                                                                                                                                     | MVP (display only) |
| FR-PR5 | Promo codes, additional driver fee, extra mileage pre-purchase, taxes as separate lines                                                                                                                                                                                                                                               | Later              |
| FR-PR6 | Extra charges at return (extra km, fuel, damage) recorded by provider as free-form lines with amounts; customer sees them                                                                                                                                                                                                             | MVP                |

### 3.8 Booking

| ID     | Requirement                                                                                                                                                                          | Tag   |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----- |
| FR-B1  | Request-to-book with the lifecycle in USER_FLOWS §0: requested → accepted → confirmed → active → completed, plus declined, expired, cancelled (by customer/provider), no_show        | MVP   |
| FR-B2  | Request captures: dates, rental mode, pickup type (at location / delivery address), driver details (self-drive), note, policy acceptance                                             | MVP   |
| FR-B3  | Provider response window (default 24 h, capped near pickup); expiry auto-handled; acceptance creates the calendar hold and auto-declines overlapping requests                        | MVP   |
| FR-B4  | Payment window after acceptance (default 24 h, capped at pickup); expiry releases the hold                                                                                           | MVP   |
| FR-B5  | Booking page shows status, timers, allowed actions, price breakdown, payments, handover/return records; provider sees renter details appropriate to the stage                        | MVP   |
| FR-B6  | Handover recording (odometer, fuel, deposit/balance collected) and return recording (odometer, fuel, extra charges, deposit returned) by provider; customer notified with the record | MVP   |
| FR-B7  | Cancellation with platform-wide policy (full advance refund ≥48 h before pickup; none after) and provider-cancellation penalties; refunds executed manually by admin in MVP          | MVP   |
| FR-B8  | No-show marking by provider after a grace period with a contact-attempt note                                                                                                         | MVP   |
| FR-B9  | Contact reveal (phone, WhatsApp link, email) at the configured stage; logged                                                                                                         | MVP   |
| FR-B10 | Booking extension / date change                                                                                                                                                      | Later |
| FR-B11 | Instant book for providers who enable it                                                                                                                                             | Later |
| FR-B12 | Structured handover checklist with photos                                                                                                                                            | Later |
| FR-B13 | Maximum 3 open requests per customer; one request per customer per vehicle per overlapping window                                                                                    | MVP   |

### 3.9 Payments

| ID     | Requirement                                                                                                                                                             | Tag           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| FR-PA1 | Online advance via PayHere Checkout; amount = `advance_percentage` of total (default = commission rate, 10%)                                                            | MVP           |
| FR-PA2 | Webhook verification, idempotency, reconciliation via Retrieval API (daily job comparing pending payments)                                                              | MVP           |
| FR-PA3 | Balance, deposit, extra charges and deposit refunds recorded as in-person payments (informational)                                                                      | MVP           |
| FR-PA4 | Refund handling: card refunds via PayHere portal recorded by admin; wallet/bank-method refunds via bank transfer with customer bank details captured in the refund flow | MVP           |
| FR-PA5 | Ledger entries for every advance (collected, commission); settlements dormant while advance = commission                                                                | MVP (dormant) |
| FR-PA6 | Full online payment, automated refunds, deposit holds (Authorize/Capture), tokenised re-auth, scheduled CEFTS payouts                                                   | Later         |
| FR-PA7 | Multiple gateways (Genie Business/OnePay) behind the gateway interface                                                                                                  | Later         |

### 3.10 Trust: verification, reviews, disputes

| ID    | Requirement                                                                                                                                                                                  | Tag         |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| FR-T1 | Badges: "Verified provider" (identity/business docs approved), "Verified vehicle" (CR + revenue licence + insurance approved and in date)                                                    | MVP         |
| FR-T2 | Reviews: one per completed booking by the customer within 14 days; rating 1–5, optional sub-ratings, comment; provider reply; aggregates on vehicle and provider; admin can hide with reason | MVP         |
| FR-T3 | Provider → customer reviews / renter reliability score (private)                                                                                                                             | Later       |
| FR-T4 | Disputes: raised from active/completed/no-show/cancelled bookings within 14 days; thread with attachments; admin resolution with notes and optional ledger adjustment                        | MVP (basic) |
| FR-T5 | Licensing guidance: self-drive bookings show licence requirements by category and residence (IDP + Sri Lankan permit for foreigners; three-wheeler restriction notice)                       | MVP         |
| FR-T6 | Automated KYC (liveness, document OCR)                                                                                                                                                       | Later       |

### 3.11 Notifications

| ID    | Requirement                                                                                                                                                        | Tag                                      |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------- |
| FR-N1 | In-app notification feed with unread count                                                                                                                         | MVP                                      |
| FR-N2 | Email for all users; SMS for Sri Lankan numbers for time-critical events (OTP, request, acceptance, payment reminder, confirmation, pickup reminder, cancellation) | MVP                                      |
| FR-N3 | Notification matrix in USER_FLOWS §4                                                                                                                               | MVP                                      |
| FR-N4 | `wa.me` deep links to counterpart after contact reveal                                                                                                             | MVP                                      |
| FR-N5 | International SMS, WhatsApp Cloud API templates, push notifications, per-user preferences                                                                          | Later                                    |
| FR-N6 | In-platform chat                                                                                                                                                   | Out (MVP); reconsider only with evidence |

### 3.12 Admin

| ID     | Requirement                                                                                                                                       | Tag                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| FR-AD1 | Verification queues (providers, vehicles) with document viewer (signed URLs, logged), approve/reject/request-info                                 | MVP                                    |
| FR-AD2 | User management: search, view, suspend/unsuspend, anonymise                                                                                       | MVP                                    |
| FR-AD3 | Listing management: search, pause, edit category, remove photos                                                                                   | MVP                                    |
| FR-AD4 | Booking operations: search, timeline, cancel with reason and refund decision, record payment, resend notifications                                | MVP                                    |
| FR-AD5 | Disputes queue and resolution                                                                                                                     | MVP                                    |
| FR-AD6 | Refund recording; settlements generation/approval/mark-paid (dormant until needed)                                                                | MVP (refunds) / Later (settlements UI) |
| FR-AD7 | Reports: funnel, bookings by status, GMV/commission, top places/categories, zero-result searches, provider response metrics, document expiry list | MVP (basic)                            |
| FR-AD8 | Settings (commission, advance %, windows, radius), districts/places/categories management, audit log viewer                                       | MVP                                    |

### 3.13 Localisation

| ID    | Requirement                                                                      | Tag   |
| ----- | -------------------------------------------------------------------------------- | ----- |
| FR-I1 | UI in English; all strings externalised; dates in `Asia/Colombo`; LKR formatting | MVP   |
| FR-I2 | Sinhala and Tamil UI; bilingual SMS templates                                    | Later |

## 4. Non-functional requirements

| Area               | Requirement                                                                                                                                                                 |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Performance        | Search API p95 < 500 ms at 10k listings; vehicle page LCP < 2.5 s on 4G; map initial render < 2 s                                                                           |
| Availability       | 99.5% monthly for web/API; webhook endpoint monitored separately; graceful degradation if tiles are unavailable (list view works)                                           |
| Correctness        | Zero overlapping holds (DB-enforced); price shown = price stored (signed quote); webhooks idempotent                                                                        |
| Security & privacy | Per SECURITY_AND_PRIVACY.md: Argon2id, rotating refresh tokens, RBAC, encrypted sensitive columns, private documents, PII redaction in logs, PDPA-aligned consent/retention |
| Scalability        | Stateless API; horizontal scale by adding instances; PostGIS handles island-wide listings; module boundaries allow extraction                                               |
| Observability      | Structured logs with request ids; error tracking; uptime monitoring; business-event logging for the funnel                                                                  |
| Accessibility      | WCAG 2.1 AA for search, vehicle, booking and payment flows; keyboard alternative to map                                                                                     |
| Mobile             | Responsive, mobile-first layouts; Core Web Vitals "good" on mid-range Android                                                                                               |
| SEO                | Server-rendered public pages, structured data, sitemap, canonical URLs                                                                                                      |
| Maintainability    | TypeScript strict; shared contracts; tests on pricing/state machine/availability; docs updated with changes (CLAUDE.md)                                                     |
| Cost               | Infrastructure ≤ USD 50/month at MVP load; no per-map-load fees; SMS budget alerting                                                                                        |
| Data residency     | Hosted in Singapore (documented), with PDPA cross-border instruments; revisit if law requires local hosting                                                                 |
| Compliance         | PDPA readiness for 1 Jan 2027; VAT handling documented; terms/privacy reviewed by counsel before launch                                                                     |

## 5. User stories and acceptance criteria (critical paths)

### US-1 Search with real availability

_As a customer, I want to search by place and dates so that I only see vehicles I can actually book._

- Given a place and a window, when I search, then every result is `active`, within radius, free for the entire window including turnaround, and satisfies min/max days and advance notice.
- Given a vehicle with a confirmed booking overlapping my window, then it does not appear.
- Given no results, then I see suggestions and the search is recorded for demand analysis without my identity.

### US-2 Transparent price

_As a customer, I want to see the full cost before booking._

- Given a vehicle page with dates, when the quote loads, then I see base, driver, delivery lines, total, deposit, pay-now and pay-at-pickup amounts, included km and extra-km rate.
- Given the provider changes the price after I viewed the quote, when I submit, then I get a clear "price changed" message with the new quote, not a silent change.

### US-3 Request, accept, pay, confirm

_As a customer, I want a booking that is really confirmed._

- Given I submit a request, then the provider is notified within 1 minute by in-app, email and SMS (if +94) and I see the response deadline.
- Given the provider accepts, then the calendar is held, overlapping requests from others are declined, and I receive a payment link with a deadline.
- Given I pay via PayHere and the webhook arrives, then within 60 s my booking shows `confirmed` with exact pickup details and provider contact.
- Given two providers' staff click accept on two overlapping requests simultaneously, then exactly one succeeds and the other sees a conflict.
- Given I do not pay by the deadline, then the hold is released and the provider is informed.

### US-4 Provider acceptance

_As a provider, I want to vet requests quickly._

- Given a new request, when I open it, then I see dates, price I will receive, renter's verification badges, licence country/expiry and note.
- Given I accept, then I cannot accidentally double-book: a conflict is refused with the conflicting booking shown.

### US-5 Verification badges

_As a customer, I want to know who is verified._

- Given a provider whose documents were approved by an admin, then "Verified provider" shows on cards, vehicle page and profile.
- Given a vehicle whose insurance expired, then "Verified vehicle" is removed on expiry day and the provider was warned at 30/14/7/0 days.

### US-6 Handover and return records

- Given pickup, when the provider records odometer/fuel/deposit, then I receive the record by email and can see it in the booking.
- Given return with extra charges, then the amounts and deposit returned are visible to me and are attached to any dispute.

### US-7 Cancellation and refund

- Given I cancel ≥48 h before pickup, then the advance is marked refund-due, the vehicle is released and admin sees a refund task; I am told the method and timeline.
- Given the provider cancels a confirmed booking, then I am refunded in full, offered alternatives, and the provider's cancellation count increments.

### US-8 Review

- Given a completed booking, when I review within 14 days, then it is published, aggregates update, and I cannot review twice.

### US-9 Admin verification

- Given a pending provider, when I view documents, then the access is logged and URLs expire within 2 minutes; approve/reject notifies the provider with my reason.

### US-10 Tourist licensing guidance

- Given I select "self-drive" and my residence is not Sri Lanka, then before requesting I see the IDP + Sri Lankan permit requirements for the category, and for three-wheelers a notice about licensing restrictions.

## 6. MVP requirement summary

Everything tagged **MVP** above, delivered through ROADMAP Phases 1–10. Full MoSCoW breakdown in MVP_SCOPE.md.

## 7. Future requirements (designed for)

Instant book; seasonal pricing; promo codes; compare/favourites; address autocomplete; booking extension; structured handover checklists with photos; provider→customer reviews; multi-user providers; iCal sync; full online payment with deposits holds and settlements; alternative gateways; WhatsApp Cloud API, international SMS, push; Sinhala/Tamil UI; mobile app; automated KYC; insurance/damage-waiver partnerships; demand insights for providers; Colombo/airport and further districts.

## 8. Out of scope

Real-time chat; GPS trackers/telematics; dynamic pricing; ride-hailing/chauffeur-on-demand; long-term subscription bundles (LankaRent's model); escrow of deposits; peer-to-peer insurance; vehicle sales; parts/services marketplace; multi-country support.

## 9. Open questions

See PRODUCT_BRIEF §12 and the approval summary. Notable for the PRD: whether to require vehicle document verification before a vehicle can be `active` (recommendation: provider verification required, vehicle verification optional but badged) and the tuk-tuk/scooter category policy.
