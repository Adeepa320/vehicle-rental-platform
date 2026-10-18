# Runbook: WAF and edge configuration (Cloudflare)

**Status:** v0.1 (2026-10-17), Phase 10. Audience: the on-call engineer.
**Production state:** no Cloudflare zone exists; every item is **EXTERNAL GATE — NOT EXECUTED** and is applied by hand in the Cloudflare dashboard (no infrastructure-as-code for the edge in this phase; a decision record would be needed to add one). Record the final rule names in section 9.
**Facts used:** Railway custom domains need both a CNAME and a TXT record and, behind Cloudflare, proxy on with SSL/TLS mode **Full** (not Full strict); Railway terminates TLS with Let's Encrypt and documents `X-Real-IP` and `X-Forwarded-Proto` (not `X-Forwarded-For`); R2 custom domains must be zones in the same account and the `r2.dev` URL is not for production (all verified 2026-10-17). The API trusts proxy headers only up to `TRUST_PROXY_HOPS` (Phase 10, D68).
**Related:** [INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) §4, [PAYHERE_GO_LIVE.md](PAYHERE_GO_LIVE.md), [DISASTER_RECOVERY.md](DISASTER_RECOVERY.md), docs/ARCHITECTURE.md §13, docs/SECURITY_AND_PRIVACY.md §4 and §11.

## 1. The one rule that must never be broken

**No JavaScript challenge, CAPTCHA, managed challenge, bot-fight block or interactive rule may apply to `POST /api/v1/payments/payhere/notify`.** PayHere's server posts the payment result there; it cannot solve a challenge, and a blocked notification means a paid booking that is never confirmed (and later a `late_success` refund). The endpoint verifies `md5sig` itself before any write and always answers `200`, so it needs no edge protection beyond plain rate limiting against floods. Every WAF change is checked against this rule before it is saved (section 8).

## 2. Hostnames and DNS

| Hostname                                 | Target                                               | Notes                                                                                                                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<domain>` and `www.<domain>`            | Railway web service (Next.js)                        | CNAME + TXT per Railway; proxied (orange cloud); SSL/TLS **Full**                                                                                                                                                                |
| `api.<domain>`                           | Railway API service                                  | Same. `API_PUBLIC_URL=https://api.<domain>/api/v1`; `CORS_ORIGINS=https://<domain>,https://www.<domain>`; `COOKIE_DOMAIN` only if the cookie must span hosts (today the refresh cookie is scoped to the API path `/api/v1/auth`) |
| `media.<domain>` (or similar)            | R2 bucket `vrp-public` custom domain                 | Public photo variants; `STORAGE_PUBLIC_URL=https://media.<domain>`; cache everything (immutable variants, one-year max-age set by the API)                                                                                       |
| `send.<domain>`                          | Resend SPF (TXT + MX) and DKIM (`resend._domainkey`) | DMARC `_dmarc.<domain>` with `p=none` first, then `quarantine`; not proxied (DNS only)                                                                                                                                           |
| `_acme-challenge.<domain>` (if wildcard) | Railway                                              | Must not be proxied (verified Railway requirement)                                                                                                                                                                               |

The private bucket `vrp-private` gets **no** custom domain and no public access; documents and originals are only ever streamed by the API.

## 3. TLS and HTTP settings

- SSL/TLS mode Full (Railway requirement); minimum TLS 1.2; TLS 1.3 on; HTTP/2 and HTTP/3 on; Always Use HTTPS on; Automatic HTTPS Rewrites on.
- HSTS: the API sets `Strict-Transport-Security` itself (one year, `HSTS_ENABLED`); enabling Cloudflare HSTS as well is fine but adds `includeSubDomains` for the whole domain, so only switch it on once `send.<domain>` and `media.<domain>` are confirmed to serve over HTTPS or are DNS-only.
- Do not enable Cloudflare features that rewrite or inject into HTML (Rocket Loader, Email Obfuscation, Mirage, auto-minify of scripts): the web app ships a nonce-based Content-Security-Policy and injected scripts would be blocked or would break the policy.
- Browser Integrity Check: on for the web hostname; **off** for `api.<domain>` (it can reject legitimate server-to-server clients, including PayHere).

## 4. Caching

| Path                                      | Rule                                                                                                                                                                                                               |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api.<domain>/*`                          | **Bypass cache** entirely (cache rule: bypass). Responses carry `Cache-Control: private, no-store` where sensitive, but the edge must never cache `/api/*` (sessions, bookings, contact reveals, document streams) |
| `media.<domain>/*`                        | Cache everything; respect origin headers (`public, max-age=31536000, immutable`); no query-string variation                                                                                                        |
| `<domain>/_next/static/*`                 | Cache (hashed assets)                                                                                                                                                                                              |
| `<domain>/*` (HTML)                       | Default (respect origin). Pages render dynamically because of the CSP nonce; do not force-cache HTML                                                                                                               |
| `<domain>/api/v1/health`, `/api/v1/ready` | Bypass (monitors need live answers)                                                                                                                                                                                |

## 5. WAF: managed rules

- Enable the Cloudflare Managed Ruleset and the OWASP Core Ruleset on `<domain>` and `api.<domain>` in **log** mode for the first week, then **block** after reviewing false positives (search queries with place names, review text, dispute messages and provider descriptions are the usual sources).
- Exception rule for `POST api.<domain>/api/v1/payments/payhere/notify`: skip managed rules and bot management (section 1). Keep the rate limit of section 6.
- Exception for `POST api.<domain>/api/v1/providers/me/documents` and `.../photos` (multipart uploads up to 10 MB): skip body-inspection rules that misfire on binary bodies, keep everything else.
- Leaked-credentials detection (if available on the plan): on for `POST /api/v1/auth/login`; log only (the API already refuses the top common passwords and rate-limits).

## 6. Rate limits at the edge (defence in depth; the API keeps its own per-process limits)

| Path                                                                                     | Edge limit (proposal)                                  | API limit (reference)                                                                          | Action on exceed                                          |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /api/v1/auth/login`                                                                | 30 per minute per IP                                   | `AUTH_LOGIN_LIMIT_PER_MINUTE` (10)                                                             | Block 10 minutes                                          |
| `POST /api/v1/auth/register`, `/auth/password/forgot`, `/auth/email/resend-verification` | 15 per 15 minutes per IP                               | `AUTH_SENSITIVE_LIMIT_PER_15MIN` (5); per-account `AUTH_TOKEN_REQUESTS_PER_USER_PER_15MIN` (3) | Block 15 minutes                                          |
| `POST /api/v1/auth/mfa/challenge`, `/recovery`                                           | 30 per 15 minutes per IP                               | Factor locks after `MFA_MAX_FAILED_ATTEMPTS` (5) for `MFA_LOCK_MINUTES` (15)                   | Block 15 minutes                                          |
| `POST /api/v1/auth/refresh`, `/logout`                                                   | 120 per minute per IP                                  | 60 per minute (hard-coded)                                                                     | Block 1 minute                                            |
| `POST /api/v1/payments/payhere/notify`                                                   | 600 per minute per IP, **block only, never challenge** | None at the API (always `200`); signature verification protects                                | Block 1 minute (log first; PayHere IPs are not published) |
| `GET /api/v1/vehicles/search`, `/places/suggest`                                         | 120 per minute per IP                                  | Global `RATE_LIMIT_MAX` (300) per `RATE_LIMIT_TTL_SECONDS` (60)                                | Block 1 minute                                            |
| `POST /api/v1/bookings`                                                                  | 20 per hour per IP                                     | Global limit; `Idempotency-Key` required                                                       | Block 10 minutes                                          |
| `POST /api/v1/bookings/*/dispute`, `/disputes/*/messages`                                | 60 per 15 minutes per IP                               | `THREAD_POSTS_PER_15MIN` (30)                                                                  | Block 15 minutes                                          |
| Everything else under `/api/v1/*`                                                        | 600 per minute per IP                                  | Global 300 per minute per process                                                              | Block 1 minute                                            |

Client IP: Cloudflare passes the visitor IP in `CF-Connecting-IP` and `X-Forwarded-For`; Railway's edge adds `X-Real-IP`. The API reads the client IP through Express `trust proxy` with `TRUST_PROXY_HOPS` set to the number of proxies in front of it (Cloudflare + Railway = 2; confirm by checking the logged IP of a known client after deployment, because `X-Forwarded-For` handling at Railway is not documented).

## 7. Bot and abuse basics

- Bot Fight Mode (free) or Super Bot Fight Mode: on for `<domain>` HTML pages; **off or exempted** for `api.<domain>/api/v1/payments/payhere/notify` and for `/api/v1/health` and `/ready` (monitors).
- Allow verified bots (search engines) on public pages; `robots.txt` and the sitemap are served by the web app (Phase 10 W17).
- Block requests to `api.<domain>` with no `User-Agent` only in log mode first; PayHere's user agent is not documented.
- Geo rules: none. Tourists book from abroad; providers and PayHere are in Sri Lanka; blocking countries would break the product.
- Scraping of listings: rate limits above plus the API's own; the public API never exposes exact locations, registration numbers or contact details (D46), so scraping is a nuisance, not a breach.

## 8. Admin path protection options

The console lives under `<domain>/admin/*` (web) and `api.<domain>/api/v1/admin/*` (API), protected by roles, admin MFA (`ADMIN_MFA_REQUIRED`) and 8-hour admin sessions. Optional extra layers, in order of preference:

1. **Cloudflare Access (Zero Trust) in front of `/admin/*` on the web hostname** with the operator's identity provider or one-time PIN by e-mail: adds a second gate before the application sign-in. Must **not** be applied to `api.<domain>` (the browser calls the API with a bearer token, and Access would redirect those calls).
2. **IP allow-list** for `/admin/*` when the team works from fixed addresses only; impractical during travel.
3. **WAF rule: managed challenge on `/admin/*` HTML requests** from countries where no team member is; do not apply to `/api/v1/admin/*`.

Whichever is chosen, verify after enabling: an admin can sign in, pass MFA, open `/admin/payments`, download a document (`GET /admin/documents/{id}/content`), and the audit viewer loads.

## 9. Upload-size and request protection

- The API limits JSON bodies to 256 kB, URL-encoded to 64 kB, and multipart uploads to 10 MB with one file (`fileSize`, `files`, plus `fields` / `parts` limits from Phase 10). Set the Cloudflare maximum upload size to the plan's smallest value at or above 10 MB (free plan 100 MB) and add a WAF rule that blocks requests to `/api/v1/*` with `Content-Length` above 11 MB except the two upload routes.
- Railway closes requests with no data for 5 minutes and bodies must finish uploading within 5 minutes; a 10 MB document on a slow mobile connection fits.
- Header size: Railway caps combined headers at 32 kB; the platform sets one small cookie.

## 10. Change checklist (every edge change)

1. Does the change touch `api.<domain>`? If yes, confirm `/api/v1/payments/payhere/notify` keeps: no challenge, no bot block, no body inspection that could reject form-encoded posts, cache bypass.
2. Confirm `/api/*` is still cache-bypassed.
3. Confirm `/api/v1/health` and `/api/v1/ready` are reachable by the uptime monitor.
4. Confirm a sign-in, a search, a booking request and an admin MFA challenge still work from a normal browser.
5. Record the change in section 11.

## 11. Configuration log

| Date | Change | Rule or setting name | By  | Verified with checklist |
| ---- | ------ | -------------------- | --- | ----------------------- |
|      |        |                      |     | none yet                |
