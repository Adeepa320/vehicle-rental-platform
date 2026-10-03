# Competitor Analysis — Sri Lankan Vehicle Rental Platforms

**Status:** Draft v0.1 (research conducted 2026-10-02 via public web pages, app-store listings and public code; all pages accessed on that date)
**Related:** [PRODUCT_BRIEF.md](PRODUCT_BRIEF.md), [PRD.md](PRD.md)

> **Method and limits.** Every statement is either **[V]** verified from a cited public source or **[I]** an inference from observable evidence. "NF" means _not found in public sources_ — it does not mean the feature does not exist. Several sites are JavaScript-rendered single-page apps whose content is invisible to fetchers (ROFI, RentEase); for RentEase the public JavaScript bundles were read instead. Play Store pages could not be parsed for three platforms; Facebook pages sit behind login walls. Inventory counts are point-in-time snapshots. Nothing below was invented; where a competitor's own pages contradict each other, both statements are reported.

---

## 1. Summary matrix

| Platform             | Live?                                        | Model                                                          | Dates in search | Real availability                  | Map / nearby                                                  | In-platform booking                            | Online payment                                                  | Identity / vehicle verification                                                             | Reviews visible                       | Observed inventory         |
| -------------------- | -------------------------------------------- | -------------------------------------------------------------- | --------------- | ---------------------------------- | ------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------- |
| **Renta.lk (SIRAA)** | Yes                                          | Classifieds, call/WhatsApp owner                               | No              | No                                 | District filter + "Nearby" filter                             | No                                             | No (terms mention PayHere for listing/bump fees)                | Phone-verified owners only                                                                  | No                                    | 6 listings on /explore     |
| **ROFI**             | Yes (apps since Apr 2023)                    | P2P marketplace, request → approve → pay                       | Yes             | Host-set availability              | Location + POI search; map NF                                 | Yes (request)                                  | Yes (gateway unnamed)                                           | Listing review by team; host uploads licence; insurance flag; bundled damage cover          | App store only (6 ratings)            | Unverifiable (JS site)     |
| **LankaRent (.com)** | Pre-launch (draft terms)                     | P2P monthly _subscription_ marketplace                         | Term-based      | Date-driven                        | City search, distance sort; map NF                            | Instant or request                             | Contradictory (says none online; terms describe tokenised card) | Owner docs incl. insurance with rent-a-car loading; renter verification statements conflict | None (no inventory)                   | 0 vehicles                 |
| **DriveLink**        | Yes (policies Aug 2026)                      | P2P "introduction service", request → approve → contact unlock | Yes             | Request-based, 24 h owner response | City pages; map NF                                            | Yes (request)                                  | No (pay provider directly; fee currently Rs 0)                  | Didit KYC (passport/NIC/licence + liveness); "Verified Vehicle" badge on documents          | None observed                         | 0 listings                 |
| **Drivo**            | Placeholder ("app coming soon")              | Driver-services app; rent-a-car is 1 of 5 lines                | NF              | NF                                 | NF                                                            | NF                                             | NF                                                              | Claims driver background checks                                                             | NF                                    | None                       |
| **RentMyCar.lk**     | Yes                                          | Classifieds (ikman-style vertical)                             | No              | No ("contact to check")            | District → city dropdown only                                 | No (call/chat/WhatsApp)                        | No ("arranged directly")                                        | None observed ("verified listings" claimed, no method)                                      | Widget present, none populated        | 24 cars + other categories |
| **RentEase**         | Yes (invisible to search engines)            | P2P listings + WhatsApp lead                                   | NF              | Owner-maintained calendar          | "Near Me" geolocation; map selector; south-coast towns listed | No (structured WhatsApp message / call / chat) | No                                                              | Email verification; "Verified Listing" admin approval; no ID checks                         | Code supports reviews; volume unknown | Unknown (SPA)              |
| **Kuliya**           | App only (100+ installs); kuliya.lk not live | "Rent anything" P2P app                                        | NF              | NF                                 | Mapbox map with clustering, GPS                               | Yes (instant / request)                        | PayHere or bank transfer; claims funds held until handover      | NIC front/back + selfie/video KYC                                                           | None (insufficient ratings)           | Unknown                    |

**Bottom line [I]:** No observed Sri Lankan platform combines, in one product, _date-based search with true availability_ + _online booking with payment_ + _verified providers and vehicles_ + _visible reviews_ + _map/nearby discovery_. ROFI is the closest operating product but hides fees, has negligible review volume and a non-crawlable web presence. The two best-designed trust models (DriveLink, LankaRent) have no inventory and no in-platform payments. The two classifieds (Renta.lk, RentMyCar.lk) have inventory but no booking layer. None serves the south-coast tourist scooter/tuk-tuk segment, which today runs on WhatsApp-first operators and TripAdvisor word of mouth (§10).

---

## 2. Renta.lk (brands itself "SIRAA")

- **Platform / URLs:** https://renta.lk (live). Operator named as "SIRAA (Renta.lk)" in contact and terms; footer credits an individual developer; Gmail contact address. [V: R1, R3, R4]
- **Target users:** Tourists and locals, self-drive or with driver; owners post free; all 25 districts. [V: R1]
- **Main features:** Vehicle-type filter (Car, Van, Bike, Truck, Bus, 3-wheel, Lorry, Trailer, Wedding Hire, Other), district dropdown, with/without-driver toggle, "Nearby Vehicles" filter, SEO city pages, cards with daily rate/year/seats/fuel/photos. [V: R1, R2]
- **Search:** Type + district + driver dropdowns only; no date picker, no price/seat/sort filters, no map. [V: R2]
- **Location:** District-level plus "Nearby Vehicles" (implies browser geolocation [I]); no map pins. [V: R2]
- **Availability:** None; contact to check; no calendar. [V: R5]
- **Booking:** "Call" button and WhatsApp share; owner phone shown on listing. A `/book` nav link exists but no booking function was observed. [V: R5]
- **Payment:** Direct with owner. Terms and refund policy (dated 2026-05-05) state transactions are "processed securely via PayHere", mention listing/bump fees and booking-fee refund tiers (≥48 h full, 24–48 h 50%, <24 h none) — contradicting the FAQ's "no booking fee and no commission". Likely templated for future monetisation [I]. [V: R1, R4, R6]
- **Pricing transparency:** Per-day price on every card (Rs 5,000–40,000 observed); weekly rate on detail pages. No deposit amount, mileage limit, extras or total. [V: R1, R2, R5]
- **Verification / trust:** Owners verify a phone number. No badges, ID checks or insurance info. Terms disclaim liability for vehicle condition/legality. [V: R1, R4, R5]
- **Provider onboarding:** Free: create account, verify phone, post vehicle. [V: R1]
- **Customer onboarding:** No account needed to browse or contact. [V: R1, R5]
- **Reviews:** None. [V: R2, R5]
- **Strengths:** Live inventory with prices; broad taxonomy; zero fees; district SEO pages; very low friction.
- **Observable gaps:** 6 listings at access; no dates/availability/booking/payments; no reviews/verification; owner phone numbers exposed publicly; legal documents inconsistent with the product; single-developer footprint [I].
- **Sources:** [R1] https://renta.lk · [R2] https://renta.lk/explore · [R3] https://renta.lk/contact · [R4] https://renta.lk/terms · [R5] https://renta.lk/explore/2e575256-95bb-4700-bd3c-d83c9c6a476f · [R6] https://renta.lk/refund-policy

## 3. ROFI

- **Platform / URLs:** https://www.rofi.lk (JS-rendered; fetch returns only the title); blog at /blog/; iOS app id6444506551; Android `lk.rofi`; seller "ROFI CAR RENTALS (PRIVATE) LIMITED", Colombo. First release 2023-04-25; latest v1.9.12 on 2026-08-28. [V: O1–O4, O8]
- **Target users:** Tourists ("Travelling around Sri Lanka?") and locals; vehicle owners/hosts ("Your Prius can pay for its own fuel"). [V: O3, O7]
- **Main features:** Self-drive or chauffeur; hourly/daily/weekly/monthly rates; "basic damage and loss cover" and "24/7 roadside assistance" on all trips; host dashboard (bookings, availability, pricing); owner approval of bookings (v1.4.0); Google Sign-In (v1.6.0); point-of-interest search (v1.9.11); QR-code vehicle inspection (third-party article, Jan 2024). [V: O3, O4, O9]
- **Search:** Trip dates, location, vehicle type; filters price, transmission, fuel, colour (own blog, 2025-12-27). Map: NF. [V: O5]
- **Location:** Location and POI search; GPS/map pins NF. [V: O3, O5]
- **Availability:** Hosts set availability; renter requests → "admin verification" → approved. [V: O5, O8]
- **Booking:** Request-based; "no payments are required at this stage"; registration and email verification required. [V: O5]
- **Payment:** Online from the renter dashboard after approval; gateway unnamed; deposit set by host; "security deposit does not apply to rentals with a driver". A competitor's internal document characterises ROFI as a "payment custody" model (third-party claim). [V: O3, O5, O6, D7]
- **Pricing transparency:** Hosts enter per-day price, daily mileage limit, extra-mileage charge and deposit, with hourly/daily/weekly/monthly options — so listings carry these fields. Actual prices not retrievable. [V: O6]
- **Verification / trust:** Email verification; listings reviewed by the team before publishing; host uploads designated driver's licence and flags rental insurance; platform-wide cover and roadside assistance; assists tourists with the recognition permit. Renter ID/licence check: NF. [V: O3, O6, O9]
- **Provider onboarding:** Web/app host portal; team approval. Commission/fees: NF. [V: O6]
- **Customer onboarding:** Account + email verification; licence/permit info at booking. [V: O5, O10]
- **Reviews:** App Store (LK) 4.3/5 from 6 ratings; Play "5K+ downloads" (search summary). In-app reviews NF. [V: O3, O4]
- **Strengths:** Most mature operating marketplace found: apps in both stores for 3+ years with steady releases, bundled cover, structured pricing fields, owner-approval flow, registered company, active SEO blog.
- **Observable gaps:** Tiny rating volume; non-crawlable web app and 2023 sitemap; fees undisclosed; no public FAQ/terms at guessed URLs; inventory unverifiable ("hundreds" is a promotional claim).
- **Sources:** [O1] https://www.rofi.lk · [O2] robots.txt / sitemap.xml · [O3] https://apps.apple.com/lk/app/rofi/id6444506551 · [O4] https://mwm.ai/apps/rofi/6444506551 · [O5] https://www.rofi.lk/blog/rent-a-car-online-in-sri-lanka-how-to-use-rofi/ · [O6] https://www.rofi.lk/blog/step-by-step-guide-to-listing-your-car-on-rofi/ · [O7] https://au.linkedin.com/company/rofi · [O8] https://srilankatravelpages.com/listing/rofi-car-rentals/ · [O9] https://internationaldriversassociation.com/blog/best-car-rental-in-sri-lanka/ · [O10] https://www.rofi.lk/blog/ultimate-guide-to-long-term-car-rentals-in-sri-lanka-save-on-monthly-rates-hassle-free-maintenance/

## 4. LankaRent (lankarent.com)

**Disambiguation:** `lankarent.lk` does not resolve. `lankarent.com` is a distinct, new product. Not to be confused with Lanka Rent A Car Holdings (single operator) or the "Lanka Rent App" by Gimme!Deals (§9).

- **Platform / URLs:** https://lankarent.com (live). "© 2026 LankaRent. Registered in Sri Lanka." Colombo 03. **Pre-launch:** terms are marked "Draft … pending review by Sri Lankan counsel before launch"; privacy policy "pending review against the Personal Data Protection Act". Search returns 0 vehicles. [V: L1, L3, L5, L6, L8]
- **What it is:** P2P vehicle **subscription** marketplace — one monthly price with insurance and servicing included, terms from one month to a year. [V: L1, L5]
- **Target users:** Locals/expats needing a vehicle "for a season"; owners. [V: L1, L5]
- **Main features:** Cars, scooters, motorcycles, tuk-tuks, vans; 10 cities; monthly bundle (comprehensive insurance with rent-a-car loading, servicing, revenue licence, fitness certificate, mileage allowance, roadside recovery); owner console; instant book or request; fault-reporting with billing credits; 8-angle handover photos + odometer signed by both; dispute window; trilingual support hours. [V: L2, L4, L6]
- **Search:** City, vehicle type, monthly budget, transmission, fuel, seats, instant-book, term (1/3/6/12 months and 1/3/7/14 days), self-drive/with driver; sort by distance, price, rating. Map: not observed. [V: L1, L8]
- **Location:** City search and distance sort (implies geolocation [I]); no map pins observed. [V: L1, L8]
- **Availability:** Date/term-driven ("Nothing available for those dates"). [V: L8]
- **Booking:** Instant (owner-enabled) or owner-reviewed request; account required to book. [V: L2, L6]
- **Payment:** Contradictory: homepage/help say "No payment taken online… We never ask for card details"; terms/privacy describe a payment provider holding a card token for monthly charges, deposit "authorised against your card", owner payouts by bank transfer after a clearing window. Provider unnamed. [V: L1, L3–L6]
- **Pricing transparency:** Monthly amount per term, deposit per vehicle shown before booking, mileage allowance and per-km excess on listing; fuel/fines excluded. [V: L1, L2, L4]
- **Verification / trust:** Owners: identity + ownership (CR), insurance with rent-a-car loading, revenue licence, fitness certificate; listings auto-withdraw when insurance lapses. Renters: NIC + licence (visitors: passport, temporary permit, IDP) "reviewed within hours" — but help also says renters are _not_ identity-verified by the platform. [V: L2, L4, L6]
- **Provider onboarding:** Free listing wizard, 8 required photos; commission "a percentage of each monthly cycle… during the launch window set to zero". [V: L4]
- **Customer onboarding:** Name, email, password (≥10 chars); mobile before first booking. [V: L7]
- **Reviews:** Rating sort exists; none observed. [V: L8]
- **Strengths:** Clear differentiation (subscription); unusually complete documentation; insurance-loading enforcement; bundled pricing.
- **Observable gaps:** Zero inventory; not legally launched; inconsistent payment/verification statements; no app; no named team; no third-party coverage.
- **Sources:** [L1] https://lankarent.com · [L2] /how-it-works · [L3] /legal/terms · [L4] /owner/guide · [L5] /about · [L6] /help · [L7] /register · [L8] /search

## 5. DriveLink (drivelink.lk)

- **Platform / URLs:** https://drivelink.lk (live); "since 2026"; terms updated 2026-08-31. Public repository `github.com/ninjalegendz/drivelink-sl` (Next.js/TypeScript, Capacitor Android, Supabase, Cloudflare Workers; 157 commits) appears to be the same product [I: same name and stack as named in the privacy policy]. [V: D1–D3, D6, D7]
- **What it is:** P2P marketplace / "an introduction service"; does not own vehicles, employ drivers or inspect vehicles. [V: D2]
- **Target users:** Primarily tourists (IDP guidance, airport handover at CMB, south-coast pages) plus locals; providers via "Rental Pages". [V: D1, D5]
- **Main features:** Cars, SUVs, vans, bikes, scooters, tuk-tuks; self-drive / with driver / airport handover; "Verified Vehicle" badge; condition "recorded both ways"; insurance labels "Hire-insured" vs "Private (P-Number)"; booking chat; renter "reliability score"; guides; requests auto-close if owner silent for 24 h. [V: D1, D2, D5]
- **Search:** Location ("Anywhere"), dates, vehicle type, rental mode, airport-handover checkbox, hire-insurance filter, price range, sort. Map: not confirmed. [V: D4]
- **Location:** City filters and SEO city pages (incl. Mirissa). GPS/map pins NF. [V: D1]
- **Availability:** Date-based request; owner must respond within 24 h. [V: D2, D5]
- **Booking:** Request → owner approves → contact details unlock → arrange directly; free cancellation before confirmation. [V: D1, D5, D6]
- **Payment:** None in platform: "You pay the provider directly, typically in cash or by bank transfer on the day of pickup"; deposit handed to provider; confirmation fee "currently Rs 0". [V: D5, D6, D8]
- **Pricing transparency:** Listings designed to show daily rate, deposit, mileage allowance, insurance label, licence requirement — but **0 listings** at access. [V: D4, D9]
- **Verification / trust:** ID verification via Didit (passport/NIC/licence + liveness) before use; owners verified before listing; Verified Vehicle after review of registration, hire insurance, revenue licence; original licence checked at handover; 18+; SMS via text.lk, email via Resend. [V: D2, D3, D5]
- **Provider onboarding:** "Listing is free forever" — no listing, monthly or commission fees; signup via mobile OTP. Internal doc debates future success fees. [V: D7, D8, D10]
- **Customer onboarding:** Passwordless OTP; optional verified email badge; Didit ID check before first request. [V: D5, D10]
- **Reviews:** Cards reserve "guest ratings"; public reviews only for Rental Pages from completed bookings; renter reliability private. None observed. [V: D4, D7]
- **Strengths:** Strongest trust design on paper (KYC, document-based badge, honest insurance labelling, two-way condition records); clean legal docs; tourist-specific guidance; airport-handover filter.
- **Observable gaps:** No inventory; weeks old; no store app found; no in-platform payments or escrow; map unconfirmed; single-developer footprint [I]; monetisation undecided.
- **Sources:** [D1] https://drivelink.lk · [D2] /terms · [D3] /privacy · [D4] /vehicles · [D5] /faq · [D6] /refunds · [D7] https://github.com/ninjalegendz/drivelink-sl (incl. DRIVELINK_RENTAL_101.md) · [D8] /pricing · [D9] /sri-lanka/self-drive-car-rental-sri-lanka · [D10] /signup?intent=provider

## 6. Drivo (drivo.lk)

- **Platform / URLs:** https://drivo.lk (live; landing, privacy, terms dated 2026-01-09 only). "App is coming soon"; store buttons have no URLs. No app-store listing found (Play Store "Drivo" apps are unrelated Saudi/African products). [V]
- **What it is:** Pre-launch, app-first driver-services platform; five lines (Drink & Drive, Rent a Car, Long-term Driver, Spare Parts, Package Delivery). Rent-a-car is one of five, not the core [I]. [V]
- **Target users:** Individuals, corporates, drivers; no tourist messaging. [V]
- **Search / location / availability / booking / pricing / reviews:** NF. Terms describe ride-hailing-style mechanics (demand-based pricing, cancellation by service type); no rental provisions (deposit, damage, mileage). [V]
- **Payment:** Collects "payment information"; no gateway named. [V]
- **Verification:** Claims driver background checks; no method. [V]
- **Provider onboarding:** "Become a Driver" CTA only; no third-party vehicle listing mentioned. [V]
- **Strengths:** Broad concept; recent legal docs; phone contact.
- **Observable gaps:** No app, inventory, legal entity name or social presence. Effectively a placeholder; not a rental competitor today [I].
- **Sources:** https://drivo.lk · https://drivo.lk/terms-of-use/ · https://drivo.lk/privacy-policy/

## 7. RentMyCar.lk

- **Platform / URLs:** https://rentmycar.lk (live). "Sri Lanka's #1 Car Rental Marketplace" (self-claim); developed by an agency; platform "facilitates connections only". [V]
- **Target users:** Local owners/rental companies and local renters (LKR, district taxonomy). A 2026 guide addresses non-residents but there is no tourist flow. [V]
- **Main features:** Categories Cars (24 at access: 22 self-drive, 2 with driver), SUVs, Vans, Buses, Lorries, Three Wheelers, Bikes, Cycles; district → city dropdown; favourites; report abuse; blog; social links. [V]
- **Search:** Location, category, type, price range; sorts (A–Z, recent, most viewed, price); list/grid. **No date input, no map.** [V]
- **Location:** Dropdown only; no nearby/GPS; no map on listing. [V]
- **Availability:** None; "contact to check". [V]
- **Booking:** Contact owner directly: masked phone until click, in-site chat (login), WhatsApp share. [V]
- **Payment:** "Arranged directly between renter and owner"; safety tip "Pay only after collecting the vehicle". [V]
- **Pricing transparency:** Per day/week/month on cards (e.g. Vitz Rs 7,000/day; Wagon R Rs 5,000/day; Swift Rs 100,000/month; with-driver "Rs 250 per km"). Deposit/mileage only if the owner adds them (sample: deposit Rs 30,000, 100 km/day, Rs 50/extra km). No fuel policy, insurance or total. [V]
- **Verification / trust:** "Verified listings" claimed without method; no badges, member-since or ratings on sampled listings; insurance "depends on the owner". [V]
- **Provider onboarding:** Anyone with an account; basic listings free; paid boosts (prices not public); no commission. [V]
- **Customer onboarding:** Browse without account; chat requires login; no document checks. [V]
- **Reviews:** Widget present, none populated. [V]
- **Strengths:** Live inventory with real LKR prices; nationwide taxonomy incl. three-wheelers/bikes; zero fees; SEO content; real support contacts.
- **Observable gaps:** Small inventory, Colombo/Gampaha-centred (south-coast depth unverified); no calendar/availability; no online payment/deposit handling; no identity verification; no visible reviews; no map/GPS; no app. Functionally an ikman-style classifieds vertical [I].
- **Sources:** https://rentmycar.lk/ · /faq · /about-us/ · /contact/ · /listing-category/rent-a-car-in-sri-lanka/ · /listing/rent-a-car-toyota-vitz-2/ · /post-an-ad/ · /how-to-rent-a-car-in-sri-lanka-complete-2026-guide/

## 8. RentEase (rentease.lk)

_Method note:_ client-rendered React/Vite SPA; everything marked **[code]** was read from the public HTML meta/JSON-LD and JavaScript bundles. Listing volume could not be observed.

- **Platform / URLs:** https://rentease.lk (live). Meta: "Sri Lanka's premier vehicle rental platform… from trusted owners across the island." No search-engine presence; no store app (PWA). Firebase backend; AdSense and Meta Pixel present. [V, code]
- **Target users:** Local owners (free listing) and renters; event/wedding hire ("per_event"). No tourist flow. [V, code]
- **Main features [code]:** Categories Cars, SUVs, Bikes, Vans, Mini Vans, Three Wheels, Trucks, Other; fuel/transmission/seats/driver option; pricing per_day / per_trip / per_event; favourites; in-app chat; **owner availability calendar**; reviews; renter profiles; paid promotions; admin console; help centre with video tutorials.
- **Search:** Text search, category pages, brand/model; province → district → city list. Date input not observed. [V, code]
- **Location:** "Vehicles Near Me" via device geolocation; map selector; Google Maps links; southern list includes Galle, Unawatuna, Hikkaduwa, Ahangama, Matara, Weligama, Mirissa, Dikwella, Tangalle. [V, code]
- **Availability:** Owner-maintained calendar with `unavailable`/`pending` states rendered on the vehicle page; not transactional. [V, code]
- **Booking:** None in platform; vehicle page composes a structured WhatsApp inquiry (vehicle, dates, with-driver, expected price, name, phone) to the owner; call fallback; in-app chat. [V, code]
- **Payment:** None (no PayHere/bank/deposit references in code). [V, code]
- **Pricing transparency:** LKR per day; self-drive vs with-driver prices; per trip/event. No deposit, mileage or extras fields found. [V, code]
- **Verification / trust:** Email verification (or Google/phone auth) to list/chat; "Verified Listing — Approved by RentEase" badge implies admin approval; no ID/licence checks found. [V, code]
- **Provider onboarding:** Free; paid promotions from LKR 1,500/7 days to LKR 35,000/30 days; no commission. [V, code]
- **Customer onboarding:** Account (name, email, phone, password; Google or phone OTP); no documents. [V, code]
- **Reviews:** 1–5 star + comment with totals in code; volume unknown. [V, code]
- **Strengths:** Most complete product design among the listing sites: calendar, near-me, three-wheels/bikes, south-coast towns, structured WhatsApp lead, moderation, reviews, monetised promotions.
- **Observable gaps:** Invisible to Google (empty SSR shell); inventory unknown; no payments or deposits; no ID verification; Gmail contact and ads suggest early stage [I]; WhatsApp hand-off leaves no booking record or dispute trail [I].
- **Sources:** https://rentease.lk/ (HTML meta + JSON-LD) · /assets/index-DM3qCiT3.js · /assets/constants-CXI6vH59.js · /assets/sriLankaLocations-C33osAV2.js · /assets/VehicleDetail-Ck2REVEf.js · /assets/pricing-QUYDZZ3m.js · /assets/Help-DgDSPxgk.js

## 9. Kuliya ("Kuliya – Rent Anything in LK")

_Identification:_ among many unrelated "kuliya" results, the rental app is by Abey Labs (solo developer based in Kekanadura, Matara). [V]

- **Platform / URLs:** `kuliya.lk` is **not live** (resolves to localhost). App Store id6762573225; Google Play `com.chamodabey.kuliya`; privacy policy on GitHub Pages (effective 2026-04-24). [V]
- **What it is:** General P2P "rent anything" app — vehicles, property, event gear, cameras, tools. Not vehicle-specific. [V]
- **Target users:** Locals (English/Sinhala, NIC KYC, PayHere); no tourist orientation; NIC KYC would exclude most foreigners [I]. [V]
- **Main features (store copy):** KYC-verified users; in-app chat without sharing phone numbers; location-based search on an interactive map with clustering; daily/monthly prices; push alerts for booking requests; phone-OTP/Google login; "book instantly, and pay securely". [V]
- **Search / location:** Category browsing + Mapbox map with clustering, GPS. Date input NF. [V]
- **Availability:** NF.
- **Booking:** In-app (instant and/or request) plus chat. [V]
- **Payment:** PayHere or bank transfer; claims funds "held securely until handover is complete". [V]
- **Pricing transparency:** Owner-set daily/monthly; deposit/mileage NF.
- **Verification / trust:** NIC front/back + selfie/verification video; 24-hour moderation commitment. [V]
- **Provider onboarding:** Any KYC-verified user; fees NF.
- **Reviews:** None on either store; Play "100+ downloads", updated 2026-09-16, v3.0.1. [V]
- **Strengths:** Only one of the eight with integrated payment, KYC, map search and in-app booking in one app; bilingual; developer based on the south coast.
- **Observable gaps:** Negligible traction; no website; horizontal catalogue dilutes vehicles; locals-only KYC and LKR; fees undisclosed; solo-developer capacity [I].
- **Sources:** https://apps.apple.com/lk/app/kuliya-rent-anything-in-lk/id6762573225 · https://play.google.com/store/apps/details?id=com.chamodabey.kuliya · https://chamodla.github.io/kuliya-privacy/ · https://www.abeylabs.dev · DNS/HTTP check of kuliya.lk

## 10. Other players observed

| Player                                                                                        | What it is                                                                                                                                                           | Source                                                                                                      |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Wayz.lk                                                                                       | P2P-style app (Livezen Technologies), iOS release 2025-08-19; cars/vans/scooters; 0 ratings                                                                          | https://mwm.ai/apps/wayzlk/6751182698                                                                       |
| Lanka Rent App (lanka.rent)                                                                   | iOS app by Gimme!Deals: bikes, villas, cars; chat with owners; v1.0 2023-08-31; website unreachable                                                                  | https://apps.apple.com/us/app/id6463483259                                                                  |
| ikman.lk → Vehicles › Rentals                                                                 | Classifieds with per-day price, "Allowed km", MEMBER badge, call/chat/WhatsApp; 9,141+ ads nationally, car-heavy and dealer-driven; Galle district 41+ ads, Matara 6 | https://ikman.lk/en/ads/sri-lanka/rentals · /galle/rentals · /matara/rentals                                |
| Uber Rentals / Tuk Rentals                                                                    | Hourly chauffeured packages (from LKR 499/h)                                                                                                                         | https://www.uber.com/en-LK/newsroom/uber-launches-uber-rentals-for-multi-hour-multi-stop-needs-in-sri-lanka |
| PickMe                                                                                        | Ride-hailing; chauffeured "VIP"; no self-drive product found                                                                                                         | https://dailymirror.lk/print/business-news/PickMe-brings-luxury-to-fingertips-with-PickMe-VIP/273-134807    |
| Casons, Malkey, Lanka Rent A Car Holdings, SR Rent A Car, DriveLK (tuk-tuks), iWay and others | Single-operator rental companies with their own sites; some bookable via international aggregators (EconomyBookings)                                                 | various                                                                                                     |
| tuktukrental.com, scooterrentallanka.com, holidaytuktuk.com                                   | International-facing tuk-tuk/scooter operators booked pre-arrival via web form or WhatsApp; delivery across the south coast                                          | see §11                                                                                                     |
| BikesBooking, Riderly                                                                         | International two-wheeler aggregators with online booking and calendars for Galle/Weligama                                                                           | see §11                                                                                                     |

## 11. South-coast rental discovery today (Mirissa, Weligama, Unawatuna, Galle, Matara)

**How tourists find rentals [V]:**

- Pre-arrival via international-facing operators (tuktukrental.com with 38+ delivery points incl. Mirissa/Weligama/airport; scooterrentallanka.com where every "Book Now" is a WhatsApp link; holidaytuktuk.com).
- Aggregators with calendars (BikesBooking Galle page; Riderly).
- Local shops via hostels/guesthouses and TripAdvisor listings, then WhatsApp/Viber/walk-in (e.g. "TUK TUK RENTAL in MIRISSA"; Sumith Renters Weligama with 12 five-star reviews from 2018–19; HV Scooter Rental Mirissa with 1 review; Chanuka Scooter Rental Weligama with 0).
- ikman.lk is car-heavy and dealer-driven; few scooter/tuk ads visible in the south.
- Facebook pages exist but sit behind login walls; tourist groups could not be verified.

**Typical prices seen [V]:** scooters 110–125 cc LKR 1,500–1,800/day low season, 2,200–3,000 high season (BikesBooking), USD 8–15/day (operators); motorbikes USD 15–30/day; self-drive tuk-tuks USD 16–26/day (lower on 23+ day terms), LKR 3,500/day (Mirissa listing); cars USD 50–60/day with 100 km limit, ikman Galle Rs 4,300–12,500/day. Deposits USD 50–300 depending on vehicle — or the passport itself.

**Pain points travellers mention [V]:**

- Licensing complexity: IDP plus a local permit (AAC "covering permit" or the new DMT airport permit, USD 50, from Aug 2025); tuk-tuk licences historically only at DMT Werahera.
- Passports held as deposits; aggregators advise photocopies and card holds instead.
- Reliability: a Mirissa operator "rented it to other people despite he confirmed it to me 2 days ago" (1-star TripAdvisor review).
- Informal, uninsured supply ("legal and competitive are not possible due to the high number of illegal operators"); shops rarely check licences, followed by police stops and informal "fines".
- Opaque, seasonal pricing and no reviews for most small shops; recurring safety warnings on forums.

**Sources:** https://tuktukrental.com/sri-lanka/mirissa/ · https://tuktukrental.com/motorbike-rental-sri-lanka/ · https://abrotherabroad.com/tuk-tuk-rental-sri-lanka-review-price/ · https://bikesbooking.com/en/scooter-and-motorcycle-rental-in-galle-sri-lanka/ · https://scooterrentallanka.com/ · https://holidaytuktuk.com/scooter-rental-mirissa-unlock-your-southern-sri-lanka-adventure/ · https://www.jjshostelmirissa.com/travel-info/renting-a-vehicle/ · TripAdvisor: Attraction_Review-g1407334-d19492955 (TUK TUK RENTAL in MIRISSA), ShowTopic-g293961-i8983-k15366770, ShowTopic-g293961-i8983-k10669055, ShowTopic-g644047-i11143-k7253604, ShowUserReviews-g612380-d13945292-r720623600 (Sumith Renters), Attraction_Review-g1407334-d32999672 (HV Scooter Rental), Attraction_Review-g612380-d24848989 (Chanuka) · https://ikman.lk/en/ads/galle/rentals · https://ikman.lk/en/ads/matara/rentals · https://theblogofdimi.com/renting-driving-scooter-sri-lanka-without-drivers-license/ · https://www.facebook.com/bikerentalweligama/ (login wall)

---

## 12. Gap analysis and implications for our product

| Gap observed in the market                                                                                               | Evidence                            | Our response (see PRD / MVP_SCOPE)                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Nobody searches by **dates with true availability** except ROFI (unverifiable) and the pre-launch sites                  | §1 matrix                           | Dates are mandatory in search; availability enforced in the database (DATABASE_DESIGN §7)                                                            |
| **No booking record + no payment** on the live listing sites; WhatsApp hand-off is the norm                              | Renta.lk, RentMyCar.lk, RentEase    | Request-to-book with acceptance, online advance and a full audit trail; WhatsApp used only post-confirmation                                         |
| **Double-booking / unreliable confirmations** are a real traveller complaint                                             | TripAdvisor Mirissa review          | Exclusion-constraint holds; provider acceptance-rate and cancellation metrics surfaced                                                               |
| **Pricing opacity**: deposit, mileage, extras rarely shown; totals never                                                 | Renta.lk, RentMyCar.lk, forum posts | Mandatory deposit, included-km, extra-km, driver and delivery fields; period total and pay-now/pay-later split shown before booking                  |
| **Trust**: "verified" claimed without method; owner phone numbers public; no reviews                                     | Renta.lk, RentMyCar.lk, RentEase    | Document-based provider and vehicle verification with visible badges; contact revealed only after confirmation; reviews only from completed bookings |
| **Tourist segment unserved**: NIC-only KYC, LKR-only, no IDP/permit guidance, no scooter/tuk focus on the live platforms | Kuliya, RentMyCar.lk, §11           | Passport + IDP fields, licence guidance, indicative foreign-currency display, scooter and tuk-tuk categories seeded (decision pending)               |
| **South coast is thin** on ikman and classifieds (Matara: 6 ads)                                                         | §10                                 | Concentrated supply acquisition in 5 launch towns before expanding                                                                                   |
| **Discoverability**: two competitors are invisible to search engines                                                     | ROFI, RentEase                      | Server-rendered, crawlable town/category landing pages                                                                                               |
| **Fees**: everyone advertises "free"; monetisation undecided or hidden                                                   | Renta.lk, DriveLink, ROFI           | Transparent commission policy published from day one (PRODUCT_BRIEF business model)                                                                  |

What we should _not_ claim: that we are first with online booking (ROFI, Kuliya), first with KYC (DriveLink, Kuliya), or first with calendars (RentEase, ROFI). Our differentiation is the **combination** delivered reliably in a focused geography, with a trust model that works for foreign tourists as well as locals.
