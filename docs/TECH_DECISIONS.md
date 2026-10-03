# Technical Decision Records

**Status:** Draft v0.1 for review (2026-10-02). Each record: context → options → decision → consequences → revisit trigger. Facts about third-party pricing/features come from the research summarised in COMPETITOR_ANALYSIS.md and the appendices referenced below (all checked 2026-10-02; prices change — re-verify before contracts).

| ID  | Decision                                                                                                    |
| --- | ----------------------------------------------------------------------------------------------------------- |
| D1  | PostgreSQL (not MongoDB)                                                                                    |
| D2  | PostGIS for geographic search                                                                               |
| D3  | Separate NestJS API + Next.js web (not Next.js full-stack)                                                  |
| D4  | NestJS (TypeScript) rather than Go or Hono                                                                  |
| D5  | Drizzle ORM rather than Prisma                                                                              |
| D6  | MapLibre + curated gazetteer rather than Google Maps Platform (MVP)                                         |
| D7  | Cloudflare R2 rather than Cloudinary or AWS S3                                                              |
| D8  | PayHere, and the "advance = commission" MVP payment model                                                   |
| D9  | Modular monolith, not microservices; pg-boss, not Redis/BullMQ                                              |
| D10 | Hosting: Railway + Neon + Cloudflare (not Vercel/VPS by default)                                            |
| D11 | Custom auth in the API (not Auth.js/Clerk/Supabase Auth/Firebase)                                           |
| D12 | Request-to-book with calendar hold on acceptance (not instant book, not hold on request)                    |
| D13 | Notifications: email + local SMS + wa.me links (no WhatsApp API, no chat)                                   |
| D14 | Exclusion constraint on `vehicle_holds` for double-booking prevention                                       |
| D15 | Monorepo with shared Zod contracts                                                                          |
| D16 | TypeScript 6.0 (not 7) with NodeNext module resolution; CommonJS output for Nest and internal packages      |
| D17 | ESLint 9 (not 10) until Next's lint plugins support ESLint 10                                               |
| D18 | Per-route Zod validation pipe now; OpenAPI-from-Zod deferred to Phase 2                                     |
| D19 | pg-boss started only in the worker process; loaded via `require(esm)`                                       |
| D20 | Phase 1 local-only infrastructure (no paid services, no Mailpit/MinIO yet)                                  |
| D21 | shadcn/ui v4 default preset (Base UI) and self-hosted Geist font                                            |
| D22 | drizzle-kit PostGIS quoting workaround and migration advisory lock                                          |
| D23 | Lean Phase 2 scope: defer SMS OTP, identity documents, uploads and the notification feed                    |
| D24 | pg-boss transactional enqueue is the outbox (no separate domain_events table)                               |
| D25 | E-mail link tokens (one_time_tokens) instead of OTP codes for verification and reset                        |
| D26 | jose EdDSA access tokens with ephemeral development keys; per-request user load for revocation              |
| D27 | Refresh cookie design and CSRF strategy (SameSite=Lax + Origin guard)                                       |
| D28 | OpenAPI via @nestjs/swagger fed by Zod JSON Schema export (resolves D18)                                    |
| D29 | SMTP adapter + Mailpit for e-mail; nodemailer, argon2, cookie-parser added                                  |
| D30 | Lean Phase 3: reviewed application, manual/offline verification, no SMS, no documents, no storage           |
| D31 | Application record separate from profile; arrays on the application, relation tables on the profile         |
| D32 | Status-conditioned transitions; `rejected` terminal; approval re-validates inside the transaction           |
| D33 | Suspension is a profile status; `provider` role retained; `ActiveProviderGuard`                             |
| D34 | `audit_events` generalises `admin_audit_logs`                                                               |
| D35 | Admin bootstrap via CLI (`pnpm admin:grant`); admin MFA deferred to production hardening                    |
| D36 | Public reference endpoints, keyset pagination helper, `PATCH /providers/me`, `tsx` for CLI scripts          |
| D37 | Lean Phase 4: no paid map API, no photos/storage yet, no search/booking; basic LKR pricing as numeric(12,2) |
| D38 | One `vehicle_status` enum for review and listing lifecycle; identity fields locked after approval           |
| D39 | Category-aware specification rules in the contracts (no per-category tables, no JSON blob); plate handling  |
| D40 | Availability on `vehicle_holds` now (blocks only); expression-based exclusion constraint; overlaps refused  |
| D41 | `provider_locations`: district + place required, optional pin, one primary, deactivate-not-delete           |

---

## D1 — PostgreSQL vs MongoDB

**Context.** Core data is relational and transactional: users ↔ providers ↔ vehicles ↔ bookings ↔ payments, with hard integrity rules (no overlapping bookings, immutable price snapshots, ledgers).
**Options.** PostgreSQL; MongoDB; MySQL/MariaDB.
**Decision.** PostgreSQL 17.
**Why.** Range types + exclusion constraints solve double booking declaratively (D14); PostGIS (D2) is best-in-class and free; strong JSON support covers the few document-shaped fields (price breakdowns, webhook payloads); mature managed offerings with PostGIS in Singapore/Mumbai (Neon, Supabase, DigitalOcean, RDS). MongoDB's geo indexes are adequate but it has no equivalent of exclusion constraints and multi-document transactions are heavier; MySQL lacks range/exclusion constraints and its spatial support is weaker.
**Consequences.** Team must be comfortable with SQL migrations and a few PostGIS functions. Revisit: never for this product class.

## D2 — PostGIS for geographic search

**Context.** Requirements: nearby search by radius, map bounding-box search, distance display, provider pins, future delivery-radius checks, future island-wide scale (tens of thousands of listings at most).
**Options.** (a) PostGIS `geography` + GiST; (b) plain lat/lng columns with a Haversine expression; (c) Elasticsearch/OpenSearch geo queries; (d) a hosted search service (Algolia/Typesense) with geo.
**Decision.** (a) PostGIS.
**Why.** The availability filter (no overlapping hold in [S,E)) and price/attribute filters must be applied in the same query as the geo filter; keeping it in one SQL statement with two GiST indexes is simpler and strictly consistent. (b) cannot use an index for `distance < r` without bounding-box tricks and gets ugly for bbox/polygon queries. (c)/(d) add infrastructure, cost and a sync pipeline, and would still need Postgres for availability truth. PostGIS is available on every managed Postgres we considered (Neon 3.5.x on PG17; Supabase preinstalled; DO; RDS).
**Consequences.** Spatial SQL in repositories (typed `sql` fragments); GiST index maintenance is automatic. Revisit if we need full-text relevance ranking across descriptions at scale — then add a search index as a read model, keeping Postgres authoritative.

## D3 — Separate API vs Next.js full-stack

**Context.** Brief asks for clean API contracts for a future mobile app and clear module boundaries, with a small team and low ops cost.
**Options.** (a) Next.js route handlers/server actions as the only backend; (b) separate backend API + Next.js as a client; (c) BFF pattern (Next.js proxies a backend).
**Decision.** (b): NestJS API is the system of record; Next.js is a client that also renders public pages server-side. No business logic in Next.js.
**Why.** A mobile app would otherwise either call Next route handlers (awkward auth/cookie model, no OpenAPI, weak validation story) or force a rewrite. Background jobs, webhooks, scheduled expiries and long-running image processing fit a long-lived Node process better than serverless route handlers. Module boundaries are enforceable with Nest's module system and lint rules; in a Next-only codebase they rely on discipline alone. The cost is one extra container (≈ USD 5–10/month) and a shared contracts package — cheap relative to the clarity gained.
**Consequences.** Two deployables; server components fetch the API over the internal network; auth cookie handling must be designed for cross-origin (same site, `api.` subdomain). Revisit: if the team shrinks to one person and mobile is cancelled, a Next-only consolidation is possible because contracts are shared.

## D4 — NestJS vs Go vs Hono/Express

**Options.** NestJS (TypeScript); Go (chi/echo + sqlc); Hono/Fastify minimal TypeScript.
**Decision.** NestJS 11.
**Why.** One language across web, API, worker and contracts lets a 2–3 person team move between layers; Zod schemas are shared (D15). Nest provides modules, DI, guards (RBAC), pipes (validation), OpenAPI, scheduling and testing utilities out of the box — exactly the structure a modular monolith needs. Go is faster and leaner at runtime but splits the team's skills and duplicates validation/types; our bottleneck is product iteration, not CPU. Hono/Fastify are lighter but we would re-create module structure and conventions by hand.
**Consequences.** Decorator-heavy style; slightly larger cold start (irrelevant on a long-lived container). Revisit: a CPU-bound component (e.g. routing engine) can be a separate Go/OSRM service later.

## D5 — Drizzle ORM vs Prisma

**Options.** Prisma; Drizzle; Kysely; raw SQL with `postgres.js`.
**Decision.** Drizzle ORM + `drizzle-kit` migrations (SQL files committed).
**Why.** PostGIS and exclusion constraints are first-class only through SQL; Drizzle's `sql` template and SQL-shaped query builder make spatial queries and transactions natural, and its schema can declare `geometry`/custom types while migrations stay plain SQL that we can hand-edit. Prisma treats PostGIS columns as `Unsupported`, requires raw queries for every spatial read, and its migration engine fights hand-written constraints. Kysely is excellent but has no schema-to-migration tooling; raw SQL everywhere loses type inference.
**Consequences.** Less "magic" than Prisma; developers write explicit joins. Revisit: none expected.

## D6 — Maps: MapLibre + gazetteer vs Google Maps Platform

**Context (verified 2026-10-02).** Google's post-March-2025 pricing: Dynamic Maps 10,000 free loads/month then USD 7/1,000; Autocomplete Requests 10,000 free then USD 2.83/1,000; Geocoding 10,000 free then USD 5/1,000. Google Maps Platform Service Specific Terms §3.3/§5.3: Geocoding and Places content "must not be used in conjunction with a non-Google map"; lat/lng from these APIs may be cached ≤30 days. Alternatives: MapLibre GL JS (open source) with OpenFreeMap (free, no key, no SLA), MapTiler Flex (USD 30/month, 25k sessions), Stadia Starter (USD 20/month); Geoapify (3,000 credits/day free, commercial OK); Photon/Nominatim (OSM; Nominatim forbids autocomplete).
**Options.** (a) All-Google; (b) MapLibre + open tiles + own gazetteer, no geocoding API; (c) MapLibre + Geoapify/Photon autocomplete; (d) Mapbox.
**Decision.** (b) for MVP, with (c) as the first upgrade and (a) as a documented alternative.
**Why.** MVP search is town/area-level in a five-town region; a seeded `places` table gives instant, offline, zero-cost suggestions in English/Sinhala/Tamil with aliases we control ("Mirissa Beach", "Weligama Bay"). Provider locations are set by pin, not geocoded. Distance is PostGIS. So the only paid-API need (map loads) is covered by MapLibre with free tiles, removing both a billing risk (a leaked key or a crawler can burn Google quota) and the ToS lock-in. Google remains the best option if tourists need hotel-name search; at that point we choose either Geoapify/Photon (keeps MapLibre) or move wholesale to Google (Maps JS + Places with session tokens), each costing ≈ USD 0–70/month at MVP volumes.
**Consequences.** OpenFreeMap has no SLA: ship the style/tiles URL as configuration and keep a MapTiler key ready for failover; donate to OpenFreeMap. OSM coverage of small guesthouses is weak — irrelevant for MVP because we do not geocode. Revisit triggers: zero-result searches with free-text that the gazetteer cannot resolve; provider complaints about pin placement; need for road distance/ETA (then self-host OSRM on the 137 MB Sri Lanka extract).

## D7 — Object storage: Cloudflare R2 vs Cloudinary vs S3

**Context.** Vehicle photos (public, image-heavy pages) and identity/vehicle documents (private, sensitive). R2: 10 GB free, zero egress, S3 API, USD 0.015/GB-month after. Cloudinary: 25 free credits/month (≈ 25 GB storage _or_ bandwidth _or_ 25k transformations combined), Plus USD 99/month. S3 Mumbai/Singapore ≈ USD 0.025/GB-month + ≈ USD 0.11–0.12/GB egress.
**Decision.** R2 with two buckets; image variants generated once at upload by the worker (sharp); public bucket behind a Cloudflare custom domain; private bucket via short-lived presigned URLs.
**Why.** Egress is the dominant cost for photo galleries; R2's zero egress and Colombo PoP make it both cheapest and fastest for Sri Lankan users. Cloudinary's transformation convenience is real, but its credit model becomes expensive with many listings and it is a second vendor for sensitive documents. The S3 API keeps us portable (MinIO locally, any S3 later).
**Consequences.** We own image processing (one worker job, ~50 lines with sharp). Revisit if we need on-the-fly transformations at many sizes — Cloudflare Images (5,000 free transformations/month, USD 0.50/1,000) can front R2 without changing storage.

## D8 — Payments: PayHere and the MVP money model

**Context (verified 2026-10-02).** PayHere: hosted Checkout (form POST + MD5 hash; `notify_url` webhook with `md5sig`; status codes 2/0/-1/-2/-3; sandbox), Authorize/Capture (hold ≤7 days, Visa/Mastercard **credit** cards only, Plus/Premium plans), Preapproval/Charging (tokenised, Premium), Refund API (full/partial ambiguity in docs; wallets/bank methods not refundable via PayHere), Retrieval API; **no split or third-party payouts**; plans Lite 3.30% (≤ LKR 50k/payment, ≤ LKR 200k/month), Plus LKR 3,990/month 2.99% (≤250k/payment, ≤3m/month), Premium LKR 9,990/month 2.69%; T+2 settlement; onboarding 1–3 days, home-based/freelance accounts allowed. Alternatives: Genie Business (Dialog Finance, 2.75% Visa/MC, LKR 400/month + 4,500 setup, no per-transaction limits; sandbox by request), OnePay (JSON REST, partial refunds, no split payouts), DirectPay (2.6–3.5%, registered businesses only), WebXPay. Stripe does not support Sri Lanka; PayPal receiving only since May 2026 and cross-border oriented. CBSL: transactions between residents must be in LKR; payment-system operation requires CBSL authorisation; new Money or Value Transfer Service regulations (effective 31 Dec 2025) — whether a marketplace remitting owners' money is in scope **needs legal verification**.
**Options for money flow.**

- **A. Full online payment, platform pays out providers** (Booking.com "pay now"): best customer experience; requires settlement runs (manual CEFTS transfers at first), gateway fees on 100% of GMV, refund handling for wallets, and raises the MVTS/payment-system licensing question.
- **B. Advance online = platform commission; balance + deposit to provider at pickup** (recommended): platform collects only its own fee; provider is paid directly by the customer; no payouts; the booking is still "confirmed by payment".
- **C. Advance online > commission (e.g. 20–30%), remainder at pickup**: gives providers upfront money but reintroduces payouts for the excess, so it inherits A's complexity at smaller scale.
- **D. No online payment (DriveLink model)**: lowest friction but no commitment signal, no revenue mechanism, weak no-show protection — contradicts the product thesis.
  **Decision.** PayHere Checkout for the advance; model **B** in MVP with `advance_percentage = commission_rate` (default 10%, configurable); ledger/settlement tables present but dormant; gateway behind an interface. Plan for PayHere **Plus** within the first months because Lite's LKR 200k/month cap is reached at ≈ LKR 2m GMV.
  **Why.** B delivers the core promise (real confirmation backed by money) with the least regulatory and operational surface, keeps gateway fees to ≈ 3% of 10% of GMV, and avoids refunds of large sums. Deposits stay in person because PayHere holds last 7 days and exclude debit cards — unusable for most rentals and most Sri Lankan customers. PayHere over Genie for MVP because of the documented sandbox, hash scheme and community examples; Genie's lower rate (2.75%) is a Phase 11 cost optimisation once volume exists. Over DirectPay because PayHere accepts non-BR accounts during the company-formation period (still, a registered entity is recommended before launch).
  **Consequences.** Customers pay in two steps (small online, rest at pickup) — the UI must explain this clearly. Providers must accept the balance themselves (cash/card/transfer). Refunds of the advance (cancellations ≥48 h, provider cancellations) are manual in MVP: card → PayHere portal; wallets → bank transfer with customer bank details collected in the refund flow. Revisit triggers: providers asking for upfront money (→ C with settlements), customers asking to pay everything by card (→ A), PayHere Plus/Premium features becoming necessary (holds for short rentals), Genie sandbox access (cheaper rate).

## D9 — Modular monolith; pg-boss instead of Redis/BullMQ

**Options.** Microservices; modular monolith; monolith with Redis-backed queue (BullMQ); monolith with Postgres-backed queue (pg-boss); cron-only.
**Decision.** Modular monolith (ARCHITECTURE §5) with pg-boss and a transactional outbox.
**Why.** Microservices multiply deployables, network failure modes and infra cost for a team of 2–3 with one bounded context (rentals). Queues are needed (expiries, notifications, image processing), but Redis is an extra paid component (Upstash/Railway) and a second system to monitor. pg-boss gives retries, backoff, scheduling, singleton jobs and — crucially — **transactional enqueue**: a booking commit and its notification job succeed or fail together. At MVP volumes (hundreds of jobs/hour) Postgres handles this trivially.
**Consequences.** Job throughput bound by Postgres; fine below ~thousands/minute. Revisit: move to BullMQ/Redis when job volume or latency needs exceed that, or when we add Redis for distributed rate limiting anyway.

## D10 — Hosting

**Context (prices 2026-10-02).** Vercel Hobby forbids commercial use (any payment processing); Pro is USD 20/seat/month. Railway: Hobby USD 5 + usage (≈ USD 10/GB RAM-month), Singapore region. Neon: free tier then pay-as-you-go (≈ USD 0.106/CU-hour + USD 0.35/GB), Singapore, PostGIS; Supabase Pro USD 25 (Singapore/Mumbai). DigitalOcean droplet USD 12 (2 GB) in Bangalore/Singapore; managed Postgres USD 15. Hetzner Singapore pricing not verifiable. Cloudflare R2 free ≤10 GB. Latency: Mumbai slightly better than Singapore for Sri Lanka; Cloudflare has a Colombo PoP.
**Options.** (a) Vercel (web) + Railway (api) + Neon; (b) Railway for everything (web, api, worker) + Neon; (c) single VPS (DO/Hetzner) with Coolify running web/api/worker/Postgres; (d) AWS (ECS/RDS).
**Decision.** (b) by default: Railway Singapore for three services + Neon Singapore + Cloudflare (DNS, WAF, CDN, R2). Estimated USD 25–50/month.
**Why.** One PaaS console, Docker-based (portable), per-service scaling, built-in log drains, zero-downtime deploys, and no per-seat charge; Neon gives managed backups/PITR and branch databases for staging; Cloudflare handles edge and storage. Vercel adds USD 20/seat for marginal DX gains over self-hosted Next (ISR/images work in a container). A VPS is cheapest but shifts backups, upgrades and security patching onto the team — acceptable later, not while the product is being found. AWS is over-scoped for MVP.
**Consequences.** Next.js runs in a container (`output: 'standalone'`); image optimisation uses sharp in-container; we rely on Railway's region availability. Revisit: cost at scale (move to VPS/Kubernetes-free setups like Coolify or to AWS when > USD 300/month), or compliance requirements that mandate Sri Lankan hosting (then DO Bangalore is not enough either; evaluate local providers).

## D11 — Custom authentication vs auth SaaS/libraries

**Options.** Auth.js (NextAuth); Clerk/Auth0; Supabase Auth; Firebase Auth (phone); Better Auth; custom in NestJS.
**Decision.** Custom auth module in the API (Argon2id, OTP via our SMS/email adapters, JWT access + rotating refresh tokens), Google OAuth added later.
**Why.** The API must be the identity authority for web and mobile; Auth.js is web-framework-centric. Firebase Phone Auth costs USD 0.26 per verification for Sri Lankan numbers versus ≈ LKR 0.6 (≈ USD 0.002) via a local gateway. Clerk/Auth0 are priced per MAU and externalise user data (PDPA cross-border considerations). Supabase Auth would pull in Supabase as a platform dependency. The custom surface is small and well understood (SECURITY_AND_PRIVACY §2), and we control OTP abuse limits.
**Consequences.** We own security-sensitive code: mandatory review, tests and a pen-test item in Phase 10. Revisit: if social logins multiply or enterprise SSO appears (unlikely).

## D12 — Booking model: request-to-book, hold on acceptance

**Options.** (a) Instant book only; (b) request-to-book with calendar hold created at request time; (c) request-to-book with hold at acceptance, payment to confirm (chosen); (d) request with no hold until payment.
**Decision.** (c), with instant book as a provider-enabled option in Phase 11.
**Why.** Sri Lankan providers (especially small operators) need to vet renters (licence, IDP) and often run external WhatsApp bookings; forcing instant book would scare off supply at launch. Holding at request (b) lets slow customers freeze vehicles; not holding at acceptance (d) lets two accepted customers race for payment. (c) balances both: providers commit once, customers get a guaranteed window to pay.
**Consequences.** Two timers (response, payment) and auto-decline of overlapping requests; UX must set expectations ("you pay only after acceptance"). Revisit: when verified-vehicle supply and provider trust metrics exist, promote instant book for top providers.

## D13 — Notifications: email + local SMS + wa.me; no chat, no WhatsApp API in MVP

**Context.** Local SMS ≈ LKR 0.6–0.8 per message (Notify.lk, Text.lk, Textit); alphanumeric sender IDs must be registered (~3 weeks; unregistered IDs blocked from July 2026); international SMS requires a global CPaaS at destination rates. WhatsApp Cloud API: per-message billing, Sri Lanka utility ≈ USD 0.0023 (needs verification), requires Meta business verification; unverified accounts capped at 250 business-initiated conversations/day. `wa.me` links are officially supported and free. Resend: 3,000 emails/month free.
**Decision.** In-app + email for everyone; SMS for +94 numbers (OTP, request/acceptance/confirmation/pickup reminders); `wa.me` click-to-chat after confirmation; no in-platform chat.
**Why.** Booking coordination in Sri Lanka happens on WhatsApp; replicating it with a custom chat adds real-time infrastructure and moderation burden without changing user behaviour. The platform's job is to create the confirmed booking and the audit trail; conversation can move to WhatsApp once both parties are committed (contact details are gated until then, which also discourages off-platform deals before confirmation). WhatsApp Cloud API is the natural upgrade for notifications once business verification is in place.
**Consequences.** Tourists without +94 numbers rely on email + in-app until international SMS/WhatsApp API is added; the brief's "contact the provider when appropriate" is satisfied by gated contact reveal. Revisit: support load from "where is my provider?" questions; Meta verification completed.

## D14 — Double-booking prevention via exclusion constraint

**Options.** (a) Application-level checks with row locks; (b) per-day calendar rows with unique constraints; (c) `tstzrange` + `EXCLUDE USING gist` on a holds table (chosen); (d) serializable isolation.
**Decision.** (c), plus row locks for orderly accept transactions and optimistic `version` for UI staleness.
**Why.** Only (c) and (b) make overlap impossible regardless of code paths; (b) cannot express hour-level windows or turnaround buffers cleanly. Serializable isolation needs retry logic everywhere and is easy to get wrong. (a) alone fails under missed code paths and future admin tools.
**Consequences.** `btree_gist` extension; a single holds table that both bookings and manual blocks write to; the constraint's index doubles as the search availability index. Revisit: never; this is foundational.

## D15 — Monorepo with shared Zod contracts

**Decision.** pnpm workspaces + Turborepo; `packages/contracts` holds every request/response schema; API validates with them, web forms reuse them, OpenAPI is generated from them, and the future mobile app imports them.
**Why.** Eliminates drift between client and server validation and documents the API as a by-product. Alternatives (OpenAPI-first codegen, tRPC) either add generation steps or couple clients to a TypeScript-only RPC that mobile teams dislike.
**Consequences.** Contracts must be versioned carefully (additive changes only within `/v1`). Revisit: none.

---

## Phase 1 implementation decisions (2026-10-03)

### D16 — TypeScript 6.0 and NodeNext

**Context.** On 2026-10-03 the `typescript` npm tag points at 7.0 (the native compiler). The NestJS 12 CLI depends on `~6.0`, `typescript-eslint` supports `<6.1`, and `@nestjs/swagger` declares `^5.5 || ^6`. TypeScript 6 also turns `baseUrl` and `moduleResolution: node10` into errors.
**Decision.** Pin `typescript@~6.0.3` everywhere. Nest and the internal packages use `module: NodeNext` and emit CommonJS (no `"type": "module"`), which keeps Nest's decorator metadata path and lets Next consume the built packages without transpile configuration. Path aliases are avoided in the API; the web app uses `paths` without `baseUrl`.
**Revisit.** When Nest CLI, typescript-eslint and drizzle-kit declare TypeScript 7 support.

### D17 — ESLint 9

**Context.** ESLint 10 is current, but `eslint-config-next` 16 still depends on `eslint-plugin-import`, `eslint-plugin-react` and `eslint-plugin-jsx-a11y`, whose peer ranges stop at ESLint 9; `typescript-eslint` supports both.
**Decision.** One ESLint major across the monorepo: `eslint@^9.39` with flat configs from `packages/eslint-config`. npm marks 9.x as deprecated now that 10 exists; this is cosmetic until the Next plugins move.
**Revisit.** When `eslint-config-next` supports ESLint 10.

### D18 — Validation pipe now, OpenAPI later

**Context.** The architecture wants validation and OpenAPI both derived from the Zod contracts. `nestjs-zod` (the usual bridge) does not yet declare support for NestJS 12, and `@nestjs/swagger` expects class-validator/class-transformer, which we do not use.
**Decision.** A 30-line `ZodValidationPipe` in `apps/api/src/common/pipes` applied per route (`@Body(new ZodValidationPipe(Schema))`), producing `VALIDATION_ERROR` envelopes with field-level details. OpenAPI generation (Zod 4's `z.toJSONSchema` + a small registry, or `nestjs-zod` once it supports Nest 12) is scheduled for Phase 2 with the first real DTOs.
**Consequences.** No `/openapi.json` in Phase 1; the shared contracts package remains the single source of truth.

### D19 — pg-boss in the worker only

**Context.** pg-boss 12 is ESM-only; the API is CommonJS. Node 24 supports `require(esm)`, which TypeScript `NodeNext` permits.
**Decision.** `JobsService` wraps pg-boss and is started only by `apps/api/src/worker.ts` (`pnpm dev:worker`). The HTTP process does not start pg-boss in Phase 1 because nothing enqueues yet; Phase 2 adds the transactional outbox and `send` calls (pg-boss's Drizzle adapter can share our transaction). The worker boots, installs pg-boss's schema and registers zero handlers; an e2e test proves this against the test database.
**Consequences.** One extra process to run locally (`pnpm dev` deliberately runs only web + api). `PGBOSS_SCHEMA` is configurable so tests use their own schema.

### D20 — Phase 1 stays local-only

**Context.** Validation budget ≈ LKR 100,000; the user instructed that Phase 1 must not require Railway, Neon, Cloudflare, Sentry, PayHere or SMS accounts.
**Decision.** Docker Compose runs only PostgreSQL + PostGIS. Mailpit and MinIO are added in the phases that send email (2) and upload files (3). No Dockerfiles, hosting definitions, error tracking or cloud staging yet; `.env.example` documents the future variables as comments. CI (GitHub Actions) runs with a PostGIS service container and no secrets.
**Revisit.** First deployment (Phase 10 at the latest) or earlier if the team wants a shared staging environment; D10 remains the hosting plan.

### D21 — shadcn/ui v4 default preset

**Context.** `shadcn init` (CLI 4.21) now defaults to the "base-nova" preset built on **Base UI** (`@base-ui/react`) rather than Radix, adds a runtime `shadcn` package for its Tailwind layer, uses the `cn` package, and wires the self-hosted **Geist** font through `next/font/google`.
**Decision.** Accept the current default rather than hand-maintaining an older Radix template; three components (button, card, badge) are installed. Geist is downloaded once at build time and self-hosted, so production builds need internet access.
**Consequences.** ARCHITECTURE §4 "Radix primitives" should be read as "Base UI primitives". If offline builds matter, swap the font for a system stack in `layout.tsx` and `globals.css`.

### D22 — drizzle-kit and PostGIS

**Context.** drizzle-kit 0.31 quotes any column type not in its native list; `geography` is absent (only `geometry`), so generated SQL contains `"geography(Point,4326)"`, which PostgreSQL rejects.
**Decision.** Keep `geography` (metre-based `ST_DWithin` with the GiST index, as designed) and hand-unquote the type in generated migrations; `packages/database/src/__tests__/migrations.test.ts` fails if a quoted PostGIS type is committed, and README.md documents the workflow. `runMigrations` takes a session advisory lock so concurrent runners (several instances, parallel test suites) serialise safely. Writes go through `ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography`; reads parse EWKB in the custom column type.
**Revisit.** If drizzle-kit adds `geography` to its native list, or if the project ever needs `geometry`-based operations (then use the built-in `geometry()` column with a functional geography index).

---

## Phase 2 implementation decisions (2026-10-03)

### D23 — Lean Phase 2 scope

**Context.** The approved roadmap's Phase 2 bundled SMS OTP, driver details, avatars, the notification feed and several tables. The user narrowed it (2026-10-03) to a local-only authentication/user foundation under the LKR 100,000 validation budget.
**Decision.** Build e-mail + password accounts, e-mail verification, sessions, password reset, profile and the authorization foundation. Defer: SMS OTP and any SMS provider (an `SmsProvider` adapter is documented in `.env.example` only); `customer_driver_details` and every identity document (collected first when the self-drive booking flow requires them); file uploads/avatars; `notifications` feed; `auth_identities`; admin MFA (no admin login yet).
**Consequences.** ROADMAP, API_DESIGN and DATABASE_DESIGN carry "as implemented / deferred" notes rather than rewritten requirements. Phone remains an optional unverified profile field.

### D24 — pg-boss transactional enqueue as the outbox

**Context.** ARCHITECTURE §5.1 specifies a transactional outbox (`domain_events` row written with the business change, dispatched by the worker). pg-boss 12 ships a Drizzle adapter (`fromDrizzle(tx, sql)`) that inserts the job row inside the caller's transaction.
**Options.** (a) Separate `outbox_events` table + sweeper job; (b) pg-boss `send(..., { db: fromDrizzle(tx, sql) })`.
**Decision.** (b). The job table _is_ the outbox: a user row, its verification token and the `email.send` job commit or roll back together; retries/backoff/expiry come from pg-boss queue options (`apps/api/src/jobs/queues.ts`). The API starts pg-boss lazily on first send with supervision disabled; the worker supervises and runs handlers.
**Consequences.** No extra table or sweeper. Later domain events (booking notifications) use the same path; a dedicated event table can still be added if fan-out to several consumers is needed.

### D25 — E-mail link tokens instead of OTP codes

**Decision.** Verification and reset use 256-bit random tokens in links (`one_time_tokens`, SHA-256 at rest, single use, 24 h / 30 min, 3 per account per 15 min). Six-digit codes make sense for SMS, not e-mail; links also avoid attempt-counting logic. The table gains a `channel` column when SMS arrives, fulfilling the design's `otp_codes` role.

### D26 — Access tokens with `jose` (EdDSA) and per-request user load

**Options.** `@nestjs/jwt` (jsonwebtoken, HS/RS), `jose` (modern, zero deps, Web Crypto, EdDSA).
**Decision.** `jose` with Ed25519. Keys from env in production (`pnpm --filter @vrp/api keys:generate` prints them); ephemeral per-process keys in development/test with a startup warning. The guard loads the user row on every request so suspension, deletion and `sessions_revoked_at` apply instantly; this costs one indexed lookup per request, acceptable at MVP scale and far simpler than a token denylist. `kid`-based rotation is a later addition.

### D27 — Refresh cookie and CSRF

**Decision.** Cookie `vrp_refresh`: HttpOnly, SameSite=Lax, Secure in production, path `/api/v1/auth`. CSRF for the three cookie-authenticated routes is handled by SameSite=Lax plus an `OriginGuard` (Origin/Referer must be in `CORS_ORIGINS`) plus credentialed CORS only for those origins. The design's extra `X-Requested-With` header was dropped as redundant. Mobile clients use the body instead of the cookie. Documented in SECURITY_AND_PRIVACY §2.2.

### D28 — OpenAPI (resolves D18)

**Context.** `nestjs-zod` still lacks Nest 12 support; Zod 4.6 exports JSON Schema with an `openapi-3.0` target.
**Decision.** `@nestjs/swagger` 12 with two tiny decorators (`ApiZodBody`, `ApiZodResponse` in `apps/api/src/openapi/zod-openapi.ts`) that convert the contract schemas. Document at `/api/docs-json`, UI at `/api/docs`, enabled outside production (`OPENAPI_ENABLED`). No class-validator/class-transformer; an e2e test checks the document.
**Consequences.** One dependency (`@nestjs/swagger` + `swagger-ui-dist`). Request bodies are documented from the same schema that validates them.

### D29 — E-mail delivery and new dependencies

**Decision.** `EmailProvider` interface with `SmtpEmailProvider` (`nodemailer`, Mailpit locally at `localhost:1025`, UI `:8025`) and `MemoryEmailProvider` (tests). Production can use any SMTP endpoint (including a provider's SMTP) or add an HTTP provider class without touching callers. Dependencies added this phase: `argon2` (Argon2id, native prebuilds, build script allow-listed), `jose`, `nodemailer`, `cookie-parser`, `@nestjs/swagger`, `drizzle-orm` (now a direct API dependency for query operators); `@scarf/scarf` telemetry build script explicitly denied.

---

## Phase 3 implementation decisions (2026-10-03)

### D30 — Lean Phase 3: reviewed application, manual verification, no SMS, no documents, no storage

**Decision.** Validation-stage provider onboarding is a **reviewed application**: a verified customer fills in a structured form, an operator verifies the business **manually and offline** (calls the number, checks the address / website / social page) and records the decision in the admin UI. The phone number is collected (E.164) but **remains unverified** — `phone_verified_at` exists and stays NULL until a real SMS flow exists; nothing fakes verification. **No sensitive documents** (NIC, passport, licence, business registration, bank, ownership) are collected or stored and **no object storage** (MinIO, S3, R2, presigned uploads) is introduced. Public wording is "Approved provider" / "Platform-reviewed", never "Government ID verified". Notifications stay on the Phase 2 e-mail path (Mailpit locally): application received, changes requested, approved, rejected, suspended, reactivated, plus an optional operator notice (`OPERATOR_NOTIFICATION_EMAIL`).
**Alternatives.** (a) The original Phase 3 (documents in a private bucket, signed URLs, viewer) — rejected for now: it needs storage and encryption work, and it would make the platform a custodian of identity documents (PDPA exposure, breach impact) before there is any traffic to justify it. (b) The Phase 0 "instant provider" (`POST /providers` grants the role immediately) — rejected because the trust promise ("verified providers") requires a human check before a provider can be shown. (c) SMS OTP for the phone — rejected: it needs a paid provider and the budget rule is no paid services until validation.
**Consequences.** Stronger verification is additive later (a `provider_documents` table, badge levels, phone OTP) without changing the application flow. The operator's manual check is the trust mechanism and must be reflected honestly in the UI copy.

### D31 — Application record separate from the profile

**Decision.** `provider_applications` holds the form as submitted (one row per user; place and category selections as `uuid[]` / `text[]` snapshots; review fields `review_reason` for the applicant and `admin_notes` for staff). `provider_profiles` is created **only on approval**, copying the approved data, and the selections are normalised into `provider_service_areas` and `provider_vehicle_categories` for future joins (search by place / category).
**Alternatives.** A single `provider_profiles` row with a `verification_status` column (Phase 0 design) — rejected: it mixes "what the applicant typed" with "what we approved", leaks review-only columns into the provider object, and forces every later provider query to filter unapproved rows. Normalised relation tables on the application too — unnecessary while the application is only read as a whole.
**Consequences.** Re-application after rejection is a later feature (currently `rejected` is terminal); the applicant view and the admin view are different contracts (`ProviderApplicationSchema` vs `AdminProviderApplicationSchema`) so admin-only fields can never leak.

### D32 — Status-conditioned transitions; approval re-validates inside the transaction

**Decision.** The state machine (`provider-application.state.ts`) is enforced in SQL: every transition is a single `UPDATE … SET status = … WHERE id = … AND status IN (allowed) RETURNING`; zero rows → `409 INVALID_STATE_TRANSITION` (or `404` when the id is unknown). Approval runs in one transaction: transition → re-parse the stored form against `ProviderApplicationRequiredSchema` (`400` and rollback if a required field is missing) → insert profile (slug with retry on unique violation) → relation rows → `UPDATE users SET roles = array_append(roles, 'provider') WHERE NOT ('provider' = ANY(roles))` → audit row → e-mail enqueue through pg-boss on the same transaction (D24). `rejected` is terminal in Phase 3.
**Alternatives.** Read-check-write in application code — racy with two admins; optimistic version columns — more machinery than needed for one status column.
**Consequences.** Double approvals and concurrent decisions are safe by construction; tests assert the rollback (no profile, no role, status unchanged) when the profile insert fails.

### D33 — Suspension is a profile status; the provider role stays

**Decision.** `provider_profiles.status ∈ {active, suspended}` with reason and timestamps. The `provider` role is **not** removed on suspension; `ActiveProviderGuard` (profile must exist and be active) protects provider-only actions and returns `403 PROVIDER_SUSPENDED`. Reactivation clears the suspension fields and is audited and e-mailed like suspension.
**Alternatives.** Removing the role — loses the information that the user was approved, requires re-granting, and breaks "who is a provider" queries; reusing the application status — suspension is about an approved provider, not about the application.
**Consequences.** The dashboard stays readable while suspended (with the reason), but every later provider-only route (vehicles, bookings) must use the guard. `PATCH /providers/me` is the first guarded action and exists mainly so suspension is testable now.

### D34 — `audit_events` generalises `admin_audit_logs`

**Decision.** One append-only `audit_events` table (`actor_user_id`, `actor_type admin|user|system`, `action`, `target_type`, `target_id`, `reason`, `metadata jsonb`, `ip`) written through `AuditService.record(input, tx)` inside the transaction of the change. Phase 3 actions: `provider_application.submitted | review_started | changes_requested | approved | rejected`, `provider_profile.updated | suspended | reactivated`, `admin.role_granted`.
**Alternatives.** The admin-only `admin_audit_logs` of the design — too narrow (submission by a user and CLI grants by the system need auditing too); a generic event-sourcing log — overkill.
**Consequences.** `before` / `after` snapshots are added when settings and booking operations need them; an admin read endpoint for the trail comes with the admin console (API_DESIGN §13 `GET /admin/audit-logs`).

### D35 — Admin bootstrap via CLI; admin MFA deferred

**Decision.** `pnpm admin:grant --email <email> [--role admin|super_admin]` (`apps/api/src/cli/grant-admin.ts`, run with `tsx`) grants the role to an **existing, active, e-mail-verified** user, idempotently, and writes an `audit_events` row (`admin.role_granted`, actor `system`, metadata `{ role, via: 'cli' }`). It needs `DATABASE_URL` and nothing else; there is no hard-coded admin, no seeded admin, no admin credentials in source or env. The same `grantRole` function is used by the tests. Admin MFA, shorter admin sessions and a `super_admin` grant UI are **production-hardening items** (SECURITY_AND_PRIVACY §2.1) — the admin console is local-only in this phase.
**Alternatives.** A seeded admin with an env password — rejected (credential in config, easy to leak into source); first-registered-user-becomes-admin — rejected (race, surprising).
**Consequences.** Before any internet exposure of `/admin`, MFA must be implemented; this is tracked explicitly rather than silently dropped.

### D36 — Reference endpoints, pagination helper, provider PATCH, `tsx`

**Decision.** Public read-only `GET /reference/districts | places | vehicle-categories` feed the application form (active entries only; inactive districts / places / categories are rejected server-side with field-level `400` details). Admin lists use a small keyset pagination helper (`apps/api/src/common/pagination.ts`: base64url `createdAt|id` cursor, `limit` 1–50) instead of offsets. `PATCH /providers/me` lets a provider maintain contact details and is the first `ActiveProviderGuard` route. `tsx` is added as an API dev dependency to run TypeScript CLIs without a build step; `vitest` is added to the web app for its pure form / API-client logic.
**Alternatives.** Reusing the designed `GET /places/suggest` — that is a search endpoint with ranking, which the form does not need; offset pagination — fine for a dozen rows but drifts under inserts, and the helper costs nothing.
**Consequences.** `GET /places/suggest` and `GET /vehicle-categories` (API_DESIGN §9) remain for the search phase; the reference endpoints are stable form inputs.

---

## Phase 4 implementation decisions (2026-10-03)

### D37 — Lean Phase 4: no paid map API, no photos or storage yet, no search or booking; basic pricing

**Decision.** Approved providers get pickup locations, vehicle listings with transparent basic pricing and rules, a review lifecycle and manual availability blocks — all local-only. **No paid map, geocoding or autocomplete API**: locations reuse the districts/places gazetteer and PostGIS; a pin is optional and typed in. **No vehicle photos and no object storage** (R2/S3/MinIO/Cloudinary, presigned uploads, image pipelines): the storage decision (D7) is taken when customer-facing vehicle pages exist, so the schema stays free of fake image paths or an unused `vehicle_photos` table. **No customer search, quote engine, booking or payments.** Pricing is the minimum a Sri Lankan self-drive rental needs — daily, optional weekly/monthly, refundable deposit, included km + extra-km rate, min/max days — plus rules (renter age, licence years, fuel policy, delivery flag + flat fee, pickup notes). Money is `numeric(12,2)` in PostgreSQL and decimal strings in the API (`LkrAmountSchema`, `amountToCents`), never floats; the settlement baseline is LKR with a `currency` field for later. With-driver (chauffeur) pricing is deferred rather than squeezed into the self-drive model.
**Alternatives.** The original Phase 4 (MapLibre picker, photos with variants, documents and expiry jobs, turnaround/notice, quote engine) — rejected for the validation budget and because every one of those needs either a paid service or a customer-facing surface that does not exist yet. Integer minor units instead of `numeric` — equivalent precision; `numeric` matches the design docs and reads naturally in SQL.
**Consequences.** Photos, documents, delivery radius, turnaround/notice and the quote engine are additive later; vehicle identity data is complete enough for them. Revisit D7 (storage) before Phase 5.

### D38 — One `vehicle_status` enum; identity fields locked after approval

**Decision.** A single enum covers review and listing lifecycle: `draft → submitted → under_review → changes_requested | approved | rejected`, provider `approved ⇄ inactive` (deactivate/activate), admin `approved | inactive → suspended → approved` (reactivate). Transitions are status-conditioned `UPDATE … WHERE status IN (…) RETURNING` (409 on a lost race), audited and e-mailed in one transaction, exactly like provider applications. Providers edit everything while `draft` / `changes_requested`, and only operational fields (title, description, location, pricing, rules) once approved; identity fields (`VEHICLE_IDENTITY_FIELDS`) answer `400 locked after approval` so a reviewed listing cannot silently become a different vehicle. `rejected` is terminal (create a new listing).
**Alternatives.** Separate `review_status` + `listing_status` columns (the design's `status` + `verification_status`) — more states to keep consistent and every "is it live?" query needs both; a re-review on any edit — too heavy for price changes, which providers must be able to make freely.
**Consequences.** `approved` is the design's `active`, `inactive` its `paused`; reactivation after suspension returns to `approved` (the provider can deactivate again). A later "document-verified vehicle" badge is a separate flag, not a status.

### D39 — Category-aware specification rules in the contracts; plate handling

**Decision.** Specification columns are plain nullable columns on `vehicles`. Which are required or inapplicable per category lives in `VEHICLE_CATEGORY_RULES` in `@vrp/contracts` (cars/SUVs: transmission, fuel, seats, doors; vans: no doors requirement; bikes/scooters: engine cc and fuel, no doors/AC; tuk-tuks: engine cc, fuel, seats, no doors; unknown categories fall back to "seats"). The same function (`vehicleSubmissionIssues`) produces the checklist in the UI, blocks `submit` and is re-run on approval. Registration numbers are trimmed, upper-cased and matched leniently against Sri Lankan plate formats, unique per provider (partial index), visible only to the owner and admins, with `maskRegistrationNumber` ready for public views.
**Alternatives.** Per-category tables (class-table inheritance) — joins and migrations for every category; a `specs jsonb` blob — unvalidated and unqueryable; a hard plate regex — real plates vary (province prefixes, legacy numeric series).
**Consequences.** Adding a category is still a seed insert plus, optionally, a rules entry; the rules are unit-tested in the contracts package.

### D40 — Availability on `vehicle_holds` now; expression-based exclusion constraint; overlaps refused

**Decision.** `vehicle_holds` is created in Phase 4 as the single source of unavailability (DATABASE_DESIGN §6.6, D14), but only provider manual blocks (`kind = 'block'`) are written; booking holds and the `booking_id` foreign key arrive with bookings. The period is two `timestamptz` columns (half-open `[starts_at, ends_at)`), with the exclusion constraint written over `tstzrange(starts_at, ends_at, '[)')` in a custom migration — reads stay plain timestamps and drizzle needs no range type. Overlapping blocks are **prohibited** (`409 AVAILABILITY_CONFLICT` with the conflicting periods from a pre-check; the constraint catches races), not merged. Availability = `status = approved` and no intersecting hold; `inactive`, `suspended` and unreviewed vehicles are never available. Blocks can be managed while `approved` or `inactive`, must end in the future and may span at most 366 days.
**Alternatives.** A separate `vehicle_availability_blocks` table now and a merge later — a migration of live data for no benefit; merging overlapping blocks — hides provider mistakes and complicates deletion; `tstzrange` column — needs a custom Drizzle type for every read.
**Consequences.** The booking service will insert `kind = 'booking'` holds through `AvailabilityService` in the same transaction as acceptance; the e2e suite already proves two concurrent inserts cannot both succeed. Turnaround buffers are added to the booking hold period later, not to blocks.

### D41 — `provider_locations`: district + place required, optional pin, one primary, deactivate-not-delete

**Decision.** The design's `locations` table is implemented as `provider_locations` with `district_id` and `place_id` **required** (the gazetteer is what search will use), `geom` **nullable** (an optional typed-in pin validated against the Sri Lanka bounding box), one primary per provider enforced by a partial unique index, and deactivation instead of deletion (`409 LOCATION_IN_USE` while vehicles reference it; reactivation allowed). Delivery is modelled on the vehicle (flag + flat fee) instead of a location radius, because there is no map to draw a radius on. Inventory cascades when a provider profile is hard-deleted (only tests and data-erasure do that; production uses soft states).
**Alternatives.** Mandatory coordinates — would force a map picker and therefore tiles/geocoding decisions now; hard delete — breaks future booking history.
**Consequences.** Search in Phase 5 can start from `place_id`/`district_id` and use `geom` when present; a MapLibre picker can be added without schema changes.

---

## Appendix — Facts that still need verification before coding

| Item                                                                                                               | Why it matters                               | Owner                             |
| ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------- |
| PayHere: partial refund support; foreign-issued cards paying LKR; Hold-on-Card plan gating                         | Cancellation/refund design; tourist payments | Product + PayHere account manager |
| Genie Business sandbox access and refund/hold APIs                                                                 | Alternative gateway readiness                | Engineering                       |
| Whether a marketplace remitting provider money falls under the 2025 MVTS regulations                               | Blocks moving from model B to A/C            | Legal                             |
| SLTDA registration duty for the marketplace and for providers serving tourists                                     | Launch compliance                            | Legal                             |
| Stamp duty applicability to short vehicle-hire agreements                                                          | Pricing/legal text                           | Legal/Accounting                  |
| PDPA: DPO appointment threshold (draft regs: 25,000 data subjects), cross-border instruments for Singapore hosting | Privacy programme                            | Legal                             |
| DMT position on foreigners and three-wheelers (reported: no licences issued)                                       | Tuk-tuk category policy for tourists         | Product                           |
| OpenFreeMap reliability for production; MapTiler failover config                                                   | Map availability                             | Engineering                       |
| Notify.lk vs Text.lk sender-ID lead time and international reach                                                   | Notification channel                         | Engineering                       |
| Neon vs Supabase final choice (PITR cost, Mumbai availability)                                                     | Hosting                                      | Engineering                       |
