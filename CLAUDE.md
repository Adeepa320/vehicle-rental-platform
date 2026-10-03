# CLAUDE.md — Permanent development rules for this repository

This file is read automatically by Claude Code at the start of every session in this repository. The rules below are **permanent** and apply to every task unless the user explicitly overrides them in the conversation.

## 1. What this project is

A Sri Lankan online vehicle-rental marketplace ("search nearby vehicles → see real availability → compare transparent prices → trust verified providers → book"). Launching in the South Coast (Matara, Weligama, Mirissa, Galle, Unawatuna) and architected to expand island-wide.

The approved product, architecture and roadmap live in `docs/`. They are the source of truth:

| Document                       | Purpose                                                                     |
| ------------------------------ | --------------------------------------------------------------------------- |
| `docs/PRODUCT_BRIEF.md`        | Problem, vision, target users, differentiation, risks, assumptions          |
| `docs/COMPETITOR_ANALYSIS.md`  | Verified market research (do not add unverified claims)                     |
| `docs/PRD.md`                  | Functional / non-functional requirements, user stories, acceptance criteria |
| `docs/USER_FLOWS.md`           | Customer, provider and admin end-to-end flows                               |
| `docs/ARCHITECTURE.md`         | System, frontend, backend, data, infra architecture                         |
| `docs/DATABASE_DESIGN.md`      | Schema, constraints, availability / double-booking strategy                 |
| `docs/API_DESIGN.md`           | REST API contract                                                           |
| `docs/SECURITY_AND_PRIVACY.md` | Auth, RBAC, data protection, retention                                      |
| `docs/MVP_SCOPE.md`            | MUST / SHOULD / COULD / NOT NOW                                             |
| `docs/ROADMAP.md`              | Development phases with Definition of Done                                  |
| `docs/TECH_DECISIONS.md`       | Decision records with alternatives considered                               |

## 2. Before changing anything

1. **Read the relevant docs first.** Before any architectural, schema, API-contract or dependency change, read the matching document(s) above. Do not rely on memory of a previous session.
2. **Investigate before implementing.** Locate and read the actual existing code paths you intend to change. Verify function names, file paths, types and behaviour in the current working tree. Never assume a file or function exists because a document mentions it.
3. **Follow the approved architecture.** Modular monolith; module boundaries, naming and layering as described in `docs/ARCHITECTURE.md`. Do not introduce microservices, new infrastructure components, new queues, new databases or new external services without an explicit decision recorded in `docs/TECH_DECISIONS.md`.
4. **Follow the roadmap phase.** Implement only what the current phase in `docs/ROADMAP.md` and `docs/MVP_SCOPE.md` calls for. If a task appears to need something from a later phase, say so and ask rather than pulling it forward.

## 3. Git rules (strict)

- **Never commit.**
- **Never push.**
- **Never switch, create or delete branches** unless the user explicitly instructs it in the current conversation.
- **Never modify git history** (no rebase, amend, reset --hard, force push, reflog manipulation, filter-branch).
- Never run `git stash` on the user's work without being asked.
- You may run read-only git commands (`git status`, `git diff`, `git log`) freely.
- The user commits. Your job ends with a clean, verified working tree and a summary of changed files.

## 4. Dependencies

- **Avoid unnecessary dependencies.** Prefer the platform (Node, PostgreSQL, the already-chosen frameworks) over a new package. Before adding a package, check whether an existing dependency already does the job.
- Any new runtime dependency must be justified in the task summary (what it does, why no existing dependency suffices, size, maintenance status, licence).
- Do not add packages "to try them out". Do not pin to pre-release versions.
- Never install packages during planning/design tasks.

## 5. Product requirements are not yours to change

- **Do not silently change product requirements.** If the spec in `docs/PRD.md` / `docs/MVP_SCOPE.md` seems wrong, incomplete or contradictory, stop and say so with a concrete proposal. Do not quietly implement a different behaviour.
- Do not widen or narrow scope on your own: no bonus features, no "while I was here" refactors outside the task, and no quiet omission of parts of the task.
- Document assumptions explicitly in your summary when the requirement is ambiguous and the ambiguity does not block the work.

## 6. Implementation standards

- TypeScript strict mode everywhere; no `any` without a comment explaining why.
- Validate every external input (HTTP body/query/params, webhooks, uploaded files, environment variables) at the boundary with the shared schema package.
- Money is `numeric`/decimal strings end to end; never floating point.
- All times stored in UTC (`timestamptz`); display in `Asia/Colombo` unless the user's locale explicitly differs.
- Availability and booking state transitions must go through the booking service and its transactional methods; never update `bookings.status` or `vehicle_holds` from elsewhere.
- Sensitive personal data (NIC, passport, licence, bank account) must use the encryption helpers and private storage described in `docs/SECURITY_AND_PRIVACY.md`. Never log it.
- Secrets come from environment variables / the secret manager. Never hard-code keys, never commit `.env` files.
- Keep API contracts backward compatible within `/api/v1`; breaking changes require a decision record.
- Write or update tests alongside the change (unit for services/pricing/state machine; integration for repository/transaction code; e2e for critical flows).
- Database changes: edit `packages/database/src/schema`, run `pnpm db:generate`, then **review the generated SQL** — drizzle-kit quotes PostGIS types (`"geography(Point,4326)"`), which must be unquoted by hand. Extensions, triggers and exclusion constraints go in custom migrations (`drizzle-kit generate --custom`). Never edit an already-applied migration.
- Use `pnpm` (never npm/yarn); new post-install build scripts must be allow-listed in `pnpm-workspace.yaml` (`allowBuilds`).
- API routes are protected by default (global `JwtAuthGuard`); opt out only with `@Public()` and a reason. Use `@Roles()` for role checks and `@CurrentUser()` for the caller. Validate bodies with `@Body(new ZodValidationPipe(Schema))` and document them with `ApiZodBody` / `ApiZodResponse` using schemas from `@vrp/contracts`.
- Never log passwords, tokens, cookies or e-mail bodies; mask e-mail addresses in logs (`maskEmail`). Jobs that must follow a database write are enqueued inside the same transaction (`EmailService.enqueue(message, tx)`).
- Local workflow and commands are documented in `README.md`; keep it current.
- Provider trust wording is "Approved provider" / "Platform-reviewed" / "Provider reviewed by platform". Never write "verified identity", "Government ID verified" or similar until document verification exists.
- Provider verification is a manual operator process (Phase 3): never set `phone_verified_at` without a real verification flow, never collect or store identity / business / bank documents, never add object storage without a decision record. Admin accounts are created only with `pnpm admin:grant`; no hard-coded admins, no admin credentials in source.
- Provider application and profile state changes go through `ProviderApplicationsService` / `AdminReviewService` (status-conditioned `UPDATE … WHERE status IN (…)`; `409 INVALID_STATE_TRANSITION` on a lost race). Every admin decision writes an `audit_events` row with `AuditService.record(input, tx)` in the same transaction.
- Vehicle listings (Phase 4): one `vehicle_status` enum covers review and listing lifecycle (`modules/catalogue/vehicle.state.ts`); transitions go through `VehiclesService` / `AdminVehicleReviewService` with the same status-conditioned pattern. Identity fields (`VEHICLE_IDENTITY_FIELDS`) are locked after approval. Category-specific requirements live in `VEHICLE_CATEGORY_RULES` in `@vrp/contracts`, never in per-category tables or JSON blobs.
- Money: `numeric(12,2)` columns and decimal strings validated by `LkrAmountSchema`; compare and compute with `amountToCents` / `compareAmounts` / `multiplyAmount`, never with `Number()` or floats. Settlement currency is LKR.
- Availability: `vehicle_holds` is the only source of unavailability. Insert holds only through `AvailabilityService` (later also the booking service) with half-open `[starts_at, ends_at)` periods; the exclusion constraint is the final guard, and overlapping manual blocks are refused (`409 AVAILABILITY_CONFLICT`), never merged. Only `approved` vehicles can be available.
- Inventory routes are scoped by the caller's provider (`ActiveProviderGuard` + `@CurrentProvider()`); another provider's resource is `404`. No paid map, geocoding, autocomplete or cloud storage service may be added without a decision record (D37, D41, D42).
- Object storage (Phase 5) goes only through `StorageService` (`modules/storage`): MinIO locally via the S3 API, `memory` in tests, production provider undecided. Keys are server-generated from UUIDs (`assertSafeKey`); uploads are sniffed with sharp (`processVehiclePhoto`), re-encoded to WebP and stripped of metadata; originals stay in the private bucket. Never accept client-supplied object paths or external image URLs, and never expose storage credentials to the browser.
- Public responses (`GET /vehicles/search`, `GET /vehicles/{slug}`, `GET /places/suggest`) are built only by the allow-list mappers in `modules/discovery/public.mappers.ts`: `approximatePoint` (0.005° grid) or the town centre, never registration numbers, addresses, pickup instructions/notes, exact coordinates, provider contact details or internal notes. When adding a public field, extend `public-search.e2e.test.ts`'s privacy assertions in the same change.
- Search is PostgreSQL/PostGIS in `DiscoveryService` (searchable predicate: approved, active provider, active location, active category, ≥ `MIN_VEHICLE_PHOTOS` photos; `NOT EXISTS` over `vehicle_holds`; `ST_DWithin`/`ST_Distance`). No external search engine. Public pricing is the listed rates plus `estimateRental` labelled as an estimate; the signed quote belongs to the booking phase.

## 7. Verification is mandatory

After implementing a change, run the relevant checks and **show their actual output** (do not summarise from memory):

1. Type check (`typecheck` script) for affected packages.
2. Lint (`lint` script).
3. Tests (`test` script, at least for affected modules; full suite for schema/booking/payment changes).
4. Build (`build` script) when the change touches configuration, routing, environment or dependencies.
5. Database migrations: apply to a local database and confirm they run forward cleanly; include a rollback note.

If a check fails, fix it or report the failure verbatim. Never claim a check passed if it was not run.

## 8. Reporting every task

End every implementation task with:

- **Changed files**: the full list, grouped by package, with a one-line purpose each.
- **Verification results**: the commands run and their outcomes.
- **Assumptions and open questions**.
- **Documentation updates**: which `docs/*.md` were updated, or an explicit statement that no doc change was required.

## 9. Keep documentation in sync

- When architecture, schema, API contract, security posture or infrastructure changes, update the corresponding `docs/*.md` in the same task.
- Add a decision record to `docs/TECH_DECISIONS.md` for any non-trivial technical choice (format: context, options, decision, consequences).
- Do not create new top-level documentation files without being asked; extend the existing ones.

## 10. Things that always require explicit user confirmation

- Destructive database operations (dropping tables/columns, deleting data, resetting a database that may have data).
- Deleting files that are not generated artefacts.
- Changing payment, pricing, commission or cancellation logic.
- Changing authentication, authorisation or encryption behaviour.
- Any action that sends real emails/SMS/WhatsApp or calls a production third-party API.
- Any git operation beyond read-only commands.

## 11. Working style

- State what you are about to do in one line, do the work, then report. Do not ask for permission for reversible, in-scope edits.
- Prefer small, reviewable changes over large rewrites.
- Reference code locations as `path/to/file.ts:line` so they are clickable.
- If a tool or check is unavailable in the environment, say so explicitly instead of skipping silently.
