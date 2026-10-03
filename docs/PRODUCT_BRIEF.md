# Product Brief — Sri Lankan Vehicle Rental Marketplace

**Status:** Draft v0.1 for review (2026-10-02). Working name: _the Platform_ (brand name is an open decision).
**Related:** [COMPETITOR_ANALYSIS.md](COMPETITOR_ANALYSIS.md), [PRD.md](PRD.md), [MVP_SCOPE.md](MVP_SCOPE.md), [ROADMAP.md](ROADMAP.md)

---

## 1. Problem

Renting a vehicle in Sri Lanka — a car, van, SUV, motorbike, scooter or tuk-tuk — is a manual, trust-poor process:

- **Fragmented discovery.** Supply is spread across Facebook pages, ikman.lk classifieds, Google results, hostel notice boards and word of mouth. Customers phone or WhatsApp several providers one by one.
- **No real availability.** Listings never say whether the vehicle is free on the dates needed; customers find out after a conversation, sometimes after a "confirmation" that is later overridden ("rented it to other people despite he confirmed it to me 2 days ago" — TripAdvisor review of a Mirissa operator, see COMPETITOR_ANALYSIS §11).
- **Opaque pricing.** A "Rs 7,500/day" figure hides deposits, mileage caps, extra-km rates, driver fees, delivery charges and seasonal mark-ups. Totals are negotiated, not shown.
- **Unverifiable trust.** Customers cannot tell whether the provider exists, owns the vehicle, has a current revenue licence and hire-endorsed insurance, or has a track record. Providers cannot tell whether a renter is licensed (a real liability: police operations in 2026 targeted owners who hand vehicles to unlicensed foreigners).
- **Tourists are poorly served.** The live local platforms are LKR-only and NIC-only; licensing requirements (IDP + a Sri Lankan permit) are unexplained; passports get held as deposits.

The live Sri Lankan platforms are either classifieds with no booking layer (Renta.lk, RentMyCar.lk, RentEase), app-only marketplaces with little traction or undisclosed fees (ROFI, Kuliya), or well-designed but empty pre-launch sites (DriveLink, LankaRent). None combines date-based real availability, transparent total pricing, verified providers, visible reviews and online booking confirmation.

## 2. Target users

### Customers

| Persona                              | Situation                                                                                                                                                    | What they need from us                                                                                                                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Emma, 29, tourist (UK/EU/AU)**     | Two weeks on the south coast; wants a scooter for a week in Weligama and maybe a car with driver for a day trip; has an IDP; pays by card; relies on reviews | Search by town and dates, see total price in a familiar currency, know the licence rules, book with a card, get a WhatsApp contact she can trust |
| **Nimal, 34, Colombo professional**  | Visiting Matara for a family event; needs a car for 3 days; knows prices, hates calling five people                                                          | Instant comparison, transparent deposit and mileage, confirmation he can rely on, pay via card/Genie                                             |
| **Dilani, 41, expatriate returning** | Needs a van with driver for a week around Galle for a family of six                                                                                          | Filter "with driver", seat count, provider reputation, clear pickup arrangements                                                                 |

### Providers

| Persona                                                  | Situation                                                                                   | What they need from us                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Sunil, Mirissa scooter/tuk-tuk operator (8 vehicles)** | Runs on WhatsApp and walk-ins; double-books in high season; no website                      | Free listing, a calendar, SMS when a request comes, control over who he rents to, payment he does not need to chase, no technical setup |
| **Priya, Galle rent-a-car business (25 cars, 3 staff)**  | Has a Facebook page and a basic site; uses a spreadsheet for bookings; wants tourist demand | Multi-vehicle management, documents and badges that prove legitimacy, delivery options, later multi-user access and reports             |
| **Kasun, individual owner (1 car, Matara)**              | Wants his car to earn when idle                                                             | Simple onboarding, verification that reassures renters, protection against unlicensed drivers                                           |

### Admin / operations

The founding team: verifies providers and vehicles, moderates, handles disputes and refunds, watches demand data to recruit supply.

## 3. Product vision

> The reliable way to rent a vehicle anywhere in Sri Lanka: search what is actually available near you, see the whole price, trust who you rent from, and book in minutes.

Five-year direction: island-wide coverage, instant booking for trusted providers, integrated deposits and insurance options, provider tooling that replaces spreadsheets, and a mobile app for both sides. The MVP proves the core loop in one region.

## 4. Core value proposition

**For customers:** _Search nearby vehicles + see real availability + compare transparent prices + trust verified providers + book._ One search instead of ten conversations; a confirmed booking instead of a hopeful promise.

**For providers:** Qualified demand (customers with dates, verified contact details and a paid commitment), a calendar that prevents double-booking, a verification badge that converts, and no listing fees.

**Positioning:** a booking marketplace (Booking.com-like flow), explicitly **not** a classifieds board. Every listing shows real availability for the searched dates and a full price breakdown; every provider shown as verified has had documents checked by a human.

## 5. Target market

- **Primary (launch):** inbound tourists on the South Coast (Matara–Galle corridor) renting scooters, motorbikes, tuk-tuks (with policy caveat, §11) and cars (self-drive or with driver), plus domestic travellers visiting the same area.
- **Secondary (launch):** local residents of Matara/Galle districts needing short-term cars and vans.
- **Later:** Colombo and airport pickups, Kandy/Ella, East coast (Arugam Bay seasonal), Negombo; long-term/monthly rentals; corporate rentals.

Market sizing is intentionally not quantified here: public tourist-arrival statistics exist (Sri Lanka Tourism Development Authority publishes monthly data) but share-of-wallet for rentals is not; sizing is an assumption to validate with provider interviews and the demand data the platform itself will collect (zero-result searches by town).

## 6. Initial launch geography

**Launch region: South Coast — Matara, Weligama, Mirissa, Galle, Unawatuna** (Matara and Galle districts active in the system; surrounding towns such as Ahangama, Midigama, Dickwella, Hikkaduwa and Tangalle seeded as places).

Why here first:

1. Dense tourist demand within a 40 km stretch with heavy two-wheeler and tuk-tuk rental activity, mostly WhatsApp-based today.
2. Supply is fragmented small operators (easy to onboard, badly served) rather than a few large companies.
3. Competitors' inventory is thinnest here (ikman: Matara district 6 rental ads; Galle 41, car-heavy).
4. The founding team can physically verify providers and vehicles, which is the trust promise.
5. A compact region makes "nearby" meaningful and lets us test delivery radii and pickup logistics.

Expansion is data-driven: districts are switched on when (a) zero-result searches in that district pass a threshold and (b) at least N verified providers are onboarded (N to be set; assumption 8–10 per town cluster).

## 7. Main use cases

1. Tourist searches "Mirissa", picks dates, filters scooters, compares totals, requests a booking, pays the advance by card, meets the provider at the shop with IDP and passport, pays the balance and deposit, rides, returns, reviews.
2. Local customer searches from current location in Galle for a car with driver tomorrow, books, pays advance via Genie/card, provider delivers to the hotel.
3. Provider receives an SMS about a new request, checks the renter's licence details and dates, accepts; the calendar blocks the vehicle; the customer pays; the provider sees the confirmed booking with contact details.
4. Provider blocks a vehicle for maintenance; it disappears from search for those dates.
5. Admin verifies a new provider's NIC/BR and a vehicle's registration, revenue licence and insurance; badges appear; expiry reminders fire later.
6. Customer cancels three days before pickup; advance refunded per policy; the vehicle becomes available again.
7. Dispute: deposit not returned in full; customer raises a dispute with the handover record; admin mediates.
8. Admin reviews weekly demand: where searches returned nothing, to target provider recruitment.

## 8. Product differentiation

| Versus                                                   | Their model                                                                              | Our difference                                                                                                             |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Classifieds (Renta.lk, RentMyCar.lk, ikman, Facebook)    | Listing + phone call; no dates, no availability, no payment, no verification, no reviews | Date-based availability, total price, verified badges, confirmed booking with audit trail, reviews only from real bookings |
| WhatsApp-first operators (tuktukrental.com, local shops) | Good service for one brand; no comparison; passports as deposits                         | Compare many providers; no passport deposits; documented deposit terms                                                     |
| ROFI (app marketplace)                                   | Request → approve → pay; hidden fees; thin reviews; web not crawlable                    | Transparent commission; SEO-visible town pages; focus region with human verification; tourist licensing guidance           |
| DriveLink / LankaRent (pre-launch)                       | Strong trust design, no inventory, no payments                                           | Supply-first launch in one region; payment-backed confirmation; faster go-to-market with a narrower scope                  |
| Kuliya ("rent anything")                                 | Horizontal; NIC-only KYC; 100+ installs                                                  | Vertical depth (vehicle-specific fields, licence rules), tourist-ready identity model                                      |

We do **not** claim to be first with online booking, KYC or calendars. We claim the first _reliable combination_ in a focused geography, built for tourists and locals alike.

## 9. Business model possibilities

| Model                                                                                                       | MVP?              | Notes                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Provider-borne commission (default 10%) collected as the online booking advance**                         | **Yes**           | Customer pays no extra fee; provider's listed price is the final price; platform keeps the advance; balance paid to provider at pickup. No payouts needed. (TECH_DECISIONS D8) |
| Customer service fee on top of price                                                                        | No (designed for) | `customer_fee_amount` exists; can be enabled per segment (e.g. tourists) later                                                                                                 |
| Higher online advance with periodic provider settlements                                                    | No (designed for) | Turns on ledger/settlement runs; needs legal review of money-transfer rules                                                                                                    |
| Featured placement / boosts                                                                                 | No                | Avoid early: it distorts the "recommended" sort that trust depends on                                                                                                          |
| Provider subscription for pro tooling (multi-user, reports, iCal sync)                                      | Later             | Only once the free tier is clearly valuable                                                                                                                                    |
| Add-ons: delivery coordination, permit assistance referrals (AAC/DMT), insurance/damage-waiver partnerships | Later             | Permit assistance is a genuine tourist pain point and a partnership opportunity                                                                                                |
| Data/insights for providers (demand by town/date)                                                           | Later             | By-product of search logs                                                                                                                                                      |

Unit economics sketch (assumption): average booking LKR 25,000 → commission LKR 2,500 → PayHere fee on the advance ≈ LKR 83 → SMS/email ≈ LKR 5 → contribution ≈ LKR 2,400 per booking before fixed costs (≈ USD 25–50/month infrastructure at MVP).

## 10. Risks

### Business / product

| Risk                                                                                                                                                                                                                           | Severity    | Mitigation                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Supply acquisition**: providers will not list or will not respond within the window                                                                                                                                          | High        | Founder-led onboarding in person; SMS alerts; acceptance-rate visibility; start with 20–40 vehicles across the five towns before public launch; "concierge" mode where the team enters listings for providers initially |
| **Off-platform leakage**: provider and customer agree to skip the platform after contact                                                                                                                                       | High        | Contact revealed only after the advance is paid; the advance is small (10%) so there is little to save; reviews and dispute support only for on-platform bookings                                                       |
| **Trust incidents**: accident, damage dispute, unlicensed driving, passport confiscation                                                                                                                                       | High        | Verification gate; handover records; licence/IDP guidance; deposit policy transparency; dispute process; terms that make roles explicit; insurance partnerships later                                                   |
| **Seasonality**: south-coast demand peaks Dec–Mar; low season tests retention                                                                                                                                                  | Medium      | Local-customer segment; district expansion before low season; monthly rentals later                                                                                                                                     |
| **Competitive response**: ROFI or DriveLink moves into the region with payments                                                                                                                                                | Medium      | Speed, supply density and verification quality in the launch region; reviews as a moat                                                                                                                                  |
| **Regulatory**: PDPA obligations (core provisions from 1 Jan 2027), SLTDA registration, stamp duty on hire agreements, money-transfer rules if we ever hold provider funds; DMT does not license foreigners for three-wheelers | Medium–High | Build to PDPA now; legal review before launch; keep money model B; tuk-tuk policy decision (§11)                                                                                                                        |
| **Payment friction**: tourists' foreign cards declined, wallet refunds manual                                                                                                                                                  | Medium      | Verify PayHere foreign-card handling in sandbox/onboarding; email-based manual refund flow; Genie Business as backup gateway                                                                                            |
| **Small team bandwidth**: verification, disputes and refunds are manual                                                                                                                                                        | Medium      | Admin tooling from Phase 3; SLAs stated honestly; queue limits                                                                                                                                                          |

### Technical

See the "Biggest technical risks" list in the approval summary and ARCHITECTURE/TECH_DECISIONS: availability correctness under concurrency, webhook reliability, SMS deliverability, OpenFreeMap availability, OTP abuse/SMS cost, data protection of identity documents.

## 11. Assumptions (to validate)

1. Providers will accept a 10% commission in exchange for confirmed, paid bookings and no listing fees (competitors advertise zero fees but offer no bookings).
2. Customers will pay a small advance online to secure a booking and the rest at pickup (common practice with WhatsApp operators today: advances via bank transfer).
3. A human-verified provider base of 20–40 vehicles in five towns is enough to make search results feel real at launch.
4. Town/area-level search (gazetteer) is sufficient for MVP; hotel-name search can wait.
5. Tourists will book from abroad before arrival as well as on the ground; email is a reliable channel for them, SMS for locals and providers.
6. Request-to-book (not instant) is acceptable to customers if the response window is short and clearly communicated.
7. A registered Sri Lankan company, a business bank account and a PayHere merchant account can be in place before Phase 7.
8. **Tuk-tuks and scooters are a material part of south-coast demand** and should be launch categories alongside cars/SUVs/vans/bikes — _pending decision_, with the caveat that the Department of Motor Traffic has stated it does not issue licences to foreigners for three-wheelers (reported Aug 2025). Options: (a) list tuk-tuks for locals and with-driver only; (b) list for self-drive with prominent licensing warnings and the provider's own permit arrangements; (c) exclude at launch. Recommendation: (a) at launch, revisit after legal advice.
9. English-only UI at launch is acceptable for both tourists and the first providers (Sinhala/Tamil UI in Phase 11; SMS templates may be bilingual earlier).
10. Deposits remain between provider and customer (not held by the platform) in MVP.

## 12. Open product decisions (must be finalised before coding)

Collected in the approval summary; the most consequential are: brand name and domain; launch categories (tuk-tuk/scooter policy); commission percentage; advance model (B vs C); contact-reveal stage; whether unverified providers may publish at all (recommendation: no); cancellation policy numbers; currency display rules; legal entity and PayHere plan timing.
