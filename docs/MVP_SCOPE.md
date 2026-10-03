# MVP Scope (MoSCoW)

**Status:** Draft v0.1 for review (2026-10-02)
**Related:** [PRD.md](PRD.md), [ROADMAP.md](ROADMAP.md), [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md)

Scope principle: the MVP must prove **one loop** end to end in one region — _search with real availability → transparent price → request → provider accepts → advance paid → pickup → return → review_ — with human-verified providers. Anything that does not strengthen that loop waits.

Effort scale (for a team of 2–3 engineers): S ≤ 3 days · M ≈ 1 week · L ≈ 2 weeks · XL > 2 weeks.

---

## MUST HAVE (launch blockers)

| Area                | Feature                                                                                                                                                                                                                                | Effort              | Why it is a must                                      |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- | ----------------------------------------------------- |
| Foundation          | Monorepo, CI, Docker local env, Postgres+PostGIS, contracts package, design system baseline                                                                                                                                            | L                   | Everything depends on it                              |
| Auth                | Email+password, phone OTP (SMS), email OTP, refresh rotation, logout-all, password reset                                                                                                                                               | L                   | Bookings need verified contacts                       |
| Customer            | Profile, saved driver details (encrypted, opt-in), account deletion                                                                                                                                                                    | M                   | Self-drive bookings need driver data; PDPA            |
| Provider            | Provider profile (individual/business), document upload, submit for verification, verified badge, public profile, metrics (acceptance, response time)                                                                                  | L                   | Trust promise                                         |
| Admin               | Verification queues (providers, vehicles), document viewer with logging, user suspend, settings, audit log                                                                                                                             | L                   | Verification is manual; cannot launch without tooling |
| Geography           | Districts/places seed for South Coast, place suggest, active-district gating                                                                                                                                                           | S                   | Launch region                                         |
| Locations           | Pickup locations with map pin, approximate display, delivery toggle + radius + flat fee                                                                                                                                                | M                   | Pickup/delivery clarity                               |
| Vehicles            | Create/edit wizard, 3–15 photos (direct upload + variants), pricing fields (daily/weekly/monthly, driver fee, deposit, included km, extra km, min/max days, turnaround, notice), documents with expiry, status lifecycle, pause/resume | XL                  | Core catalogue                                        |
| Availability        | `vehicle_holds` with exclusion constraint, provider calendar, manual blocks, turnaround                                                                                                                                                | M                   | Double-booking prevention is the product              |
| Search              | Place or current location + dates (+ category); list + map (MapLibre); filters (category, price, transmission, fuel, seats, mode, delivery, verified); sorts; period total on cards; empty state                                       | XL                  | Core discovery                                        |
| Vehicle page        | Gallery, specs, quote panel (pay now / pay at pickup / deposit / km), 90-day unavailability, provider card, approximate location, requirements/licensing notice, reviews                                                               | L                   | Conversion                                            |
| Pricing             | Deterministic quote engine with signed quote token; day counting; weekly/monthly tiers; driver/delivery lines; advance = commission                                                                                                    | M                   | Transparency                                          |
| Booking             | Full lifecycle with timers, accept/decline/auto-decline, hold creation/release, cancel with platform policy, pickup/return records, no-show, contact reveal, booking pages for both sides, `allowedActions`                            | XL                  | Core transaction                                      |
| Payments            | PayHere Checkout for the advance, webhook verification + idempotency, payment status in booking, manual in-person payment records, admin refund recording (card via portal; wallet via bank transfer), daily reconciliation job        | L                   | Confirmation backed by money                          |
| Reviews             | Customer review per completed booking, provider reply, aggregates, admin hide                                                                                                                                                          | M                   | Trust loop                                            |
| Disputes            | Raise dispute with description/attachments, thread, admin resolution                                                                                                                                                                   | M                   | Operational necessity (deposits)                      |
| Notifications       | In-app feed, email (Resend), SMS to +94 (Notify.lk/Text.lk) for OTP and time-critical booking events, templates, delivery tracking, `wa.me` links                                                                                      | L                   | Request-to-book depends on fast provider response     |
| Jobs                | pg-boss worker: expiries, reminders, document expiry, image processing, metrics, cleanup                                                                                                                                               | M                   | Lifecycle automation                                  |
| Public pages        | Home with search, town/category landing pages (SSR), provider profile, vehicle page                                                                                                                                                    | M                   | SEO and first impression                              |
| Security            | Rate limits, Helmet/CSP, encryption helpers, PII log redaction, signed URLs, admin MFA (email OTP)                                                                                                                                     | M                   | Non-negotiable                                        |
| Observability       | Sentry, structured logs, health checks, uptime monitor, webhook/job alerts                                                                                                                                                             | S                   | Operate safely                                        |
| Legal/ops readiness | Terms, privacy policy (PDPA-aligned), cancellation policy text, PayHere merchant account (Lite→Plus), SMS sender ID registered, company/bank account                                                                                   | — (non-engineering) | Launch blockers outside code                          |

## SHOULD HAVE (in MVP if the schedule allows; otherwise first post-launch sprint)

| Feature                                                                            | Effort | Rationale                                                                                  |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------ |
| Zero-result search capture for demand analysis (place, dates, category; anonymous) | S      | Drives provider recruitment                                                                |
| Indicative USD/EUR/GBP price display with daily rate                               | S      | Tourist conversion                                                                         |
| Admin reports dashboard (funnel, GMV, commission, response metrics, expiries)      | M      | Operations; can start as SQL views                                                         |
| Payment reminder and pickup reminder SMS/email                                     | S      | Reduces expiry and no-shows (included in notification matrix; listed here in case of cuts) |
| Vehicle auto-pause on document expiry (setting)                                    | S      | Trust integrity                                                                            |
| Provider "concierge" import tool (admin creates listings on behalf of providers)   | M      | Supply bootstrap                                                                           |
| Google sign-in                                                                     | M      | Tourist convenience                                                                        |
| Basic structured data + sitemap for SEO                                            | S      | Organic acquisition                                                                        |
| Analytics events (PostHog/Plausible) for the funnel                                | S      | Learn                                                                                      |

## COULD HAVE (post-launch improvements, Phase 11)

| Feature                                                                                 | Effort |
| --------------------------------------------------------------------------------------- | ------ |
| Instant book (provider-enabled)                                                         | M      |
| Seasonal/date-range pricing overrides                                                   | M      |
| Compare drawer, favourites                                                              | M      |
| Address/hotel-name autocomplete (Geoapify/Photon)                                       | S–M    |
| Booking extension / date change                                                         | L      |
| Structured handover checklist with photos                                               | M      |
| Provider→customer reviews (private reliability)                                         | M      |
| Promo codes                                                                             | M      |
| WhatsApp Cloud API notifications (after Meta verification); international SMS via CPaaS | M      |
| Sinhala/Tamil UI; bilingual SMS                                                         | L      |
| Multi-user provider accounts                                                            | M      |
| iCal import/export                                                                      | M      |
| Settlements UI when advance > commission                                                | M      |
| Genie Business as alternative/lower-fee gateway                                         | M      |
| Push notifications (web push)                                                           | S      |

## NOT NOW (explicitly deferred or out of scope)

| Item                                                         | Reason                                                                                                |
| ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Native mobile apps                                           | Web is mobile-first; API is ready; build apps after product-market signal                             |
| In-platform real-time chat                                   | WhatsApp hand-off after confirmation is sufficient; chat adds infra and moderation                    |
| Full online payment, deposit holds, automated payouts/escrow | Gateway limits (7-day holds, no split payouts), money-transfer regulation to verify, operational load |
| Automated KYC/liveness vendors                               | Cost and PDPA special-category implications; manual verification works at launch scale                |
| Dynamic/surge pricing, bidding                               | Undermines price transparency                                                                         |
| GPS trackers / telematics                                    | Not required; provider-side hardware                                                                  |
| Insurance/damage-waiver products                             | Partnerships later; legal complexity                                                                  |
| Google Maps Platform                                         | Not needed at town-level search; ToS and cost considerations (TECH_DECISIONS D6)                      |
| Island-wide launch                                           | Supply density first                                                                                  |
| Subscription/long-term bundles (LankaRent model)             | Different product; monthly rates suffice                                                              |
| Ride-hailing / chauffeur-on-demand                           | Different market                                                                                      |
| Vehicle sales, parts, services                               | Scope creep                                                                                           |

## Decision-dependent items

| Item                                                   | Depends on                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Tuk-tuk and scooter categories active at launch        | Product/legal decision on foreigner three-wheeler licensing (PRODUCT_BRIEF §11 assumption 8) |
| Vehicle document verification required before `active` | Trust-vs-supply trade-off decision                                                           |
| Contact reveal at `accepted` vs `confirmed`            | Leakage-vs-coordination decision (recommendation: `confirmed`)                               |
| Commission % and advance %                             | Business decision (defaults 10% / 10%)                                                       |
| Cancellation thresholds                                | Business decision (defaults 48 h)                                                            |
