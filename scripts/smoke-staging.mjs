#!/usr/bin/env node
// Staging smoke test (post-Phase-10 go-live Step 1, docs/runbooks/STAGING_DEPLOYMENT.md).
//
//   SMOKE_WEB_URL=https://<staging web> SMOKE_API_URL=https://<staging api>/api/v1 pnpm smoke:staging
//
// NON-DESTRUCTIVE and bounded, unlike `pnpm smoke:phase10` (which starts local
// processes, uses Mailpit / MinIO and the fake gateway): it only sends HTTP
// requests to an already running deployment. It creates no accounts, no
// listings, no bookings and no payments, and calls no third-party service.
// The heaviest step is 12 failed logins for one random, non-existent e-mail
// address (the per-IP login limiter); run it at most once a minute.
//
// Environment:
//   SMOKE_WEB_URL               staging web origin (required)
//   SMOKE_API_URL               staging API base including /api/v1 (required)
//   SMOKE_ALLOW_HTTP=1          accept http:// URLs (local production-mode rehearsal only)
//   SMOKE_WEB_ORIGIN / SMOKE_API_ORIGIN
//                               the public origins the deployment is configured with, when
//                               they differ from the URLs used to reach it (local rehearsal);
//                               default: the origins of SMOKE_WEB_URL / SMOKE_API_URL
//   SMOKE_ADMIN_ACCESS_TOKEN    optional MFA-completed admin access token for the worker
//                               status step; read from the environment, never printed
//   SMOKE_EXPECT_LOGIN_LIMIT    login attempts per minute configured on the API (default 10)
//
// Prints PASS / FAIL / SKIP per step and exits 1 when any step fails. Response
// bodies and header values that could carry secrets are never printed.
import { randomBytes } from 'node:crypto';

const WEB = (process.env.SMOKE_WEB_URL ?? '').replace(/\/+$/, '');
const API = (process.env.SMOKE_API_URL ?? '').replace(/\/+$/, '');
const ALLOW_HTTP = process.env.SMOKE_ALLOW_HTTP === '1';
const ADMIN_TOKEN = process.env.SMOKE_ADMIN_ACCESS_TOKEN;
const LOGIN_LIMIT = Number(process.env.SMOKE_EXPECT_LOGIN_LIMIT ?? 10);
const HOSTILE_ORIGIN = 'https://hostile-origin.example.invalid';
const CANARY = `staging-canary-${randomBytes(9).toString('hex')}`;
const EXPECTED_SCHEDULES = [
  'bookings.expire',
  'documents.expiry-sweep',
  'reminders.sweep',
  'retention.sweep',
];
// Strings that must never appear in a public response (header values or bodies).
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /postgres(ql)?:\/\/[^\s"']*:[^\s"'@]+@/i,
  /minioadmin/i,
  /merchant_?secret/i,
  /"(password|passwordHash|secret|accessKey|secretKey)"\s*:/i,
  /\bat [\w$.<>]+ \([^)]*\.(js|ts):\d+:\d+\)/, // stack trace line
];

if (!WEB || !API) {
  console.error('Set SMOKE_WEB_URL and SMOKE_API_URL (see the header of this file).');
  process.exit(2);
}
for (const [name, value] of [
  ['SMOKE_WEB_URL', WEB],
  ['SMOKE_API_URL', API],
]) {
  const url = new URL(value);
  if (url.protocol !== 'https:' && !ALLOW_HTTP) {
    console.error(`${name} must be https:// (SMOKE_ALLOW_HTTP=1 only for a local rehearsal).`);
    process.exit(2);
  }
}
const WEB_ORIGIN = new URL(process.env.SMOKE_WEB_ORIGIN ?? WEB).origin;
const API_ORIGIN = new URL(process.env.SMOKE_API_ORIGIN ?? API).origin;

const results = [];
const serverErrors = [];

async function step(name, fn) {
  try {
    const detail = await fn();
    if (detail && typeof detail === 'object' && detail.skip) {
      results.push({ name, status: 'SKIP' });
      console.log(`SKIP  ${name} — ${detail.skip}`);
    } else {
      results.push({ name, status: 'PASS' });
      console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    }
  } catch (error) {
    results.push({ name, status: 'FAIL' });
    console.log(`FAIL  ${name} — ${error instanceof Error ? error.message : String(error)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function req(url, init = {}) {
  const response = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000),
    ...init,
  });
  if (response.status >= 500)
    serverErrors.push(`${init.method ?? 'GET'} ${url} → ${response.status}`);
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function assertNoSecrets(label, res) {
  const haystack = `${[...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join('\n')}\n${res.text}`;
  for (const pattern of SECRET_PATTERNS) {
    assert(
      !pattern.test(haystack),
      `${label}: response matches a secret pattern (${pattern.source})`,
    );
  }
}

function apiPost(path, body, headers = {}) {
  return req(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

console.log(`Staging smoke — web ${WEB_ORIGIN}, api ${API_ORIGIN} — ${new Date().toISOString()}`);
console.log(`Log-privacy canary for this run: ${CANARY}\n`);

// ---------------------------------------------------------------- transport
await step('1. web and API served over HTTPS', () => {
  if (ALLOW_HTTP) return { skip: 'SMOKE_ALLOW_HTTP=1 (local rehearsal)' };
  assert(WEB.startsWith('https://') && API.startsWith('https://'), 'not https');
  return 'both https://';
});

// ---------------------------------------------------------------- API probes
let health;
await step('2. API liveness /health', async () => {
  health = await req(`${API}/health`);
  assert(health.status === 200 && health.json?.status === 'ok', `status ${health.status}`);
  assert(health.json.environment === 'production', `environment ${health.json.environment}`);
  const keys = Object.keys(health.json).sort().join(',');
  assert(
    keys === 'environment,service,status,timestamp,uptimeSeconds,version',
    `unexpected fields: ${keys}`,
  );
  assertNoSecrets('/health', health);
  return `200 ok, NODE_ENV=production, version ${health.json.version}, fields: ${keys}`;
});

await step('3. API readiness /ready (database, PostGIS, migrations)', async () => {
  const ready = await req(`${API}/ready`);
  assert(
    ready.status === 200 && ready.json?.status === 'ready',
    `status ${ready.status} ${ready.json?.status}`,
  );
  const checks = ready.json.checks ?? {};
  for (const name of ['database', 'postgis', 'migrations']) {
    assert(checks[name]?.status === 'up', `${name} is ${checks[name]?.status}`);
  }
  assertNoSecrets('/ready', ready);
  return 'database, postgis, migrations up';
});

await step('4. API security headers (CSP, HSTS, nosniff, frame deny, referrer, COOP)', async () => {
  const h = health.headers;
  const csp = h.get('content-security-policy') ?? '';
  assert(
    csp.includes("default-src 'none'") && csp.includes("frame-ancestors 'none'"),
    `CSP ${csp}`,
  );
  const hsts = h.get('strict-transport-security') ?? '';
  const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
  assert(maxAge >= 31_536_000 && /includeSubDomains/i.test(hsts), `HSTS "${hsts}"`);
  assert(h.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  assert(h.get('x-frame-options') === 'DENY', 'x-frame-options not DENY');
  assert(h.get('referrer-policy') === 'no-referrer', 'referrer-policy');
  assert(h.get('cross-origin-opener-policy') === 'same-origin', 'COOP');
  assert(!h.get('x-powered-by'), 'x-powered-by present');
  return `CSP default-src 'none'; HSTS max-age=${maxAge}; includeSubDomains`;
});

await step('5. CORS: staging web origin allowed with credentials', async () => {
  const pre = await req(`${API}/auth/login`, {
    method: 'OPTIONS',
    headers: {
      origin: WEB_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert(pre.headers.get('access-control-allow-origin') === WEB_ORIGIN, 'origin not echoed');
  assert(pre.headers.get('access-control-allow-credentials') === 'true', 'credentials not allowed');
  return `ACAO ${WEB_ORIGIN}, credentials true`;
});

await step(
  '6. CORS: hostile origin and null origin refused; foreign-origin refresh 403',
  async () => {
    for (const origin of [HOSTILE_ORIGIN, 'null', `${WEB_ORIGIN}.hostile.invalid`]) {
      const pre = await req(`${API}/auth/login`, {
        method: 'OPTIONS',
        headers: { origin, 'access-control-request-method': 'POST' },
      });
      assert(!pre.headers.get('access-control-allow-origin'), `ACAO sent for ${origin}`);
    }
    const csrf = await apiPost('/auth/refresh', '{}', { origin: HOSTILE_ORIGIN });
    assert(csrf.status === 403, `foreign-origin refresh → ${csrf.status}`);
    return 'no ACAO for hostile / null / suffix-trick origins; refresh from hostile origin → 403';
  },
);

await step('7. Swagger / OpenAPI and fake gateway not served', async () => {
  const origin = new URL(API).origin;
  for (const path of ['/api/docs', '/api/docs-json']) {
    const r = await req(`${origin}${path}`);
    assert(r.status === 404, `${path} → ${r.status}`);
  }
  // The fake gateway controller is not mounted in production builds (404, not merely 401/403).
  for (const path of ['/payments/fake/checkout', '/payments/fake/complete']) {
    const r = await apiPost(path, '{}');
    assert(r.status === 404, `POST ${path} → ${r.status}`);
  }
  return '/api/docs, /api/docs-json → 404; POST /payments/fake/{checkout,complete} → 404';
});

await step('8. protected route refuses anonymous callers', async () => {
  const me = await req(`${API}/users/me`, { headers: { authorization: `Bearer ${CANARY}` } });
  assert(me.status === 401, `/users/me with a bogus token → ${me.status}`);
  const anon = await req(`${API}/admin/system/worker`);
  assert(anon.status === 401, `/admin/system/worker anonymous → ${anon.status}`);
  assertNoSecrets('401', me);
  return '/users/me (bogus bearer) → 401; /admin/system/worker → 401';
});

await step('9. malformed and invalid bodies → 400', async () => {
  const broken = await apiPost('/auth/login', '{"email": ');
  assert(broken.status === 400, `malformed JSON → ${broken.status}`);
  const invalid = await apiPost('/auth/login', { email: 'not-an-email' });
  assert(invalid.status === 400, `schema-invalid body → ${invalid.status}`);
  assertNoSecrets('400', broken);
  return 'malformed JSON → 400; schema-invalid → 400; no stack trace';
});

await step('10. request-body limit → 413', async () => {
  const big = JSON.stringify({ email: 'x@example.invalid', password: 'y'.repeat(300 * 1024) });
  const r = await apiPost('/auth/login', big);
  assert(r.status === 413 && r.json?.error?.code === 'PAYLOAD_TOO_LARGE', `${r.status}`);
  return '300 KiB JSON → 413 PAYLOAD_TOO_LARGE (one request)';
});

// ---------------------------------------------------------------- web pages
let home;
await step('11. web home renders with the nonce CSP and HSTS', async () => {
  home = await req(`${WEB}/`);
  assert(home.status === 200, `GET / → ${home.status}`);
  const csp = home.headers.get('content-security-policy') ?? '';
  const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
  assert(/'nonce-[A-Za-z0-9+/=]+'/.test(scriptSrc), 'script-src has no nonce');
  assert(scriptSrc.includes("'strict-dynamic'"), "no 'strict-dynamic'");
  assert(!/'unsafe-eval'|'unsafe-inline'/.test(scriptSrc), 'unsafe script source');
  assert(!/(^|\s)\*(\s|;|$)/.test(csp), 'wildcard source in CSP');
  const nonce = /'nonce-([^']+)'/.exec(scriptSrc)[1];
  assert(home.text.includes(`nonce="${nonce}"`), 'scripts do not carry the nonce');
  const connect = csp.split(';').find((d) => d.trim().startsWith('connect-src')) ?? '';
  assert(connect.includes(API_ORIGIN), 'API origin missing from connect-src');
  const hsts = home.headers.get('strict-transport-security') ?? '';
  assert(/max-age=\d+/.test(hsts), 'web HSTS missing');
  assert(!home.headers.get('x-powered-by'), 'x-powered-by present');
  assertNoSecrets('web /', home);
  return `200; script-src nonce + 'strict-dynamic'; connect-src has the API origin; HSTS "${hsts}"`;
});

await step('12. search, login and vehicle-less pages render', async () => {
  const out = [];
  for (const path of ['/search?place=mirissa', '/login', '/register', '/become-a-provider']) {
    const r = await req(`${WEB}${path}`);
    assert(r.status === 200, `${path} → ${r.status}`);
    assertNoSecrets(path, r);
    out.push(`${path} 200`);
  }
  return out.join(', ');
});

await step('13. legal drafts withheld in a production build (404)', async () => {
  const out = [];
  for (const path of ['/privacy', '/terms', '/cancellation-policy']) {
    const r = await req(`${WEB}${path}`);
    // Drafts with placeholders are never published in production (isLegalPageVisible).
    assert(r.status === 404, `${path} → ${r.status} (a draft must not be served)`);
    out.push(`${path} 404`);
  }
  return out.join(', ');
});

await step('14. MapLibre worker served from /maplibre/ and allowed by CSP', async () => {
  const r = await req(`${WEB}/maplibre/maplibre-gl-worker.mjs`);
  assert(r.status === 200, `worker → ${r.status}`);
  const type = r.headers.get('content-type') ?? '';
  assert(/javascript/.test(type), `content-type ${type}`);
  const csp = home.headers.get('content-security-policy') ?? '';
  const worker = csp.split(';').find((d) => d.trim().startsWith('worker-src')) ?? '';
  assert(worker.includes("'self'") || worker.includes('blob:'), `worker-src "${worker}"`);
  return `200 ${type}; ${worker.trim()}`;
});

await step('15. no repository or environment files exposed', async () => {
  for (const path of ['/.git/HEAD', '/.env', '/.env.production', '/apps/web/.env']) {
    const r = await req(`${WEB}${path}`);
    assert(r.status === 404, `${path} → ${r.status}`);
  }
  return '/.git/HEAD, /.env* → 404';
});

// ---------------------------------------------------------------- worker
await step('16. worker healthy with every schedule registered (admin)', async () => {
  if (!ADMIN_TOKEN)
    return { skip: 'SMOKE_ADMIN_ACCESS_TOKEN not set (needs an MFA-completed admin)' };
  const r = await req(`${API}/admin/system/worker`, {
    headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
  });
  assert(r.status === 200, `GET /admin/system/worker → ${r.status}`);
  assert(r.json.healthy === true, `healthy=${r.json.healthy}`);
  const names = r.json.schedules.map((s) => s.name);
  for (const expected of EXPECTED_SCHEDULES) {
    assert(names.includes(expected), `schedule ${expected} missing`);
  }
  assert(new Set(names).size === names.length, 'duplicate schedules');
  return `healthy; schedules: ${names.join(', ')}`;
});

// ---------------------------------------------------------------- rate limit (last: it uses up this IP's login budget for a minute)
await step('17. login rate limit, not reset by spoofed forwarding headers', async () => {
  const email = `staging-smoke-${randomBytes(6).toString('hex')}@example.invalid`;
  const attempt = (headers = {}) =>
    apiPost('/auth/login', { email, password: `not-the-password-${CANARY}` }, headers);
  const statuses = [];
  for (let i = 0; i < LOGIN_LIMIT + 2; i += 1) statuses.push((await attempt()).status);
  const first429 = statuses.indexOf(429);
  assert(first429 > 0, `no 429 after ${statuses.length} attempts (${statuses.join(',')})`);
  assert(
    statuses.slice(0, first429).every((s) => s === 401),
    `before limit: ${statuses.join(',')}`,
  );
  const spoofXff = await attempt({ 'x-forwarded-for': '203.0.113.7' });
  const spoofReal = await attempt({ 'x-real-ip': '203.0.113.8' });
  const spoofBoth = await attempt({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' });
  assert(
    [spoofXff, spoofReal, spoofBoth].every((r) => r.status === 429),
    `spoofed headers reset the limiter: ${spoofXff.status}/${spoofReal.status}/${spoofBoth.status}`,
  );
  return `${first429} × 401 then 429; spoofed X-Forwarded-For / X-Real-IP still 429`;
});

await step('18. no server error (5xx) during the run', () => {
  assert(serverErrors.length === 0, serverErrors.join('; '));
  return 'none';
});

const failed = results.filter((r) => r.status === 'FAIL').length;
const skipped = results.filter((r) => r.status === 'SKIP').length;
console.log(
  `\n${results.length - failed - skipped} passed, ${failed} failed, ${skipped} skipped.` +
    `\nManual follow-up: search the platform logs for "${CANARY}" — it must not appear` +
    ' (it was sent as a bearer token and inside a password; the request lines may show the route only).',
);
process.exit(failed === 0 ? 0 : 1);
