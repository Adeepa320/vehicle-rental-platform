#!/usr/bin/env node
// Phase 10 integrated smoke test (release / security / system readiness).
//
//   pnpm build && pnpm smoke:phase10
//
// Runs the BUILT API, worker and web app against the local PostgreSQL/PostGIS,
// Mailpit and MinIO (`pnpm db:up`) with the fake payment gateway, plus a second,
// short-lived API in production mode with a synthetic configuration (unresolvable
// `.invalid` hosts — nothing external is ever contacted) for the production-only
// headers, cookie and rate-limit checks. Never calls PayHere, Resend, R2 or any
// production service: those stay external go-live gates.
//
// Every step prints PASS / FAIL; the process exits 0 only when every required
// step passed. Output: `.smoke/phase10-<run>/` (result log, process logs) — git-ignored.
// Environment: SMOKE_BASELINE_COMMIT (default: the approved Phase 9 checkpoint).
import { spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import { createRequire } from 'node:module';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUN = Date.now().toString(36);
const OUT = path.join(ROOT, '.smoke', `phase10-${RUN}`);
const BASELINE_COMMIT = process.env.SMOKE_BASELINE_COMMIT ?? '60c8755';
const REQUIRED_STEPS = 93;
const API_PORT = 4000;
const PROBE_PORT = 4100;
const WEB_PORT = 3000;
const API = `http://localhost:${API_PORT}/api/v1`;
const PROBE = `http://localhost:${PROBE_PORT}/api/v1`;
const WEB = `http://localhost:${WEB_PORT}`;
const WEB_ORIGIN = WEB;
const MAILPIT = 'http://localhost:8025/api/v1';
const MINIO = 'http://localhost:9000';
const DB_CONTAINER = 'vehicle-rental-db';
const PASSWORD = `Smoke-Phase10-${RUN}!`;
const NEW_PASSWORD = `Smoke-Phase10-new-${RUN}!`;
const CANARY = `smoke-canary-${randomBytes(9).toString('hex')}`;
const PRELOAD = pathToFileURL(path.join(ROOT, 'scripts', 'smoke', 'ipc-shutdown.mjs')).href;
const apiRequire = createRequire(path.join(ROOT, 'apps', 'api', 'package.json'));

fs.mkdirSync(OUT, { recursive: true });
const RESULT = path.join(OUT, 'result.log');
fs.writeFileSync(RESULT, `Phase 10 smoke run ${RUN} — ${new Date().toISOString()}\n\n`);
const log = (line) => {
  fs.appendFileSync(RESULT, `${line}\n`);
  console.log(line);
};

// ------------------------------------------------------------------ helpers

function parseEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const rootEnv = parseEnvFile(path.join(ROOT, '.env'));
// The smoke registers ~15 accounts and sends hundreds of requests from one IP; the per-IP
// limits (covered by their own e2e suites and by the production-mode probe below) are raised.
const env = {
  ...rootEnv,
  ...process.env,
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  WEB_APP_URL: WEB,
  CORS_ORIGINS: WEB_ORIGIN,
  ADMIN_MFA_REQUIRED: 'true',
  OPERATOR_NOTIFICATION_EMAIL: `ops-${RUN}@example.com`,
  AUTH_SENSITIVE_LIMIT_PER_15MIN: '200',
  AUTH_LOGIN_LIMIT_PER_MINUTE: '300',
  RATE_LIMIT_MAX: '10000',
};
delete env.PAYMENT_GATEWAY; // default outside production: the fake gateway
const FAKE_MERCHANT = 'FAKE-MERCHANT';
const FAKE_SECRET =
  env.PAYHERE_MERCHANT_SECRET || 'fake-merchant-secret-for-local-development-only';
const md5 = (s) => createHash('md5').update(s).digest('hex').toUpperCase();
const SECRET_MD5 = md5(FAKE_SECRET);
const DB_NAME = new URL(env.DATABASE_URL).pathname.slice(1);
const TEST_DB_NAME = env.DATABASE_URL_TEST
  ? new URL(env.DATABASE_URL_TEST).pathname.slice(1)
  : null;

function sqlOn(db, query) {
  const r = spawnSync(
    'docker',
    ['exec', DB_CONTAINER, 'psql', '-U', 'postgres', '-d', db, '-tAc', query],
    { encoding: 'utf8' },
  );
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}`);
  return r.stdout.trim();
}
const sql = (query) => sqlOn(DB_NAME, query);
function run(cmd, args, opts = {}) {
  return spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32' && cmd === 'pnpm',
    windowsHide: true,
    env: { ...process.env, ...(opts.env ?? {}) },
    maxBuffer: 64 * 1024 * 1024,
    ...opts,
  });
}
function assert(cond, message) {
  if (!cond) throw new Error(message);
}
const portOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });

// Processes are started with an IPC channel and the shutdown preload so they can be
// stopped gracefully (see scripts/smoke/ipc-shutdown.mjs).
const children = [];
function start(name, args, cwd, childEnv = env) {
  const file = path.join(OUT, `${name}.log`);
  const fd = fs.openSync(file, 'w');
  const child = spawn(process.execPath, ['--import', PRELOAD, ...args], {
    cwd,
    env: childEnv,
    stdio: ['ignore', fd, fd, 'ipc'],
    windowsHide: true,
  });
  const entry = { name, child, file, exit: null };
  entry.exited = new Promise((resolve) =>
    child.on('exit', (code, signal) => {
      entry.exit = { code, signal };
      resolve(entry.exit);
    }),
  );
  children.push(entry);
  return entry;
}
async function stopGracefully(entry, timeoutMs = 30_000) {
  if (entry.exit) return entry.exit;
  entry.child.send('smoke:shutdown');
  const outcome = await Promise.race([entry.exited, sleep(timeoutMs).then(() => null)]);
  if (outcome) return outcome;
  spawnSync('taskkill', ['/PID', String(entry.child.pid), '/T', '/F']);
  await entry.exited;
  return { code: 'killed after timeout', signal: null };
}
function forceStopAll() {
  for (const { child, exit } of children) {
    if (exit || child.exitCode !== null) continue;
    if (process.platform === 'win32')
      spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
    else child.kill('SIGKILL');
  }
}
async function waitFor(url, timeoutMs, ok = (r) => r.ok) {
  const t0 = Date.now();
  let last = '';
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(url);
      if (ok(r)) return r;
      last = `status ${r.status}`;
    } catch (e) {
      last = e.message;
    }
    await sleep(1000);
  }
  throw new Error(`timeout waiting for ${url} (${last})`);
}

// Every secret the run handles; none may appear in logs, client bundles or non-auth responses.
const secrets = [PASSWORD, NEW_PASSWORD, CANARY, FAKE_SECRET, SECRET_MD5];
const keep = (...values) => {
  for (const v of values) if (typeof v === 'string' && v.length >= 8) secrets.push(v);
  return values[0];
};
const captured = [];
const ACCESS_REFRESH_MS = 10 * 60 * 1000;

/** Accounts carry their own access / refresh tokens (mobile client) and refresh when old. */
async function bearer(account) {
  if (typeof account === 'string') return account;
  if (account.refreshToken && Date.now() - account.issuedAt > ACCESS_REFRESH_MS) {
    const r = await rawCall(API, 'POST', '/auth/refresh', {
      body: { refreshToken: account.refreshToken },
    });
    assert(r.status === 200, `refresh of ${account.email} failed: ${r.status}`);
    adopt(account, r.body);
  }
  return account.token;
}
function adopt(account, session) {
  account.token = keep(session.accessToken);
  if (session.refreshToken) account.refreshToken = keep(session.refreshToken);
  account.issuedAt = Date.now();
  return account;
}
async function rawCall(
  base,
  method,
  pathname,
  { token, body, formData, headers: extra, raw = false } = {},
) {
  const headers = { accept: 'application/json', origin: WEB_ORIGIN, ...(extra ?? {}) };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (token) headers.authorization = `Bearer ${await bearer(token)}`;
  const res = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: body !== undefined ? (typeof body === 'string' ? body : JSON.stringify(body)) : formData,
    redirect: 'manual',
  });
  if (raw)
    return {
      status: res.status,
      buffer: Buffer.from(await res.arrayBuffer()),
      headers: res.headers,
    };
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  // Auth responses carry the caller's own tokens, a quote its own signed token and the checkout
  // the gateway form hash meant for the browser; no other response may contain any secret.
  if (
    base === API &&
    res.status < 400 &&
    text &&
    !pathname.startsWith('/auth/') &&
    !/\/quote\?/.test(pathname) &&
    !pathname.endsWith('/payments/checkout')
  )
    captured.push({ pathname, text });
  return { status: res.status, body: json, raw: text, headers: res.headers };
}
const call = (method, pathname, opts) => rawCall(API, method, pathname, opts);
async function form(pathnameOrUrl, fields, { redirect = 'follow' } = {}) {
  const url = pathnameOrUrl.startsWith('http') ? pathnameOrUrl : `${API}${pathnameOrUrl}`;
  const res = await fetch(url, {
    method: 'POST',
    redirect,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'text/html,application/json',
    },
    body: new URLSearchParams(fields).toString(),
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = undefined;
  }
  return { status: res.status, body: json, raw: text, location: res.headers.get('location') };
}
function expectStatus(res, status, what) {
  const ok = Array.isArray(status) ? status.includes(res.status) : res.status === status;
  assert(
    ok,
    `${what}: expected ${status}, got ${res.status} ${JSON.stringify(res.body)?.slice(0, 300)}`,
  );
  return res.body;
}
async function mailsFor(to) {
  const r = await fetch(`${MAILPIT}/search?query=${encodeURIComponent(`to:"${to}"`)}&limit=200`);
  return (await r.json()).messages ?? [];
}
async function mailFor(to, subjectPart, timeoutMs = 45_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const hit = (await mailsFor(to)).find((m) => m.Subject.includes(subjectPart));
    if (hit) return (await fetch(`${MAILPIT}/message/${hit.ID}`)).json();
    await sleep(1000);
  }
  throw new Error(
    `no e-mail to ${to} with subject containing "${subjectPart}" within ${timeoutMs / 1000}s`,
  );
}

// RFC 6238 TOTP (SHA-1, 30 s, 6 digits), the parameters the API advertises.
function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of input.replace(/=+$/, '').toUpperCase()) {
    const i = alphabet.indexOf(c);
    if (i < 0) continue;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const o = h[h.length - 1] & 15;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}
// The replay guard accepts each 30-second step once; use the next unused step inside the window.
const usedSteps = new Map();
async function freshCode(secret) {
  for (;;) {
    const now = Math.floor(Date.now() / 30_000);
    const candidate = Math.max((usedSteps.get(secret) ?? -1) + 1, now - 1);
    if (candidate <= now + 1) {
      usedSteps.set(secret, candidate);
      return totp(secret, candidate);
    }
    await sleep((now + 1) * 30_000 - Date.now() + 100);
  }
}
const staleCode = (secret) => totp(secret, Math.floor(Date.now() / 30_000) - 6);

const runUserIds = [];
const emails = [];
async function login(email, password = PASSWORD) {
  const r = await call('POST', '/auth/login', { body: { email, password, client: 'mobile' } });
  return r;
}
async function newVerifiedUser(label, fullName = `Smoke ${label}`) {
  const email = `smoke-p10-${label}-${RUN}@example.com`;
  emails.push(email);
  const reg = await call('POST', '/auth/register', {
    body: { fullName, email, password: PASSWORD, acceptTerms: true },
  });
  assert(reg.status === 201, `register ${label}: ${reg.status} ${JSON.stringify(reg.body)}`);
  const mail = await mailFor(email, 'Verify your email');
  const token = /token=([A-Za-z0-9._~-]+)/.exec(mail.Text ?? '')?.[1];
  assert(token, `verification token not found in e-mail to ${email}`);
  keep(token);
  expectStatus(
    await call('POST', '/auth/email/verify', { body: { token } }),
    200,
    `verify ${label}`,
  );
  const session = expectStatus(await login(email), 200, `login ${label}`);
  runUserIds.push(session.user.id);
  return adopt({ email, userId: session.user.id, fullName, label }, session);
}
function grant(email, role) {
  const r = run('pnpm', ['admin:grant', '--email', email, '--role', role], { env });
  assert(r.status === 0, `admin:grant failed: ${r.stdout}\n${r.stderr}`);
}
async function enrolMfa(account) {
  const start = expectStatus(
    await call('POST', '/auth/mfa/enrol/start', { token: account, body: { password: PASSWORD } }),
    200,
    'enrol start',
  );
  keep(start.secret, start.otpauthUrl);
  const confirm = expectStatus(
    await call('POST', '/auth/mfa/enrol/confirm', {
      token: account,
      body: { code: await freshCode(start.secret) },
    }),
    200,
    'enrol confirm',
  );
  account.totpSecret = start.secret;
  account.recoveryCodes = confirm.recoveryCodes;
  keep(...confirm.recoveryCodes);
  // The enrolling session is upgraded; its refresh token stays the same.
  account.token = keep(confirm.session.accessToken);
  account.issuedAt = Date.now();
  return account;
}
async function mfaLogin(account, password = PASSWORD) {
  const first = expectStatus(await login(account.email, password), 200, 'admin password step');
  assert(first.mfaRequired === true && !first.accessToken, 'MFA challenge expected');
  keep(first.challengeToken);
  const done = expectStatus(
    await call('POST', '/auth/mfa/challenge', {
      body: { challengeToken: first.challengeToken, code: await freshCode(account.totpSecret) },
    }),
    200,
    'MFA challenge',
  );
  return adopt(account, done);
}

function colombo(days) {
  const shifted = new Date(Date.now() + 5.5 * 3_600_000);
  const d = new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + days),
  );
  return `${d.toISOString().slice(0, 10)}T00:00:00+05:30`;
}
const todayColombo = () => colombo(0).slice(0, 10);
const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const q = (params) =>
  new URLSearchParams(
    Object.entries(params)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  ).toString();
const sharp = apiRequire('sharp');
const { PgBoss } = apiRequire('pg-boss');
async function testImage({ width = 1200, height = 900, format = 'jpeg' } = {}) {
  const img = sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 110, b: 190 } },
  });
  return format === 'png' ? img.png().toBuffer() : img.jpeg({ quality: 85 }).toBuffer();
}
async function uploadPhoto(
  account,
  vehicleId,
  buffer,
  filename = 'photo.jpg',
  type = 'image/jpeg',
) {
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type }), filename);
  return call('POST', `/providers/me/vehicles/${vehicleId}/photos`, {
    token: account,
    formData: fd,
  });
}
const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
async function uploadDocument(
  account,
  fields,
  buffer,
  filename = 'doc.pdf',
  type = 'application/pdf',
) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([buffer], { type }), filename);
  return call('POST', '/providers/me/documents', { token: account, formData: fd });
}
const DRIVER = {
  fullName: 'Nimal Perera',
  countryCode: 'LK',
  licenceCountry: 'LK',
  licenceExpiresOn: '2031-12-31',
};
async function quote(vehicleId, startsAt, endsAt) {
  return expectStatus(
    await call('GET', `/vehicles/${vehicleId}/quote?${q({ startsAt, endsAt })}`),
    200,
    'quote',
  );
}
const runBookingIds = [];
async function requestBooking(customer, vehicleId, startsAt, endsAt, extra = {}) {
  const qt = await quote(vehicleId, startsAt, endsAt);
  assert(qt.bookable && qt.quoteToken, `window not bookable: ${qt.reasons?.join(', ')}`);
  keep(qt.quoteToken);
  const res = await call('POST', '/bookings', {
    token: customer,
    headers: { 'idempotency-key': randomUUID() },
    body: { vehicleId, startsAt, endsAt, quoteToken: qt.quoteToken, driver: DRIVER, ...extra },
  });
  const b = expectStatus(res, 201, 'create booking');
  runBookingIds.push(b.id);
  return Object.assign(b, { quote: qt });
}
const providerAction = (account, id, action, body) =>
  call('POST', `/providers/me/bookings/${id}/${action}`, { token: account, body });
const holdsOf = (bookingId) =>
  Number(
    sql(
      `select count(*) from vehicle_holds where booking_id = '${bookingId}' and kind = 'booking'`,
    ),
  );
const bookingStatus = (id) => sql(`select status from bookings where id = '${id}'`);
async function checkout(account, bookingId) {
  const res = await call('POST', `/bookings/${bookingId}/payments/checkout`, {
    token: account,
    body: {},
  });
  if (res.status === 200) keep(res.body.fields.hash);
  return res;
}
function notification({
  orderId,
  amount,
  statusCode = '2',
  paymentId,
  currency = 'LKR',
  secretMd5 = SECRET_MD5,
}) {
  const f = {
    merchant_id: FAKE_MERCHANT,
    order_id: orderId,
    payment_id: paymentId ?? `SMK${Date.now()}${Math.floor(Math.random() * 10_000)}`,
    payhere_amount: amount,
    payhere_currency: currency,
    status_code: statusCode,
    method: 'VISA',
    status_message: 'Smoke notification.',
  };
  f.md5sig = md5(
    f.merchant_id + f.order_id + f.payhere_amount + f.payhere_currency + f.status_code + secretMd5,
  );
  keep(f.md5sig);
  return f;
}
const notify = (fields) => form('/payments/payhere/notify', fields);
const fakeComplete = (session, outcome) =>
  form(
    '/payments/fake/complete',
    {
      order_id: session.fields.order_id,
      amount: session.fields.amount,
      currency: session.fields.currency,
      return_url: session.fields.return_url,
      cancel_url: session.fields.cancel_url,
      outcome,
    },
    { redirect: 'manual' },
  );
async function waitForStatus(id, status, timeoutMs = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (bookingStatus(id) === status) return;
    await sleep(250);
  }
  throw new Error(`booking ${id} is ${bookingStatus(id)}, expected ${status}`);
}
async function payAdvance(customer, bookingId) {
  const session = expectStatus(await checkout(customer, bookingId), 200, 'checkout');
  const done = await fakeComplete(session, 'success');
  assert(done.status === 303, `fake complete ${done.status}`);
  await waitForStatus(bookingId, 'confirmed');
  return session;
}
const versionOf = (id) => Number(sql(`select version from bookings where id = '${id}'`));
async function completedBooking(customer, vehicleId, from, to) {
  const b = await requestBooking(customer, vehicleId, colombo(from), colombo(to));
  expectStatus(await providerAction(ctx.provider, b.id, 'accept', { version: 1 }), 200, 'accept');
  await payAdvance(customer, b.id);
  expectStatus(
    await providerAction(ctx.provider, b.id, 'pickup', {
      version: versionOf(b.id),
      odometerKm: 1000,
      fuelLevel: 6,
    }),
    200,
    'pickup',
  );
  return expectStatus(
    await providerAction(ctx.provider, b.id, 'return', {
      version: versionOf(b.id),
      odometerKm: 1300,
      fuelLevel: 5,
    }),
    200,
    'return',
  );
}
const feed = async (account) =>
  expectStatus(await call('GET', '/notifications?limit=50', { token: account }), 200, 'feed').data;
const admin = (method, p, body) =>
  call(method, p, { token: ctx.admin, ...(body !== undefined ? { body } : {}) });
const superAdmin = (method, p, body) =>
  call(method, p, { token: ctx.superAdmin, ...(body !== undefined ? { body } : {}) });
const search = async (params) =>
  expectStatus(await call('GET', `/vehicles/search?${q({ limit: 50, ...params })}`), 200, 'search');
const jobsDone = (name) =>
  Number(
    sql(
      `select count(*) from ${env.PGBOSS_SCHEMA || 'pgboss'}.job where name = '${name}' and state = 'completed' and created_on > '${ctx.runStartedAt}'::timestamptz`,
    ),
  );
async function waitForJobs(name, target, timeoutMs = 120_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (jobsDone(name) >= target) return jobsDone(name);
    await sleep(1000);
  }
  throw new Error(
    `no ${name} job completed within ${timeoutMs / 1000}s (completed=${jobsDone(name)}, target=${target})`,
  );
}
let boss;
async function enqueue(name) {
  if (!boss) {
    boss = new PgBoss({
      connectionString: env.DATABASE_URL,
      schema: env.PGBOSS_SCHEMA || 'pgboss',
      supervise: false,
      schedule: false,
      max: 1,
    });
    await boss.start();
  }
  const before = jobsDone(name);
  await boss.send(name, {});
  return waitForJobs(name, before + 1, 90_000);
}
const overview = async () =>
  expectStatus(
    await admin(
      'GET',
      `/admin/reports/overview?${q({ from: todayColombo(), to: todayColombo() })}`,
    ),
    200,
    'overview report',
  );
const cents = (s) => Math.round(Number(s) * 100);
const money = (c) => (c / 100).toFixed(2);
const inList = (ids) => ids.map((id) => `'${id}'`).join(',');

const results = [];
async function step(no, title, fn) {
  try {
    const detail = await fn();
    results.push({ no, title, ok: true });
    log(
      `PASS ${no}. ${title}${detail ? `\n      ${String(detail).replace(/\n/g, '\n      ')}` : ''}`,
    );
  } catch (e) {
    results.push({ no, title, ok: false });
    log(`FAIL ${no}. ${title}\n      ${e.message}`);
  }
}

// ------------------------------------------------- synthetic production config

const esc = (pem) => pem.trim().replace(/\n/g, '\\n');
const probeKeys = generateKeyPairSync('ed25519');
const SAFE_PRODUCTION = {
  NODE_ENV: 'production',
  LAUNCH_MODE: 'production',
  TRUST_PROXY_HOPS: '1',
  DATABASE_URL: `postgresql://vrp:${randomBytes(12).toString('hex')}@db.smoke.invalid:5432/vrp`,
  CORS_ORIGINS: 'https://app.smoke.invalid',
  WEB_APP_URL: 'https://app.smoke.invalid',
  API_PUBLIC_URL: 'https://api.smoke.invalid/api/v1',
  JWT_PRIVATE_KEY: esc(probeKeys.privateKey.export({ type: 'pkcs8', format: 'pem' })),
  JWT_PUBLIC_KEY: esc(probeKeys.publicKey.export({ type: 'spki', format: 'pem' })),
  BOOKING_QUOTE_SECRET: randomBytes(32).toString('hex'),
  APP_DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  EMAIL_PROVIDER: 'smtp',
  EMAIL_FROM: 'Rentals <no-reply@smoke.invalid>',
  SMTP_HOST: 'smtp.smoke.invalid',
  SMTP_PORT: '587',
  SMTP_USER: 'smoke',
  SMTP_PASS: randomBytes(12).toString('hex'),
  STORAGE_PROVIDER: 's3',
  STORAGE_ENDPOINT: 'https://storage.smoke.invalid',
  STORAGE_ACCESS_KEY: `smoke-${randomBytes(6).toString('hex')}`,
  STORAGE_SECRET_KEY: randomBytes(20).toString('hex'),
  STORAGE_PUBLIC_URL: 'https://img.smoke.invalid',
  PAYMENT_GATEWAY: 'payhere',
  PAYHERE_ENVIRONMENT: 'live',
  PAYHERE_MERCHANT_ID: '1000000',
  PAYHERE_MERCHANT_SECRET: randomBytes(16).toString('hex'),
  PAYHERE_NOTIFY_URL: 'https://api.smoke.invalid/api/v1/payments/payhere/notify',
};
for (const k of [
  'JWT_PRIVATE_KEY',
  'BOOKING_QUOTE_SECRET',
  'APP_DATA_ENCRYPTION_KEY',
  'SMTP_PASS',
  'STORAGE_SECRET_KEY',
  'PAYHERE_MERCHANT_SECRET',
])
  keep(SAFE_PRODUCTION[k]);
const DEV_ENCRYPTION_KEY = 'dnJwLWxvY2FsLWRldmVsb3BtZW50LWtleS0zMmJ5dGU=';

/** Runs the built checker's config rules on a variant (pure function, prints nothing). */
function checkConfig(overrides) {
  const { configChecks } = apiRequire('./dist/cli/production-check.js');
  const values = { ...SAFE_PRODUCTION, ...overrides };
  for (const [k, v] of Object.entries(overrides)) if (v === undefined) delete values[k];
  return configChecks(values).checks;
}
function expectConfigFailure(overrides, pattern) {
  const failures = checkConfig(overrides).filter((c) => c.level === 'FAIL');
  assert(failures.length > 0, `accepted: ${JSON.stringify(Object.keys(overrides))}`);
  assert(
    failures.some((c) => pattern.test(`${c.name} ${c.message}`)),
    `failure messages ${failures.map((c) => c.message).join(' | ')} do not match ${pattern}`,
  );
  return failures.length;
}

// ===================================================================== run

const ctx = {};
try {
  log(`[setup] output in ${path.relative(ROOT, OUT)}`);
  for (const [file, what] of [
    ['apps/api/dist/main.js', 'API build'],
    ['apps/api/dist/worker.js', 'worker build'],
    ['apps/api/dist/cli/production-check.js', 'production checker build'],
    ['apps/web/.next/BUILD_ID', 'web build'],
  ])
    assert(fs.existsSync(path.join(ROOT, file)), `${what} missing (${file}): run pnpm build first`);
  for (const port of [API_PORT, PROBE_PORT, WEB_PORT])
    assert(
      !(await portOpen(port)),
      `port ${port} is already in use: stop the running dev servers first`,
    );
  for (const url of [`${MAILPIT}/info`, `${MINIO}/minio/health/live`])
    await waitFor(url, 10_000).catch(() => {
      throw new Error(`${url} is not reachable: run pnpm db:up`);
    });
  ctx.pgClientsBefore = Number(
    sql(
      `select count(*) from pg_stat_activity where datname = '${DB_NAME}' and application_name = 'postgres.js'`,
    ),
  );

  // ------------------------------------------------ 1–5 baseline / migrations
  const journal = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'packages/database/drizzle/meta/_journal.json'), 'utf8'),
  ).entries;
  await step(1, 'HEAD is the approved Phase 9 checkpoint', async () => {
    const head = run('git', ['log', '-1', '--format=%h %s']).stdout.trim();
    assert(
      head.startsWith(BASELINE_COMMIT) && /phase 9/i.test(head),
      `HEAD is ${head}, expected ${BASELINE_COMMIT} (Phase 9)`,
    );
    return `HEAD ${head}`;
  });
  await step(2, 'Phase 10 work is uncommitted in the working tree', async () => {
    const entries = run('git', ['status', '--porcelain']).stdout.split('\n').filter(Boolean);
    assert(entries.length > 0, 'working tree is clean');
    for (const f of [
      'packages/database/drizzle/0020_production_readiness.sql',
      'scripts/smoke-phase10.mjs',
    ])
      assert(
        entries.some((e) => e.endsWith(f) || f.startsWith(e.slice(3))),
        `${f} not among the uncommitted entries`,
      );
    const ahead = run('git', ['rev-list', '--count', `${BASELINE_COMMIT}..HEAD`]).stdout.trim();
    assert(ahead === '0', `${ahead} commit(s) on top of the baseline`);
    return `${entries.length} uncommitted entries, no commit on top of ${BASELINE_COMMIT}`;
  });
  await step(3, 'Phase 10 migrations applied (journal = applied, 0020/0021 present)', async () => {
    const tags = journal.map((e) => e.tag);
    assert(
      tags.includes('0020_production_readiness') &&
        tags.includes('0021_production_readiness_triggers'),
      `journal ${tags.slice(-3)}`,
    );
    const applied = sql(
      "select count(*) || '|' || max(created_at) from drizzle.__drizzle_migrations",
    ).split('|');
    assert(
      Number(applied[0]) === journal.length,
      `applied ${applied[0]} vs journal ${journal.length}`,
    );
    assert(
      Number(applied[1]) === journal.at(-1).when,
      `last applied ${applied[1]} vs journal ${journal.at(-1).when}`,
    );
    return `${journal.length} migrations in the journal, ${applied[0]} applied on ${DB_NAME}; last ${journal.at(-1).tag}`;
  });
  await step(4, 'dev and test databases are at the same migration count', async () => {
    assert(TEST_DB_NAME, 'DATABASE_URL_TEST is not set');
    const dev = Number(sql('select count(*) from drizzle.__drizzle_migrations'));
    const test = Number(sqlOn(TEST_DB_NAME, 'select count(*) from drizzle.__drizzle_migrations'));
    assert(
      dev === journal.length && test === journal.length,
      `dev ${dev}, test ${test}, journal ${journal.length}`,
    );
    return `${DB_NAME}: ${dev}; ${TEST_DB_NAME}: ${test}`;
  });
  await step(5, 'core tables and constraints present', async () => {
    const tables = [
      'users',
      'refresh_tokens',
      'user_mfa',
      'privacy_requests',
      'vehicles',
      'vehicle_holds',
      'bookings',
      'payments',
      'payment_events',
      'reviews',
      'disputes',
      'verification_documents',
      'audit_events',
      'search_logs',
    ];
    const present = sql(
      `select string_agg(table_name, ',') from information_schema.tables where table_schema = 'public' and table_name in (${inList(tables)})`,
    ).split(',');
    const missing = tables.filter((t) => !present.includes(t));
    assert(missing.length === 0, `missing tables ${missing}`);
    const exclusion = sql(
      `select count(*) from pg_constraint where contype = 'x' and conrelid = 'vehicle_holds'::regclass`,
    );
    assert(Number(exclusion) >= 1, 'vehicle_holds exclusion constraint missing');
    const gatewayUnique = sql(
      `select count(*) from pg_indexes where tablename = 'payments' and indexdef ilike '%unique%gateway%gateway_payment_id%'`,
    );
    assert(
      Number(gatewayUnique) >= 1,
      'payments (gateway, gateway_payment_id) unique index missing',
    );
    const family = sql(
      `select count(*) from pg_indexes where tablename = 'refresh_tokens' and indexname = 'refresh_tokens_family_id_idx'`,
    );
    assert(family === '1', 'refresh_tokens family index missing');
    const appendOnly = sql(
      `select count(*) from pg_trigger where tgname = 'dispute_messages_append_only'`,
    );
    assert(appendOnly === '1', 'append-only trigger missing');
    return `${tables.length} tables; holds exclusion constraint; unique gateway payment id; refresh family index; append-only dispute messages`;
  });

  // ---------------------------------------------- 6–12 production configuration
  await step(6, 'unsafe production configuration rejected', async () => {
    const n =
      expectConfigFailure({ ADMIN_MFA_REQUIRED: 'false' }, /admin MFA cannot be disabled/) +
      expectConfigFailure({ COOKIE_SECURE: 'false' }, /Secure/) +
      expectConfigFailure({ OPENAPI_ENABLED: 'true' }, /Swagger UI is not served/) +
      expectConfigFailure({ SMTP_HOST: 'localhost' }, /SMTP_HOST/);
    return `MFA off, insecure cookie, public Swagger and a local SMTP host each FAIL (${n} failing checks)`;
  });
  await step(7, 'fake payment gateway rejected in production', async () => {
    expectConfigFailure({ PAYMENT_GATEWAY: 'fake' }, /fake payment gateway/);
    expectConfigFailure(
      { PAYHERE_ENVIRONMENT: 'sandbox' },
      /LAUNCH_MODE=production requires the live/,
    );
    return 'PAYMENT_GATEWAY=fake and a sandbox PayHere at LAUNCH_MODE=production both FAIL';
  });
  await step(8, 'localhost object storage rejected in production', async () => {
    expectConfigFailure({ STORAGE_ENDPOINT: 'http://localhost:9000' }, /STORAGE_ENDPOINT/);
    expectConfigFailure(
      { STORAGE_PUBLIC_URL: 'http://localhost:9000/vrp-public' },
      /STORAGE_PUBLIC_URL/,
    );
    expectConfigFailure({ STORAGE_ACCESS_KEY: 'minioadmin' }, /object-storage credentials/);
    return 'MinIO endpoint, local public URL and minioadmin credentials FAIL';
  });
  await step(9, 'weak / default encryption secret rejected', async () => {
    expectConfigFailure(
      { APP_DATA_ENCRYPTION_KEY: DEV_ENCRYPTION_KEY },
      /development key is refused/,
    );
    expectConfigFailure({ APP_DATA_ENCRYPTION_KEY: 'too-short' }, /32-byte key/);
    expectConfigFailure(
      { APP_DATA_ENCRYPTION_KEY: undefined },
      /APP_DATA_ENCRYPTION_KEY is required/,
    );
    return 'documented dev key, a short key and a missing key FAIL';
  });
  await step(10, 'unsafe CORS rejected', async () => {
    expectConfigFailure({ CORS_ORIGINS: '*' }, /CORS_ORIGINS/);
    expectConfigFailure(
      { CORS_ORIGINS: 'https://app.smoke.invalid,http://localhost:3000' },
      /CORS_ORIGINS/,
    );
    return "'*' and a localhost origin FAIL";
  });
  await step(11, 'insecure public HTTP URLs rejected where HTTPS is required', async () => {
    expectConfigFailure({ WEB_APP_URL: 'http://app.smoke.invalid' }, /WEB_APP_URL/);
    expectConfigFailure({ API_PUBLIC_URL: 'http://api.smoke.invalid/api/v1' }, /API_PUBLIC_URL/);
    expectConfigFailure(
      { PAYHERE_NOTIFY_URL: 'http://api.smoke.invalid/notify' },
      /PAYHERE_NOTIFY_URL/,
    );
    return 'http:// web, API and PayHere notify URLs FAIL';
  });
  await step(
    12,
    'safe synthetic production-like config accepted (no vendor contacted)',
    async () => {
      const config = checkConfig({});
      const failing = config.filter((c) => c.level === 'FAIL');
      assert(
        failing.length === 0,
        `config FAILs: ${failing.map((c) => `${c.name}: ${c.message}`).join(' | ')}`,
      );
      const file = path.join(OUT, 'synthetic-production.env');
      fs.writeFileSync(
        file,
        Object.entries(SAFE_PRODUCTION)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n') + '\n',
        { mode: 0o600 },
      );
      const cli = run('pnpm', ['production:check', '--env-file', file, '--json'], { env: {} });
      fs.rmSync(file, { force: true });
      const report = JSON.parse(
        cli.stderr.slice(cli.stderr.indexOf('{'), cli.stderr.lastIndexOf('}') + 1),
      );
      const configFails = report.checks.filter((c) => c.area === 'config' && c.level === 'FAIL');
      const otherFails = report.checks.filter((c) => c.level === 'FAIL' && c.area !== 'legal');
      assert(
        configFails.length === 0 && otherFails.length === 0,
        `non-legal FAILs ${JSON.stringify(otherFails)}`,
      );
      const legal = report.checks
        .filter((c) => c.area === 'legal' && c.level === 'FAIL')
        .map((c) => c.name);
      assert(
        cli.status === (legal.length ? 1 : 0),
        `exit ${cli.status} with ${legal.length} legal FAILs`,
      );
      const printed = cli.stdout + cli.stderr;
      for (const k of [
        'BOOKING_QUOTE_SECRET',
        'APP_DATA_ENCRYPTION_KEY',
        'SMTP_PASS',
        'STORAGE_SECRET_KEY',
        'PAYHERE_MERCHANT_SECRET',
      ])
        assert(!printed.includes(SAFE_PRODUCTION[k]), `checker printed the value of ${k}`);
      return `config: ${config.filter((c) => c.level === 'PASS').length} PASS / ${config.filter((c) => c.level === 'WARN').length} WARN / 0 FAIL; pnpm production:check exit ${cli.status} solely because the legal drafts are unapproved (${legal.join(', ')} — external legal gate); no value printed`;
    },
  );

  // ------------------------------------------------------------ start the stack
  log('[setup] starting built API, worker, web (next start) and the production-mode probe API…');
  ctx.api = start('api', ['dist/main.js'], path.join(ROOT, 'apps/api'));
  ctx.worker = start('worker', ['dist/worker.js'], path.join(ROOT, 'apps/api'));
  ctx.web = start(
    'web',
    ['node_modules/next/dist/bin/next', 'start', '--port', String(WEB_PORT)],
    path.join(ROOT, 'apps/web'),
  );
  ctx.probe = start('probe', ['dist/main.js'], path.join(ROOT, 'apps/api'), {
    ...process.env,
    ...SAFE_PRODUCTION,
    DATABASE_URL: env.DATABASE_URL,
    API_PORT: String(PROBE_PORT),
    LOG_LEVEL: 'info',
    PGBOSS_SCHEMA: env.PGBOSS_SCHEMA || 'pgboss',
    SERVICE_NAME: 'api-probe',
  });
  await waitFor(`${API}/health`, 90_000);
  const ready = await waitFor(`${API}/ready`, 60_000);
  log(`[setup] API ready: ${JSON.stringify(await ready.json())}`);
  await waitFor(`${PROBE}/health`, 90_000);
  await waitFor(`${WEB}/`, 120_000);
  log('[setup] web and production-mode probe up');
  ctx.runStartedAt = sql('select now()');

  log('[setup] creating accounts, providers and vehicles…');
  ctx.adminUser = await newVerifiedUser('admin');
  ctx.superUser = await newVerifiedUser('super');
  grant(ctx.adminUser.email, 'admin');
  grant(ctx.superUser.email, 'super_admin');
  // Fresh sessions carry the new roles; until the factor is set up admin routes refuse them.
  for (const u of [ctx.adminUser, ctx.superUser])
    adopt(u, expectStatus(await login(u.email), 200, 'admin login'));
  ctx.preMfaAdminRoute = await call('GET', '/admin/overview', { token: ctx.superUser });
  ctx.admin = await enrolMfa(ctx.adminUser);
  ctx.superAdmin = await enrolMfa(ctx.superUser);
  const places = expectStatus(
    await call('GET', '/reference/places?districtId=matara'),
    200,
    'places',
  );
  ctx.mirissa = places.find((p) => p.slug === 'mirissa');
  async function approvedProvider(label, displayName) {
    const user = await newVerifiedUser(label);
    expectStatus(
      await call('PUT', '/providers/me/application', {
        token: user,
        body: {
          displayName,
          providerType: 'individual',
          contactName: `Smoke ${label}`,
          phone: '+94771234567',
          addressText: '12 Beach Road, Mirissa',
          districtId: 'matara',
          primaryPlaceId: ctx.mirissa.id,
          description:
            'Smoke-test rental business serving Mirissa and Weligama with cars and vans.',
          vehicleCategoryIds: ['car'],
        },
      }),
      200,
      `${label} draft`,
    );
    const application = expectStatus(
      await call('POST', '/providers/me/application/submit', {
        token: user,
        body: { acceptProviderAgreement: true },
      }),
      200,
      `${label} submit`,
    );
    expectStatus(
      await admin('POST', `/admin/provider-applications/${application.id}/approve`, {}),
      200,
      `${label} approve`,
    );
    const profile = expectStatus(
      await call('GET', '/providers/me', { token: user }),
      200,
      `${label} profile`,
    );
    const location = expectStatus(
      await call('POST', '/providers/me/locations', {
        token: user,
        body: {
          name: `${displayName} office`,
          districtId: 'matara',
          placeId: ctx.mirissa.id,
          addressText: '12 Beach Road, Mirissa 81740',
          point: { lat: 5.9485, lng: 80.4718 },
          pickupInstructions: 'Blue gate opposite the fish market.',
        },
      }),
      201,
      `${label} location`,
    );
    return Object.assign(user, { providerId: profile.id, locationId: location.id, displayName });
  }
  async function approvedVehicle(owner, plateSuffix, title) {
    const v = expectStatus(
      await call('POST', '/providers/me/vehicles', {
        token: owner,
        body: {
          categoryId: 'car',
          locationId: owner.locationId,
          title,
          make: 'Toyota',
          model: 'Aqua',
          modelYear: 2018,
          transmission: 'automatic',
          fuelType: 'hybrid',
          seats: 5,
          doors: 5,
          engineCc: 1500,
          hasAc: true,
          color: 'White',
          registrationNumber: `CAB-${plateSuffix}`,
          description: 'Clean, well-serviced hybrid hatchback ideal for the coast road.',
          dailyRate: '7500',
          weeklyRate: '45000',
          monthlyRate: '150000',
          securityDeposit: '25000',
          includedKmPerDay: 100,
          extraKmRate: '40',
          minRentalDays: 1,
          maxRentalDays: 30,
          minRenterAge: 21,
          minLicenceYears: 1,
          fuelPolicy: 'full_to_full',
          deliveryAvailable: true,
          deliveryFee: '1500',
          pickupNotes: 'Pickup from 8am.',
        },
      }),
      201,
      'create vehicle',
    );
    for (const [i, opts] of [
      { width: 1600, height: 1200 },
      { width: 1200, height: 900 },
      { width: 1000, height: 750 },
    ].entries())
      expectStatus(
        await uploadPhoto(owner, v.id, await testImage(opts), `photo-${i}.jpg`),
        201,
        `upload ${i}`,
      );
    expectStatus(
      await call('POST', `/providers/me/vehicles/${v.id}/submit`, { token: owner, body: {} }),
      200,
      'submit',
    );
    const approved = expectStatus(
      await admin('POST', `/admin/vehicles/${v.id}/approve`, {}),
      200,
      'approve',
    );
    return { id: v.id, slug: approved.slug, plate: v.registrationNumber };
  }
  ctx.provider = await approvedProvider('provider', `Smoke Motors ${RUN}`);
  ctx.other = await approvedProvider('other', `=HYPERLINK("http://evil") Fleet ${RUN}`);
  ctx.vehicle = await approvedVehicle(
    ctx.provider,
    String(Date.now()).slice(-4),
    `Toyota Aqua 2018 smoke ${RUN}`,
  );
  ctx.vehicle2 = await approvedVehicle(
    ctx.other,
    String(Date.now() + 7).slice(-4),
    `Other Aqua smoke ${RUN}`,
  );
  ctx.customer = await newVerifiedUser('customer', 'Nimal Perera');
  ctx.customerB = await newVerifiedUser('customerB', 'Kamala Silva');
  ctx.customerC = await newVerifiedUser('customerC', 'Ravi Fernando');
  ctx.reportBefore = await overview();

  // ------------------------------------------------------- 13–30 authentication
  await step(13, 'customer login', async () => {
    const r = expectStatus(await login(ctx.customer.email), 200, 'customer login');
    assert(
      r.accessToken && r.refreshToken && r.user.roles.join() === 'customer',
      JSON.stringify(r.user.roles),
    );
    adopt(ctx.customer, r);
    expectStatus(await call('GET', '/users/me', { token: ctx.customer }), 200, 'me');
    return 'session issued (bearer + mobile refresh token); /users/me → 200';
  });
  await step(14, 'provider login', async () => {
    const r = expectStatus(await login(ctx.provider.email), 200, 'provider login');
    assert(r.user.roles.includes('provider'), JSON.stringify(r.user.roles));
    adopt(ctx.provider, r);
    expectStatus(
      await call('GET', '/providers/me', { token: ctx.provider }),
      200,
      'provider profile',
    );
    return `roles ${r.user.roles.join('/')}; /providers/me → 200`;
  });
  await step(15, 'admin password step returns an MFA challenge, not a session', async () => {
    const r = expectStatus(await login(ctx.admin.email), 200, 'admin password');
    assert(
      r.mfaRequired === true && r.challengeToken && !r.accessToken && !r.refreshToken,
      JSON.stringify(Object.keys(r)),
    );
    assert(
      r.methods.includes('totp') && r.methods.includes('recovery_code'),
      JSON.stringify(r.methods),
    );
    ctx.challenge = keep(r.challengeToken);
    return `mfaRequired, methods ${r.methods.join('/')}, no tokens`;
  });
  await step(16, 'MFA challenge is required (the challenge token is not a session)', async () => {
    expectStatus(
      await call('GET', '/users/me', { token: ctx.challenge }),
      401,
      'challenge as bearer',
    );
    expectStatus(
      await call('GET', '/admin/overview', { token: ctx.challenge }),
      401,
      'challenge on admin',
    );
    return 'challenge token as bearer → 401 on /users/me and /admin/overview';
  });
  await step(17, 'valid TOTP completes the login', async () => {
    const r = expectStatus(
      await call('POST', '/auth/mfa/challenge', {
        body: { challengeToken: ctx.challenge, code: await freshCode(ctx.admin.totpSecret) },
      }),
      200,
      'challenge',
    );
    adopt(ctx.admin, r);
    expectStatus(await admin('GET', '/admin/overview'), 200, 'admin overview');
    return 'session issued; /admin/overview → 200';
  });
  await step(18, 'invalid TOTP rejected', async () => {
    const c = expectStatus(await login(ctx.admin.email), 200, 'admin password');
    keep(c.challengeToken);
    const r = await call('POST', '/auth/mfa/challenge', {
      body: { challengeToken: c.challengeToken, code: staleCode(ctx.admin.totpSecret) },
    });
    assert(
      [400, 401].includes(r.status) && r.body.error.code === 'MFA_CODE_INVALID',
      `${r.status} ${r.body?.error?.code}`,
    );
    return `${r.status} MFA_CODE_INVALID; no session`;
  });
  await step(19, 'recovery code works once', async () => {
    const c = expectStatus(await login(ctx.admin.email), 200, 'admin password');
    keep(c.challengeToken);
    ctx.usedRecovery = ctx.admin.recoveryCodes[0];
    const r = expectStatus(
      await call('POST', '/auth/mfa/recovery', {
        body: { challengeToken: c.challengeToken, recoveryCode: ctx.usedRecovery },
      }),
      200,
      'recovery',
    );
    keep(r.accessToken, r.refreshToken);
    expectStatus(
      await call('GET', '/admin/overview', { token: r.accessToken }),
      200,
      'recovered session',
    );
    const status = expectStatus(
      await call('GET', '/auth/mfa', { token: r.accessToken }),
      200,
      'status',
    );
    assert(
      status.recoveryCodesRemaining === ctx.admin.recoveryCodes.length - 1,
      JSON.stringify(status),
    );
    return `recovery session reaches admin; ${status.recoveryCodesRemaining} codes left`;
  });
  await step(20, 'recovery-code replay rejected', async () => {
    const c = expectStatus(await login(ctx.admin.email), 200, 'admin password');
    keep(c.challengeToken);
    const r = await call('POST', '/auth/mfa/recovery', {
      body: { challengeToken: c.challengeToken, recoveryCode: ctx.usedRecovery },
    });
    assert(
      [400, 401].includes(r.status) && r.body.error.code === 'MFA_CODE_INVALID',
      `${r.status} ${r.body?.error?.code}`,
    );
    return `reused code → ${r.status} MFA_CODE_INVALID`;
  });
  await step(21, 'admin routes require a verified factor', async () => {
    const r = ctx.preMfaAdminRoute;
    assert(
      r.status === 403 && r.body.error.code === 'MFA_REQUIRED',
      `${r.status} ${r.body?.error?.code}`,
    );
    return `super admin before enrolment → 403 MFA_REQUIRED (${r.body.error.details?.[0]?.issue})`;
  });
  await step(22, 'customer cannot use admin routes', async () => {
    for (const p of [
      '/admin/overview',
      '/admin/users',
      '/admin/settings',
      '/admin/audit-events',
      '/admin/system/worker',
      '/admin/privacy-requests',
    ]) {
      const r = await call('GET', p, { token: ctx.customer });
      assert(r.status === 403 && r.body.error.code === 'FORBIDDEN', `${p} → ${r.status}`);
    }
    expectStatus(await call('GET', '/admin/overview'), 401, 'anonymous');
    return '6 admin routes → 403 FORBIDDEN; anonymous → 401';
  });
  await step(23, 'provider cannot use admin routes', async () => {
    for (const p of [
      '/admin/users',
      '/admin/documents',
      '/admin/settings',
      '/admin/bookings',
      '/admin/system/worker',
    ])
      expectStatus(await call('GET', p, { token: ctx.provider }), 403, p);
    expectStatus(
      await call('POST', `/admin/vehicles/${ctx.vehicle.id}/suspend`, {
        token: ctx.provider,
        body: { reason: 'provider cannot pause listings' },
      }),
      403,
      'provider mutation',
    );
    return '5 admin reads and a mutation → 403';
  });

  ctx.pw = await newVerifiedUser('password');
  ctx.pwSecond = adopt(
    { email: ctx.pw.email },
    expectStatus(await login(ctx.pw.email), 200, 'second session'),
  );
  ctx.pwHashBefore = sql(`select password_hash from users where id = '${ctx.pw.userId}'`);
  await step(
    24,
    'password change works (204, strict body, wrong current password refused)',
    async () => {
      const wrong = await call('POST', '/users/me/password', {
        token: ctx.pw.token,
        body: { currentPassword: `${PASSWORD}x`, newPassword: NEW_PASSWORD },
      });
      assert(
        wrong.status === 400 && wrong.body.error.code === 'CURRENT_PASSWORD_INVALID',
        `${wrong.status} ${wrong.body?.error?.code}`,
      );
      const extra = await call('POST', '/users/me/password', {
        token: ctx.pw.token,
        body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD, userId: ctx.customer.userId },
      });
      assert(
        extra.status === 400 && extra.body.error.code === 'VALIDATION_ERROR',
        `extra field → ${extra.status}`,
      );
      const reuse = await call('POST', '/users/me/password', {
        token: ctx.pw.token,
        body: { currentPassword: PASSWORD, newPassword: PASSWORD },
      });
      assert(
        reuse.status === 400 && reuse.body.error.details?.[0]?.field === 'newPassword',
        `reuse → ${reuse.status}`,
      );
      const common = await call('POST', '/users/me/password', {
        token: ctx.pw.token,
        body: { currentPassword: PASSWORD, newPassword: 'password123' },
      });
      assert(
        common.status === 400 && /too common/.test(common.body.error.details?.[0]?.issue ?? ''),
        `common → ${common.status}`,
      );
      const r = await call('POST', '/users/me/password', {
        token: ctx.pw.token,
        body: { currentPassword: PASSWORD, newPassword: NEW_PASSWORD },
      });
      assert(r.status === 204 && r.raw === '', `change → ${r.status}`);
      const after = sql(`select password_hash from users where id = '${ctx.pw.userId}'`);
      assert(
        after !== ctx.pwHashBefore && after.startsWith('$argon2id$'),
        'hash not replaced with Argon2id',
      );
      keep(ctx.pwHashBefore, after);
      const audit = sql(
        `select count(*) || '|' || coalesce(max(metadata::text), '') from audit_events where action = 'user.password_changed' and target_id = '${ctx.pw.userId}'`,
      );
      assert(
        audit.startsWith('1|') && !audit.includes(PASSWORD) && !audit.includes(NEW_PASSWORD),
        `audit ${audit}`,
      );
      await mailFor(ctx.pw.email, 'password');
      return 'wrong current → 400 CURRENT_PASSWORD_INVALID; extra field / reuse / common → 400; change → 204; new Argon2id hash; audited without secrets; owner e-mailed';
    },
  );
  await step(25, 'old password rejected after the change', async () => {
    const r = await login(ctx.pw.email, PASSWORD);
    assert(r.status === 401 && r.body.error.code === 'INVALID_CREDENTIALS', `${r.status}`);
    return '401 INVALID_CREDENTIALS';
  });
  await step(26, 'new password accepted', async () => {
    const r = expectStatus(await login(ctx.pw.email, NEW_PASSWORD), 200, 'new password');
    keep(r.accessToken, r.refreshToken);
    expectStatus(await call('GET', '/users/me', { token: r.accessToken }), 200, 'me');
    ctx.pwFresh = r;
    return 'login with the new password → 200';
  });
  await step(27, 'password change invalidated every existing token at once', async () => {
    for (const s of [ctx.pw, ctx.pwSecond]) {
      const me = await call('GET', '/users/me', { token: s.token });
      assert(me.status === 401, `old access token → ${me.status}`);
      expectStatus(
        await call('POST', '/auth/refresh', { body: { refreshToken: s.refreshToken } }),
        401,
        'old refresh',
      );
    }
    const live = sql(
      `select count(*) from refresh_tokens where user_id = '${ctx.pw.userId}' and revoked_at is null`,
    );
    assert(live === '1', `live sessions ${live} (only the post-change login expected)`);
    return 'both pre-change sessions: access → 401, refresh → 401; only the new login is live';
  });

  ctx.sA = await newVerifiedUser('sessions');
  ctx.sB = adopt(
    { email: ctx.sA.email },
    expectStatus(await login(ctx.sA.email), 200, 'session B'),
  );
  await step(28, 'logout of session A invalidates access token A immediately', async () => {
    expectStatus(await call('GET', '/users/me', { token: ctx.sA.token }), 200, 'A before');
    expectStatus(
      await call('POST', '/auth/logout', { body: { refreshToken: ctx.sA.refreshToken } }),
      204,
      'logout A',
    );
    const me = await call('GET', '/users/me', { token: ctx.sA.token });
    assert(me.status === 401 && /revoked/i.test(me.body.error.message), `A after → ${me.status}`);
    expectStatus(
      await call('POST', '/auth/refresh', { body: { refreshToken: ctx.sA.refreshToken } }),
      401,
      'refresh A',
    );
    return 'A: access → 401 "Session has been revoked" on the next request; refresh → 401';
  });
  await step(29, 'session B of the same user remains valid', async () => {
    expectStatus(await call('GET', '/users/me', { token: ctx.sB.token }), 200, 'B access');
    const r = expectStatus(
      await call('POST', '/auth/refresh', { body: { refreshToken: ctx.sB.refreshToken } }),
      200,
      'B refresh',
    );
    adopt(ctx.sB, r);
    expectStatus(await call('GET', '/users/me', { token: ctx.sB.token }), 200, 'B rotated');
    return 'B: access → 200; refresh → 200 (rotated, same session)';
  });
  await step(30, 'logout-all invalidates session B', async () => {
    expectStatus(
      await call('POST', '/auth/logout-all', { token: ctx.sB.token }),
      204,
      'logout-all',
    );
    expectStatus(await call('GET', '/users/me', { token: ctx.sB.token }), 401, 'B access');
    expectStatus(
      await call('POST', '/auth/refresh', { body: { refreshToken: ctx.sB.refreshToken } }),
      401,
      'B refresh',
    );
    return 'B: access → 401; refresh → 401';
  });

  // ------------------------------------------------------------ 31–43 security
  await step(31, 'secure production headers and cookie (production-mode API)', async () => {
    const r = await fetch(`${PROBE}/health`);
    const h = (k) => r.headers.get(k);
    assert(
      h('x-content-type-options') === 'nosniff' &&
        h('x-frame-options') === 'DENY' &&
        h('referrer-policy') === 'no-referrer' &&
        h('cross-origin-opener-policy') === 'same-origin',
      'header set',
    );
    assert(!h('x-powered-by'), 'x-powered-by present');
    const docs = await fetch(`http://localhost:${PROBE_PORT}/api/docs-json`);
    assert(docs.status === 404, `OpenAPI served in production (${docs.status})`);
    const loginRes = await fetch(`${PROBE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.smoke.invalid' },
      body: JSON.stringify({ email: ctx.customerB.email, password: PASSWORD }),
    });
    const body = await loginRes.json();
    keep(body.accessToken);
    const cookie = loginRes.headers.get('set-cookie') ?? '';
    assert(
      loginRes.status === 200 &&
        /^__Secure-/.test(cookie) &&
        /;\s*Secure/i.test(cookie) &&
        /HttpOnly/i.test(cookie),
      `cookie ${cookie.split('=')[0]} ${loginRes.status}`,
    );
    keep(cookie.split(';')[0].split('=')[1]);
    return 'nosniff, DENY, no-referrer, COOP same-origin, no x-powered-by; OpenAPI → 404; refresh cookie __Secure-…; Secure; HttpOnly';
  });
  await step(32, 'CSP present on API and web responses', async () => {
    // Production mode (the probe): the development API relaxes CSP while it serves Swagger UI / the fake checkout.
    const apiCsp = (await fetch(`${PROBE}/health`)).headers.get('content-security-policy') ?? '';
    assert(
      apiCsp.includes("default-src 'none'") && apiCsp.includes("frame-ancestors 'none'"),
      `API CSP ${apiCsp}`,
    );
    const webRes = await fetch(`${WEB}/`);
    const webCsp = webRes.headers.get('content-security-policy') ?? '';
    const scriptSrc = webCsp.split(';').find((d) => d.trim().startsWith('script-src')) ?? '';
    assert(
      /'nonce-[A-Za-z0-9+/=]+'/.test(scriptSrc) &&
        scriptSrc.includes("'strict-dynamic'") &&
        !scriptSrc.includes("'unsafe-eval'"),
      `script-src ${scriptSrc}`,
    );
    const html = await webRes.text();
    const nonce = /'nonce-([^']+)'/.exec(scriptSrc)[1];
    assert(html.includes(`nonce="${nonce}"`), 'page scripts do not carry the nonce');
    return `API default-src 'none'; web script-src nonce + 'strict-dynamic', no 'unsafe-eval'; scripts carry the nonce`;
  });
  await step(33, 'HSTS present in production mode', async () => {
    const hsts = (await fetch(`${PROBE}/health`)).headers.get('strict-transport-security') ?? '';
    const maxAge = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    assert(maxAge >= 31_536_000 && /includeSubDomains/i.test(hsts), `HSTS ${hsts}`);
    const dev = (await fetch(`${API}/health`)).headers.get('strict-transport-security');
    return `production: "${hsts}"; development API: ${dev ? 'sent' : 'not sent (HTTP-only local)'}`;
  });
  await step(34, 'hostile CORS origin denied', async () => {
    const pre = (origin) =>
      fetch(`${API}/auth/login`, {
        method: 'OPTIONS',
        headers: {
          origin,
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type',
        },
      });
    const evil = await pre('https://evil.example');
    assert(
      !evil.headers.get('access-control-allow-origin'),
      `evil origin allowed: ${evil.headers.get('access-control-allow-origin')}`,
    );
    const good = await pre(WEB_ORIGIN);
    assert(
      good.headers.get('access-control-allow-origin') === WEB_ORIGIN &&
        good.headers.get('access-control-allow-credentials') === 'true',
      'allowed origin not echoed',
    );
    const csrf = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    assert(csrf.status === 403, `foreign-origin refresh → ${csrf.status}`);
    return 'evil origin: no ACAO; web origin echoed with credentials; foreign-origin refresh → 403';
  });
  await step(35, 'request-body limit enforced', async () => {
    const big = JSON.stringify({ email: 'x@example.com', password: 'y'.repeat(300 * 1024) });
    const r = await call('POST', '/auth/login', { body: big });
    assert(
      r.status === 413 && r.body.error.code === 'PAYLOAD_TOO_LARGE',
      `${r.status} ${r.body?.error?.code}`,
    );
    const formBig = await fetch(`${API}/payments/payhere/notify`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: `a=${'b'.repeat(80 * 1024)}`,
    });
    assert(formBig.status === 413, `form → ${formBig.status}`);
    return '300 KiB JSON → 413 PAYLOAD_TOO_LARGE; 80 KiB form → 413';
  });
  await step(36, 'auth rate limit enforced (production-mode defaults)', async () => {
    const statuses = [];
    for (let i = 0; i < 12; i += 1) {
      const r = await fetch(`${PROBE}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: `nobody-${RUN}@example.com`,
          password: 'not-a-real-password',
        }),
      });
      statuses.push(r.status);
    }
    const first429 = statuses.indexOf(429);
    assert(
      first429 > 0 &&
        statuses.slice(0, first429).every((s) => s === 401 || s === 200) &&
        statuses.slice(first429).every((s) => s === 429),
      `statuses ${statuses}`,
    );
    return `login attempts from one IP: ${first429} → 401, then 429 (${statuses.join(',')})`;
  });
  await step(37, 'upload size limit enforced', async () => {
    const big = Buffer.concat([await testImage(), randomBytes(10 * 1024 * 1024 + 1024)]);
    const r = await uploadPhoto(ctx.provider, ctx.vehicle.id, big, 'big.jpg');
    assert(r.status === 413, `photo > 10 MiB → ${r.status}`);
    const d = await uploadDocument(
      ctx.provider,
      { type: 'other' },
      Buffer.concat([PDF, randomBytes(10 * 1024 * 1024 + 1024)]),
      'big.pdf',
    );
    assert(d.status === 413, `document > 10 MiB → ${d.status}`);
    return 'photo and document over 10 MiB → 413';
  });
  await step(38, 'spoofed image rejected', async () => {
    // Photos can be added to a draft listing (an approved one refuses changes with 409 first).
    const draft = expectStatus(
      await call('POST', '/providers/me/vehicles', {
        token: ctx.provider,
        body: {
          categoryId: 'car',
          locationId: ctx.provider.locationId,
          title: `Draft Aqua smoke ${RUN}`,
          make: 'Toyota',
          model: 'Aqua',
          modelYear: 2018,
          transmission: 'automatic',
          fuelType: 'hybrid',
          seats: 5,
          doors: 5,
          engineCc: 1500,
          hasAc: true,
          color: 'White',
          registrationNumber: `CAB-${String(Date.now() + 13).slice(-4)}`,
          description: 'Draft listing used for the upload sniffing checks.',
          dailyRate: '7000',
          securityDeposit: '20000',
          includedKmPerDay: 100,
          extraKmRate: '40',
          minRentalDays: 1,
          maxRentalDays: 30,
          minRenterAge: 21,
          minLicenceYears: 1,
          fuelPolicy: 'full_to_full',
          deliveryAvailable: false,
        },
      }),
      201,
      'draft vehicle',
    );
    const ok = await uploadPhoto(ctx.provider, draft.id, await testImage(), 'real.jpg');
    assert(ok.status === 201, `real JPEG on the draft → ${ok.status}`);
    const text = await uploadPhoto(
      ctx.provider,
      draft.id,
      Buffer.from('<?php echo "x"; ?> not an image'),
      'shell.jpg',
      'image/jpeg',
    );
    const svg = await uploadPhoto(
      ctx.provider,
      draft.id,
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>'),
      'x.png',
      'image/png',
    );
    assert(
      [400, 415].includes(text.status) && [400, 415].includes(svg.status),
      `text ${text.status}, svg ${svg.status}`,
    );
    return `script as .jpg → ${text.status}; SVG as .png → ${svg.status}`;
  });
  await step(39, 'malicious / unsupported document types rejected', async () => {
    const html = await uploadDocument(
      ctx.provider,
      { type: 'other' },
      Buffer.from('<html><script>alert(1)</script></html>'),
      'x.pdf',
      'application/pdf',
    );
    const svg = await uploadDocument(
      ctx.provider,
      { type: 'other' },
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'x.png',
      'image/png',
    );
    const exe = await uploadDocument(
      ctx.provider,
      { type: 'other' },
      Buffer.concat([Buffer.from('MZ'), randomBytes(512)]),
      'x.pdf',
      'application/pdf',
    );
    assert(
      [html, svg, exe].every((r) => r.status === 415),
      `html ${html.status}, svg ${svg.status}, exe ${exe.status}`,
    );
    return 'HTML as PDF, SVG as PNG, PE executable as PDF → 415';
  });
  await step(40, 'private document cross-provider access denied', async () => {
    ctx.doc = expectStatus(
      await uploadDocument(ctx.provider, { type: 'identity_document' }, PDF, 'nic.pdf'),
      201,
      'identity',
    );
    assert(
      !JSON.stringify(ctx.doc).match(/storageKey|documents\/|sha256/),
      'response leaks storage fields',
    );
    ctx.docKey = sql(`select storage_key from verification_documents where id = '${ctx.doc.id}'`);
    keep(ctx.docKey);
    expectStatus(
      await call('GET', `/providers/me/documents/${ctx.doc.id}/content`, { token: ctx.other }),
      404,
      'other provider',
    );
    expectStatus(
      await call('GET', `/providers/me/documents/${ctx.doc.id}/content`, { token: ctx.customer }),
      403,
      'customer',
    );
    expectStatus(
      await call('GET', `/admin/documents/${ctx.doc.id}/content`, { token: ctx.provider }),
      403,
      'provider on admin route',
    );
    const own = await call('GET', `/providers/me/documents/${ctx.doc.id}/content`, {
      token: ctx.provider,
      raw: true,
    });
    assert(
      own.status === 200 && own.headers.get('content-disposition').includes('attachment'),
      `own → ${own.status}`,
    );
    const viaAdmin = await call('GET', `/admin/documents/${ctx.doc.id}/content`, {
      token: ctx.admin,
      raw: true,
    });
    assert(viaAdmin.status === 200, `admin → ${viaAdmin.status}`);
    const audited = sql(
      `select count(*) from audit_events where action = 'document.viewed' and target_id = '${ctx.doc.id}'`,
    );
    assert(audited === '1', `document.viewed ${audited}`);
    return 'other provider → 404; customer → 403; provider on admin route → 403; owner and admin stream it; admin read audited';
  });
  await step(41, 'private document never public', async () => {
    const pub =
      JSON.stringify(await search({ placeId: ctx.mirissa.id })) +
      JSON.stringify(
        expectStatus(await call('GET', `/vehicles/${ctx.vehicle.slug}`), 200, 'detail'),
      );
    assert(!pub.includes(ctx.docKey) && !/documents\/|storageKey/.test(pub), 'key in public JSON');
    const publicBucket = await fetch(`${MINIO}/vrp-public/${ctx.docKey}`);
    const privateBucket = await fetch(`${MINIO}/vrp-private/${ctx.docKey}`);
    assert(
      publicBucket.status === 404 && privateBucket.status === 403,
      `public ${publicBucket.status}, private anonymous ${privateBucket.status}`,
    );
    return 'no key in public JSON; public bucket → 404; private bucket anonymous → 403';
  });
  await step(42, 'exact provider location absent publicly', async () => {
    const s = JSON.stringify(await search({ placeId: ctx.mirissa.id }));
    const d = JSON.stringify(
      expectStatus(await call('GET', `/vehicles/${ctx.vehicle.slug}`), 200, 'detail'),
    );
    for (const str of [
      ctx.vehicle.plate,
      '12 Beach Road',
      'Blue gate',
      '+94771234567',
      ctx.provider.email,
      '5.9485',
      '80.4718',
      'Pickup from 8am',
    ])
      assert(!s.includes(str) && !d.includes(str), `public JSON leaks "${str}"`);
    const page = await (await fetch(`${WEB}/vehicles/${ctx.vehicle.slug}`)).text();
    for (const str of [ctx.vehicle.plate, '12 Beach Road', '5.9485', '80.4718'])
      assert(!page.includes(str), `vehicle page leaks "${str}"`);
    return 'search, detail JSON and the vehicle page carry no plate, address, instructions, phone, e-mail or exact pin';
  });

  // ---------------------------------------------- 44–63 booking / payment regressions
  await step(44, 'public search works', async () => {
    const r = await search({
      placeId: ctx.mirissa.id,
      startDate: colombo(20).slice(0, 10),
      endDate: colombo(23).slice(0, 10),
    });
    const card = r.data.find((c) => c.id === ctx.vehicle.id);
    assert(card && JSON.stringify(card).includes('7500'), JSON.stringify(card)?.slice(0, 200));
    return `${r.data.length} results near Mirissa; smoke vehicle listed at LKR ${card.dailyRate}`;
  });
  await step(45, 'quote is server-authoritative (client price fields refused)', async () => {
    const qt = await quote(ctx.vehicle.id, colombo(20), colombo(23));
    keep(qt.quoteToken);
    const r = await call('POST', '/bookings', {
      token: ctx.customer,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        vehicleId: ctx.vehicle.id,
        startsAt: colombo(20),
        endsAt: colombo(23),
        quoteToken: qt.quoteToken,
        driver: DRIVER,
        totalAmount: '1.00',
      },
    });
    assert(r.status === 400, `client price → ${r.status}`);
    const forged = await call('POST', '/bookings', {
      token: ctx.customer,
      headers: { 'idempotency-key': randomUUID() },
      body: {
        vehicleId: ctx.vehicle.id,
        startsAt: colombo(20),
        endsAt: colombo(23),
        quoteToken: `${qt.quoteToken.slice(0, -4)}AAAA`,
        driver: DRIVER,
      },
    });
    assert(forged.status >= 400 && forged.status < 500, `forged quote → ${forged.status}`);
    ctx.quoteA = qt;
    return `quote subtotal ${qt.subtotalAmount ?? qt.price?.subtotal ?? 'n/a'}; client totalAmount → 400; tampered quote token → ${forged.status}`;
  });
  await step(46, 'booking request works and reserves nothing', async () => {
    ctx.a = await requestBooking(ctx.customer, ctx.vehicle.id, colombo(20), colombo(23));
    assert(
      ctx.a.status === 'requested' && holdsOf(ctx.a.id) === 0,
      `${ctx.a.status}, holds ${holdsOf(ctx.a.id)}`,
    );
    const snap = sql(`select subtotal_amount from bookings where id = '${ctx.a.id}'`);
    return `${ctx.a.reference} requested; no hold; price snapshot ${snap}`;
  });
  await step(47, 'provider accept works', async () => {
    const r = expectStatus(
      await providerAction(ctx.provider, ctx.a.id, 'accept', { version: 1 }),
      200,
      'accept',
    );
    assert(r.status === 'accepted', r.status);
    expectStatus(
      await providerAction(ctx.provider, ctx.a.id, 'accept', { version: 1 }),
      409,
      'stale accept',
    );
    return 'accepted; repeated accept with the old version → 409';
  });
  await step(48, 'exclusive hold exists exactly once', async () => {
    assert(holdsOf(ctx.a.id) === 1, `holds ${holdsOf(ctx.a.id)}`);
    const overlap = Number(
      sql(
        `select count(*) from vehicle_holds where vehicle_id = '${ctx.vehicle.id}' and tstzrange(starts_at, ends_at) && tstzrange('${new Date(colombo(20)).toISOString()}', '${new Date(colombo(23)).toISOString()}')`,
      ),
    );
    assert(overlap === 1, `overlapping holds ${overlap}`);
    const again = await quote(ctx.vehicle.id, colombo(21), colombo(22));
    assert(again.bookable === false, 'held dates still bookable');
    return '1 booking hold; overlapping dates no longer bookable';
  });
  await step(49, 'fake payment confirms the booking', async () => {
    ctx.sessionA = await payAdvance(ctx.customer, ctx.a.id);
    const pay = sql(
      `select status || '|' || amount from payments where booking_id = '${ctx.a.id}'`,
    );
    assert(pay.startsWith('paid|'), `payment ${pay}`);
    return `confirmed via verified gateway notification; payment ${pay}`;
  });
  await step(50, 'callback replay is idempotent', async () => {
    const gw = sql(`select gateway_payment_id from payments where booking_id = '${ctx.a.id}'`);
    const events = sql(`select count(*) from payment_events where booking_id = '${ctx.a.id}'`);
    const replay = notification({
      orderId: ctx.sessionA.fields.order_id,
      amount: ctx.sessionA.fields.amount,
      paymentId: gw,
    });
    const [r1, r2] = await Promise.all([notify(replay), notify(replay)]);
    assert(r1.status === 200 && r2.status === 200, 'acks');
    const rows = sql(
      `select count(*) from payments where booking_id = '${ctx.a.id}' and status = 'paid'`,
    );
    assert(
      rows === '1' && bookingStatus(ctx.a.id) === 'confirmed' && holdsOf(ctx.a.id) === 1,
      `rows ${rows}`,
    );
    const eventsAfter = sql(
      `select count(*) from payment_events where booking_id = '${ctx.a.id}' and action <> 'payment.notification_replayed'`,
    );
    return `2 concurrent replays → 200; 1 paid row, still confirmed, 1 hold (events ${events} → ${eventsAfter} non-replay)`;
  });
  ctx.b = await requestBooking(ctx.customerC, ctx.vehicle.id, colombo(30), colombo(32));
  expectStatus(
    await providerAction(ctx.provider, ctx.b.id, 'accept', { version: 1 }),
    200,
    'accept B',
  );
  ctx.sessionB = expectStatus(await checkout(ctx.customerC, ctx.b.id), 200, 'checkout B');
  await step(51, 'forged callback rejected without side effects', async () => {
    const forged = notification({
      orderId: ctx.sessionB.fields.order_id,
      amount: ctx.sessionB.fields.amount,
    });
    forged.md5sig = 'DEADBEEFDEADBEEFDEADBEEFDEADBEEF';
    const wrongSecret = notification({
      orderId: ctx.sessionB.fields.order_id,
      amount: ctx.sessionB.fields.amount,
      secretMd5: md5('not-the-secret'),
    });
    const lowAmount = notification({ orderId: ctx.sessionB.fields.order_id, amount: '1.00' });
    for (const f of [forged, wrongSecret, lowAmount])
      assert((await notify(f)).status === 200, 'always 200');
    assert(bookingStatus(ctx.b.id) === 'accepted', `booking ${bookingStatus(ctx.b.id)}`);
    const paid = sql(
      `select count(*) from payments where booking_id = '${ctx.b.id}' and status = 'paid'`,
    );
    assert(paid === '0', `paid rows ${paid}`);
    return 'bad signature, wrong secret, wrong amount → 200 ack; booking still accepted; no paid row';
  });
  await step(52, 'browser return alone cannot confirm', async () => {
    const ret = await fetch(ctx.sessionB.fields.return_url, { redirect: 'manual' });
    assert(ret.status < 500, `return page ${ret.status}`);
    await sleep(1500);
    assert(bookingStatus(ctx.b.id) === 'accepted', `booking ${bookingStatus(ctx.b.id)}`);
    const status = expectStatus(
      await call('GET', `/bookings/${ctx.b.id}/payments`, { token: ctx.customerC }),
      200,
      'payments',
    );
    return `return URL → ${ret.status}; booking still accepted; status endpoint ${JSON.stringify(status).slice(0, 80)}`;
  });
  await step(53, 'contact details blocked before confirmation', async () => {
    const r = await call('GET', `/bookings/${ctx.b.id}/contact`, { token: ctx.customerC });
    assert(
      [403, 409].includes(r.status) && r.body.error.code === 'CONTACT_NOT_AVAILABLE_YET',
      `${r.status} ${r.body?.error?.code}`,
    );
    assert(
      !JSON.stringify(
        expectStatus(
          await call('GET', `/bookings/${ctx.b.id}`, { token: ctx.customerC }),
          200,
          'booking',
        ),
      ).includes('+94771234567'),
      'phone embedded',
    );
    return '409 CONTACT_NOT_AVAILABLE_YET; booking JSON has no phone';
  });
  await step(54, 'contact details allowed after confirmation', async () => {
    const r = expectStatus(
      await call('GET', `/bookings/${ctx.a.id}/contact`, { token: ctx.customer }),
      200,
      'contact',
    );
    assert(JSON.stringify(r).includes('+94771234567'), 'provider phone missing');
    expectStatus(
      await call('GET', `/bookings/${ctx.a.id}/contact`, { token: ctx.customerC }),
      [403, 404],
      'stranger',
    );
    return 'confirmed booking reveals the provider contact; a stranger is refused';
  });
  await step(55, 'pickup', async () => {
    const r = expectStatus(
      await providerAction(ctx.provider, ctx.a.id, 'pickup', {
        version: versionOf(ctx.a.id),
        odometerKm: 1000,
        fuelLevel: 6,
      }),
      200,
      'pickup',
    );
    assert(r.status === 'active', r.status);
    return 'active';
  });
  await step(56, 'return / completion', async () => {
    const r = expectStatus(
      await providerAction(ctx.provider, ctx.a.id, 'return', {
        version: versionOf(ctx.a.id),
        odometerKm: 1300,
        fuelLevel: 5,
      }),
      200,
      'return',
    );
    assert(r.status === 'completed' && holdsOf(ctx.a.id) === 1, `${r.status}`);
    return 'completed';
  });
  await step(57, 'review', async () => {
    ctx.review = expectStatus(
      await call('POST', `/bookings/${ctx.a.id}/review`, {
        token: ctx.customer,
        body: { overallRating: 5, comment: `Great car, smoke ${RUN}` },
      }),
      201,
      'review',
    );
    const pub = expectStatus(
      await call('GET', `/vehicles/${ctx.vehicle.slug}/reviews`),
      200,
      'public reviews',
    );
    const shown = pub.data.find((r) => r.id === ctx.review.id);
    assert(
      shown &&
        shown.reviewer.displayName === 'Nimal P.' &&
        !JSON.stringify(pub).includes(ctx.customer.email),
      JSON.stringify(shown?.reviewer),
    );
    return 'published; public reviewer "Nimal P."; no e-mail';
  });
  await step(58, 'provider reply', async () => {
    expectStatus(
      await call('POST', `/providers/me/reviews/${ctx.review.id}/reply`, {
        token: ctx.provider,
        body: { reply: 'Thank you for renting with us!' },
      }),
      200,
      'reply',
    );
    expectStatus(
      await call('POST', `/providers/me/reviews/${ctx.review.id}/reply`, {
        token: ctx.provider,
        body: { reply: 'Second reply' },
      }),
      409,
      'second reply',
    );
    return 'reply saved; a second reply → 409';
  });
  await step(59, 'review edit after reply rejected', async () => {
    const r = await call('PUT', `/bookings/${ctx.a.id}/review`, {
      token: ctx.customer,
      body: { overallRating: 1, comment: 'changed' },
    });
    assert(
      r.status === 409 && r.body.error.code === 'REVIEW_LOCKED_AFTER_REPLY',
      `${r.status} ${r.body?.error?.code}`,
    );
    return '409 REVIEW_LOCKED_AFTER_REPLY';
  });
  await step(60, 'dispute flow remains valid', async () => {
    ctx.disputeText = `Scratch on the left door not in the photos (smoke ${RUN})`;
    ctx.dispute = expectStatus(
      await call('POST', `/bookings/${ctx.a.id}/dispute`, {
        token: ctx.customer,
        body: { reasonCode: 'vehicle_condition', description: ctx.disputeText },
      }),
      201,
      'open',
    );
    expectStatus(
      await call('POST', `/bookings/${ctx.a.id}/dispute`, {
        token: ctx.customer,
        body: {
          reasonCode: 'other',
          description: 'A second dispute on the same booking must be refused.',
        },
      }),
      409,
      'duplicate',
    );
    expectStatus(
      await call('GET', `/disputes/${ctx.dispute.id}`, { token: ctx.customerC }),
      404,
      'stranger',
    );
    expectStatus(
      await call('POST', `/disputes/${ctx.dispute.id}/messages`, {
        token: ctx.provider,
        body: { body: 'The scratch is on our handover photos.' },
      }),
      201,
      'provider message',
    );
    expectStatus(
      await admin('POST', `/admin/disputes/${ctx.dispute.id}/start-review`, {}),
      200,
      'start review',
    );
    ctx.note = `INTERNAL smoke ${RUN}: lean towards the customer`;
    expectStatus(
      await admin('PUT', `/admin/disputes/${ctx.dispute.id}/internal-note`, { note: ctx.note }),
      200,
      'note',
    );
    const view = expectStatus(
      await call('GET', `/disputes/${ctx.dispute.id}`, { token: ctx.customer }),
      200,
      'customer view',
    );
    assert(!JSON.stringify(view).includes('INTERNAL'), 'internal note leaked');
    const r = expectStatus(
      await admin('POST', `/admin/disputes/${ctx.dispute.id}/resolve`, {
        resolutionCode: 'no_action',
        publicNote: 'Both parties agreed; nothing further is needed.',
      }),
      200,
      'resolve',
    );
    assert(r.status === 'resolved', r.status);
    const pay = sql(
      `select status || '|' || coalesce(refunded_amount::text, '-') from payments where booking_id = '${ctx.a.id}'`,
    );
    assert(pay === 'paid|-', `payment ${pay}`);
    return 'opened; duplicate → 409; stranger → 404; message; in review; internal note hidden; resolved; payment untouched';
  });
  await step(61, 'admin cancellation vs payment callback race remains safe', async () => {
    ctx.d = await requestBooking(ctx.customer, ctx.vehicle.id, colombo(50), colombo(52));
    expectStatus(
      await providerAction(ctx.provider, ctx.d.id, 'accept', { version: 1 }),
      200,
      'accept D',
    );
    const session = expectStatus(await checkout(ctx.customer, ctx.d.id), 200, 'checkout D');
    const fields = notification({
      orderId: session.fields.order_id,
      amount: session.fields.amount,
    });
    const [cancel, cb] = await Promise.all([
      admin('POST', `/admin/bookings/${ctx.d.id}/cancel`, {
        actor: 'platform',
        reason: 'Smoke: racing the callback',
        version: 2,
      }),
      notify(fields),
    ]);
    assert(cb.status === 200, `callback ${cb.status}`);
    let outcome;
    if (cancel.status === 200) {
      const pay = sql(
        `select status || '|' || coalesce(anomaly, '-') from payments where booking_id = '${ctx.d.id}'`,
      );
      assert(
        bookingStatus(ctx.d.id) === 'cancelled_by_platform' && pay === 'paid|late_success',
        `pay ${pay}`,
      );
      outcome = `cancellation won; late success recorded (${pay}), never re-confirmed`;
    } else {
      assert(
        cancel.status === 409 && bookingStatus(ctx.d.id) === 'confirmed',
        `cancel ${cancel.status}`,
      );
      expectStatus(
        await admin('POST', `/admin/bookings/${ctx.d.id}/cancel`, {
          actor: 'platform',
          reason: 'Smoke: cancel after confirmation',
          version: versionOf(ctx.d.id),
        }),
        200,
        'retry',
      );
      outcome = 'payment won; cancel → 409 STALE_VERSION; retry cancelled with refund due';
    }
    await notify(fields);
    assert(
      bookingStatus(ctx.d.id) === 'cancelled_by_platform' && holdsOf(ctx.d.id) === 0,
      `after replay ${bookingStatus(ctx.d.id)}, holds ${holdsOf(ctx.d.id)}`,
    );
    const paidRows = sql(
      `select count(*) from payments where booking_id = '${ctx.d.id}' and status = 'paid'`,
    );
    assert(paidRows === '1', `paid rows ${paidRows}`);
    ctx.paymentD = sql(
      `select id || '|' || refund_due_amount from payments where booking_id = '${ctx.d.id}'`,
    ).split('|');
    return `${outcome}; replay → no change, no hold, 1 paid row, refund due ${ctx.paymentD[1]}`;
  });
  await step(62, 'no manual confirm-for-testing endpoint', async () => {
    for (const p of [
      `/admin/bookings/${ctx.b.id}/confirm-for-testing`,
      `/admin/bookings/${ctx.b.id}/confirm`,
      `/admin/bookings/${ctx.b.id}/status`,
      `/bookings/${ctx.b.id}/confirm`,
    ])
      expectStatus(await admin('POST', p, { status: 'confirmed' }), 404, p);
    assert(bookingStatus(ctx.b.id) === 'accepted', 'booking changed');
    return '4 confirmation-shaped routes → 404; booking still accepted';
  });
  await step(63, 'no settlements / ledger / payout path introduced', async () => {
    const doc = await (await fetch(`http://localhost:${API_PORT}/api/docs-json`)).json();
    const paths = Object.keys(doc.paths ?? {});
    const bad = paths.filter((p) =>
      /settlement|ledger|payout|balance-collect|deposit-collect/i.test(p),
    );
    assert(bad.length === 0, `paths ${bad}`);
    const tables = sql(
      `select coalesce(string_agg(table_name, ','), '') from information_schema.tables where table_schema = 'public' and table_name ~ '(settlement|ledger|payout)'`,
    );
    assert(tables === '', `tables ${tables}`);
    assert(paths.includes('/api/v1/users/me/password'), 'password route undocumented');
    return `${paths.length} OpenAPI paths, none for settlements / ledger / payouts; no such tables; /users/me/password documented`;
  });

  // ------------------------------------------------------------ 64–70 privacy
  await step(64, 'customer data export succeeds', async () => {
    const r = await call('GET', '/users/me/export', { token: ctx.customer, raw: true });
    assert(
      r.status === 200 && /attachment/.test(r.headers.get('content-disposition') ?? ''),
      `export ${r.status}`,
    );
    ctx.export = JSON.parse(r.buffer.toString('utf8'));
    assert(
      ctx.export.schemaVersion === 'vrp-user-export/1' &&
        ctx.export.account.email === ctx.customer.email,
      'export shape',
    );
    const audit = sql(
      `select count(*) from audit_events where target_id = '${ctx.customer.userId}' and action like 'privacy.%export%'`,
    );
    return `JSON attachment ${r.buffer.length} bytes, ${Object.keys(ctx.export).length} sections; audit rows ${audit}`;
  });
  await step(65, 'export excludes secrets and internal notes', async () => {
    const text = JSON.stringify(ctx.export);
    const hash = sql(`select password_hash from users where id = '${ctx.customer.userId}'`);
    for (const s of [
      hash,
      ctx.customer.token,
      ctx.customer.refreshToken,
      ctx.note,
      ctx.docKey,
      '$argon2',
      'passwordHash',
      'tokenHash',
      'secretEnvelope',
      'internalNote',
      'internalAdminNote',
      'md5sig',
      'gatewayPaymentId',
    ])
      assert(!text.includes(s), `export contains ${String(s).slice(0, 20)}`);
    return 'no password hash, tokens, MFA material, internal note, storage key or gateway references';
  });
  ctx.del = await newVerifiedUser('delete', 'Sunil Jayasuriya');
  const delBooking = await requestBooking(ctx.del, ctx.vehicle.id, colombo(70), colombo(72));
  await step(66, 'deletion request created', async () => {
    const r = expectStatus(
      await call('POST', '/users/me/delete-request', {
        token: ctx.del,
        body: { confirmEmail: ctx.del.email, note: 'Please delete my account.' },
      }),
      202,
      'delete request',
    );
    assert(r.type === 'deletion' && r.status === 'open', JSON.stringify(r));
    expectStatus(
      await call('POST', '/users/me/delete-request', {
        token: ctx.del,
        body: { confirmEmail: ctx.del.email },
      }),
      409,
      'second request',
    );
    ctx.delRequest = r;
    return `request ${r.id} open; second open request → 409 PRIVACY_REQUEST_ALREADY_OPEN`;
  });
  await step(67, 'deletion blocker shown where expected', async () => {
    const view = expectStatus(
      await admin('GET', `/admin/privacy-requests/${ctx.delRequest.id}`),
      200,
      'admin view',
    );
    assert(view.blockers.includes('open_booking_as_customer'), JSON.stringify(view.blockers));
    const r = await admin(
      'POST',
      `/admin/privacy-requests/${ctx.delRequest.id}/complete-deletion`,
      { reason: 'Requested by the user', confirmEmail: ctx.del.email },
    );
    assert(
      r.status === 409 && r.body.error.code === 'ACCOUNT_ANONYMISATION_BLOCKED',
      `${r.status} ${r.body?.error?.code}`,
    );
    const own = expectStatus(
      await call('GET', '/users/me/privacy-requests', { token: ctx.del }),
      200,
      'own list',
    );
    return `blockers ${view.blockers.join(', ')}; completion → 409 ACCOUNT_ANONYMISATION_BLOCKED; requester sees ${own.data.length} request(s)`;
  });
  await step(68, 'eligible deletion / anonymisation completes', async () => {
    expectStatus(
      await call('POST', `/bookings/${delBooking.id}/cancel`, {
        token: ctx.del,
        body: { version: 1, note: 'Changed plans' },
      }),
      200,
      'customer cancels',
    );
    ctx.delOldRefresh = ctx.del.refreshToken;
    const r = expectStatus(
      await admin('POST', `/admin/privacy-requests/${ctx.delRequest.id}/complete-deletion`, {
        reason: 'Requested by the user',
        confirmEmail: ctx.del.email,
        publicNote: 'Your account has been deleted as requested.',
      }),
      200,
      'complete',
    );
    assert(
      r.status === 'completed' && r.user.status === 'deleted',
      JSON.stringify({ status: r.status, user: r.user.status }),
    );
    const row = sql(
      `select full_name || '|' || status || '|' || password_hash from users where id = '${ctx.del.userId}'`,
    );
    assert(row === 'Deleted user|deleted|!anonymised', `row ${row}`);
    return `request completed; account anonymised (${row.split('|').slice(0, 2).join(', ')}, unusable password)`;
  });
  await step(69, 'retained history remains after anonymisation', async () => {
    const booking = sql(
      `select customer_user_id || '|' || status from bookings where id = '${delBooking.id}'`,
    );
    assert(booking === `${ctx.del.userId}|cancelled_by_customer`, `booking ${booking}`);
    const audits = sql(
      `select count(*) from audit_events where target_id = '${ctx.del.userId}' and action = 'user.anonymised'`,
    );
    assert(audits === '1', `audit ${audits}`);
    const events = sql(`select count(*) from booking_events where booking_id = '${delBooking.id}'`);
    assert(Number(events) >= 2, `booking events ${events}`);
    return `booking ${delBooking.reference} kept (${booking.split('|')[1]}) under the same id; ${events} booking events; audit user.anonymised`;
  });
  await step(70, 'sessions revoked after anonymisation', async () => {
    expectStatus(await call('GET', '/users/me', { token: ctx.del.token }), 401, 'old access');
    expectStatus(
      await call('POST', '/auth/refresh', { body: { refreshToken: ctx.delOldRefresh } }),
      401,
      'old refresh',
    );
    expectStatus(await login(ctx.del.email), 401, 'old login');
    const live = sql(
      `select count(*) from refresh_tokens where user_id = '${ctx.del.userId}' and revoked_at is null`,
    );
    assert(live === '0', `live ${live}`);
    return 'access → 401, refresh → 401, login → 401; 0 live sessions';
  });

  // ---------------------------------------------------- 71–77 worker / retention
  await step(71, 'worker running and healthy', async () => {
    assert(!ctx.worker.exit, `worker exited ${JSON.stringify(ctx.worker.exit)}`);
    const t0 = Date.now();
    let status;
    while (Date.now() - t0 < 120_000) {
      status = expectStatus(await admin('GET', '/admin/system/worker'), 200, 'worker status');
      if (status.healthy) break;
      await sleep(3000);
    }
    assert(status.healthy, `unhealthy: ${JSON.stringify(status).slice(0, 300)}`);
    return `healthy; heartbeat ${status.heartbeatQueue} at ${status.heartbeatLastCompletedAt}`;
  });
  await step(72, 'schedules include retention', async () => {
    const sched = sql(
      `select string_agg(name || '=' || cron, ',' order by name) from ${env.PGBOSS_SCHEMA || 'pgboss'}.schedule`,
    );
    for (const name of [
      'retention.sweep',
      'reminders.sweep',
      'bookings.expire',
      'documents.expiry-sweep',
    ])
      assert(sched.includes(`${name}=`), `missing ${name}: ${sched}`);
    return sched;
  });
  await step(73, 'reminder dedupe intact', async () => {
    sql(`update bookings set confirm_by = now() + interval '5 hours' where id = '${ctx.b.id}'`);
    await enqueue('reminders.sweep');
    await enqueue('reminders.sweep');
    const rows = sql(
      `select count(*) from notifications where dedupe_key = 'booking:${ctx.b.id}:payment-reminder'`,
    );
    assert(rows === '1', `reminder rows ${rows}`);
    return `two sweeps → exactly 1 payment reminder for ${ctx.b.reference}`;
  });
  await step(74, 'document expiry sweep works', async () => {
    const soon = expectStatus(
      await uploadDocument(
        ctx.other,
        { type: 'insurance_certificate', vehicleId: ctx.vehicle2.id },
        PDF,
        'ins.pdf',
      ),
      201,
      'upload',
    );
    expectStatus(
      await admin('POST', `/admin/documents/${soon.id}/approve`, {
        expiresOn: addDays(todayColombo(), 10),
      }),
      200,
      'approve +10d',
    );
    await enqueue('documents.expiry-sweep');
    await enqueue('documents.expiry-sweep');
    const rows = sql(
      `select count(*) from notifications where dedupe_key = 'document:${soon.id}:expiry:14'`,
    );
    assert(rows === '1', `reminder rows ${rows}`);
    await mailFor(ctx.other.email, 'expires in 10 days');
    return 'expiring in 10 days → one reminder (in-app + e-mail) after two sweeps';
  });
  ctx.retOld = randomUUID();
  ctx.retFresh = randomUUID();
  const fam = randomUUID();
  sql(
    `insert into refresh_tokens (id, user_id, token_hash, family_id, client, expires_at, revoked_at, created_at) values ('${ctx.retOld}', '${ctx.customerC.userId}', '${randomBytes(32).toString('hex')}', '${fam}', 'mobile', now() - interval '45 days', now() - interval '60 days', now() - interval '90 days'), ('${ctx.retFresh}', '${ctx.customerC.userId}', '${randomBytes(32).toString('hex')}', '${fam}', 'mobile', now() + interval '20 days', now(), now() - interval '1 day')`,
  );
  const eligible = () =>
    Number(
      sql(
        `select count(*) from refresh_tokens where (revoked_at is not null or expires_at < now()) and expires_at < now() - interval '30 days'`,
      ),
    );
  await step(75, 'retention selection uses the controlled cut-off', async () => {
    const expected = eligible();
    const r = run('pnpm', ['retention:preview'], { env });
    assert(r.status === 0, `preview exit ${r.status}: ${r.stderr.slice(-300)}`);
    const json = /\{\s*"dryRun"[\s\S]*?\n\}/.exec(r.stdout + r.stderr);
    assert(json, 'no JSON summary printed');
    ctx.preview = JSON.parse(json[0]);
    // A dry run counts at most one bounded batch per category.
    const { RETENTION_BATCH_SIZE } = apiRequire('./dist/modules/retention/retention.service.js');
    assert(expected >= 1, 'the seeded expired token is not eligible');
    assert(
      ctx.preview.dryRun === true &&
        ctx.preview.refreshTokens === Math.min(expected, RETENTION_BATCH_SIZE),
      `preview refreshTokens ${ctx.preview.refreshTokens} vs eligible ${expected}`,
    );
    return `preview at ${ctx.preview.now}: ${ctx.preview.refreshTokens} refresh tokens past the 30-day grace (= SQL count), search logs ${ctx.preview.searchLogs}, documents ${ctx.preview.documentsRejected + ctx.preview.documentsSuperseded}`;
  });
  await step(76, 'retention dry run deletes nothing', async () => {
    const both = sql(
      `select count(*) from refresh_tokens where id in ('${ctx.retOld}', '${ctx.retFresh}')`,
    );
    assert(both === '2', `rows ${both}`);
    assert(eligible() === ctx.preview.refreshTokens, 'eligible count changed by the dry run');
    return 'both seeded rows still present; eligible count unchanged';
  });
  await step(77, 'retention sweep deletes only what is due; repeat run is idempotent', async () => {
    await enqueue('retention.sweep');
    assert(
      sql(`select count(*) from refresh_tokens where id = '${ctx.retOld}'`) === '0',
      'old row still present',
    );
    assert(
      sql(`select count(*) from refresh_tokens where id = '${ctx.retFresh}'`) === '1',
      'fresh row deleted',
    );
    assert(eligible() === 0, `eligible after sweep ${eligible()}`);
    await enqueue('retention.sweep');
    assert(
      sql(`select count(*) from refresh_tokens where id = '${ctx.retFresh}'`) === '1',
      'second run deleted the fresh row',
    );
    const bookingsKept = sql(
      `select count(*) from bookings where id in (${inList(runBookingIds)})`,
    );
    assert(Number(bookingsKept) === runBookingIds.length, 'bookings deleted');
    return `worker sweep removed the expired row, kept the recent one; second sweep changed nothing; ${bookingsKept} run bookings intact`;
  });

  // ------------------------------------------------------- 78–83 reporting / admin
  await step(78, 'admin dashboard works', async () => {
    const o = expectStatus(await admin('GET', '/admin/overview'), 200, 'overview');
    assert(o.items.length >= 8 && o.items.every((i) => i.linkPath.startsWith('/admin')), 'items');
    const page = await fetch(`${WEB}/admin`);
    assert(page.status === 200, `/admin → ${page.status}`);
    return `${o.items.length} queue counters; /admin → 200`;
  });
  await step(79, 'audit log works (password change, MFA, anonymisation visible)', async () => {
    const list = expectStatus(
      await admin(
        'GET',
        `/admin/audit-events?${q({ targetType: 'user', targetId: ctx.pw.userId })}`,
      ),
      200,
      'audit',
    );
    assert(
      list.data.some((e) => e.action === 'user.password_changed'),
      JSON.stringify(list.data.map((e) => e.action)),
    );
    const mfa = expectStatus(
      await admin(
        'GET',
        `/admin/audit-events?${q({ targetType: 'user', targetId: ctx.admin.userId })}`,
      ),
      200,
      'audit admin',
    );
    assert(
      mfa.data.some((e) => e.action === 'mfa.enrolled'),
      'mfa.enrolled missing',
    );
    const text = JSON.stringify(list) + JSON.stringify(mfa);
    assert(
      !text.includes(PASSWORD) && !text.includes(NEW_PASSWORD) && !/"ip"\s*:/.test(text),
      'secret or IP in the viewer',
    );
    expectStatus(
      await call('GET', '/admin/audit-events', { token: ctx.customer }),
      403,
      'customer',
    );
    return 'user.password_changed and mfa.enrolled listed; no passwords or IPs; customer → 403';
  });
  const firstRefund = '1000.00';
  await step(80, 'Phase 9 reports work', async () => {
    const r = await overview();
    for (const k of ['funnel', 'statusCounts', 'gmv', 'money', 'supplyDemand'])
      assert(r[k], `missing ${k}`);
    for (const p of ['/admin/reports/providers']) expectStatus(await admin('GET', p), 200, p);
    const csv = await call(
      'GET',
      `/admin/reports/zero-result-searches.csv?${q({ from: todayColombo(), to: todayColombo() })}`,
      { token: ctx.admin, raw: true },
    );
    assert(
      csv.status === 200 && (csv.headers.get('content-type') ?? '').startsWith('text/csv'),
      `zero-result csv → ${csv.status}`,
    );
    return `overview (funnel, status counts, GMV, money, supply/demand), providers and zero-result reports → 200`;
  });
  await step(81, 'partial-refund period report remains correct', async () => {
    const before = await overview();
    const due = ctx.paymentD[1];
    const remainder = money(cents(due) - cents(firstRefund));
    assert(cents(remainder) > 0, `refund due ${due} too small to split`);
    expectStatus(
      await admin('POST', `/admin/payments/${ctx.paymentD[0]}/refund`, {
        mode: 'manual',
        amount: firstRefund,
        reason: 'Smoke: platform cancellation refund (part 1)',
        reference: `PH-REF-${RUN}-1`,
      }),
      200,
      'partial refund',
    );
    expectStatus(
      await admin('POST', `/admin/payments/${ctx.paymentD[0]}/refund`, {
        mode: 'manual',
        amount: remainder,
        reason: 'Smoke: platform cancellation refund (part 2)',
        reference: `PH-REF-${RUN}-2`,
      }),
      200,
      'remainder',
    );
    const after = await overview();
    assert(
      cents(after.money.refundedAmount) - cents(before.money.refundedAmount) === cents(due),
      `refunded delta ${after.money.refundedAmount} - ${before.money.refundedAmount} vs ${due}`,
    );
    assert(
      after.money.refundsCount - before.money.refundsCount === 2,
      `refundsCount delta ${after.money.refundsCount - before.money.refundsCount}`,
    );
    const row = sql(
      `select status || '|' || refunded_amount from payments where id = '${ctx.paymentD[0]}'`,
    );
    assert(row === `refunded|${due}`, `payment ${row}`);
    return `two movements ${firstRefund} + ${remainder} → refunded delta ${due}, refundsCount delta 2 (movements, not rows); payment ${row}`;
  });
  await step(82, 'CSV formula injection remains protected', async () => {
    const res = await call('GET', '/admin/reports/providers.csv', { token: ctx.admin, raw: true });
    const text = res.buffer.toString('utf8');
    assert(res.status === 200 && text.charCodeAt(0) === 0xfeff, `csv ${res.status}`);
    const line = text.split('\r\n').find((l) => l.startsWith(ctx.other.providerId));
    assert(
      line &&
        line.includes(`"'=HYPERLINK(""http://evil"") Fleet ${RUN}"`) &&
        !line.includes(',=HYPERLINK'),
      `line ${line}`,
    );
    expectStatus(
      await call('GET', '/admin/reports/providers.csv', { token: ctx.customer }),
      403,
      'customer csv',
    );
    return 'provider "=HYPERLINK(…)" exported quoted with a leading apostrophe; customer → 403';
  });
  await step(83, 'worker system page works', async () => {
    const s = expectStatus(await admin('GET', '/admin/system/worker'), 200, 'worker');
    assert(
      s.schedules.some((x) => x.name === 'retention.sweep') && s.queues.length > 0,
      'schedules / queues',
    );
    const page = await fetch(`${WEB}/admin/system`);
    assert(page.status === 200, `/admin/system → ${page.status}`);
    expectStatus(
      await call('GET', '/admin/system/worker', { token: ctx.provider }),
      403,
      'provider',
    );
    return `${s.schedules.length} schedules, ${s.queues.length} queues; /admin/system → 200; provider → 403`;
  });

  // Canary: a value sent where logs could pick it up (header, query, body) must never be logged.
  await call('POST', '/auth/login', {
    headers: { 'x-smoke-canary': CANARY },
    body: { email: `canary-${RUN}@example.com`, password: CANARY },
  });
  await call('GET', `/vehicles/search?placeId=${CANARY}&q=${CANARY}`);
  await call('POST', '/users/me/password', {
    token: ctx.pwFresh.accessToken,
    body: { currentPassword: CANARY, newPassword: `${CANARY}-new` },
  });

  // ------------------------------------------------------ 84–86 logs / bundles / secrets
  await step(84, 'log canary privacy scan passes', async () => {
    await sleep(1500);
    const logs = ['api', 'worker', 'probe']
      .map((n) => fs.readFileSync(path.join(OUT, `${n}.log`), 'utf8'))
      .join('\n');
    const leaked = secrets.filter((s) => logs.includes(s));
    assert(
      leaked.length === 0,
      `${leaked.length} secret(s) in logs, e.g. ${leaked[0]?.slice(0, 6)}…`,
    );
    const rawEmails = emails.filter((e) => logs.includes(e));
    assert(rawEmails.length === 0, `raw e-mail ${rawEmails[0]} in logs`);
    for (const s of ['+94771234567', ctx.disputeText, ctx.note, ctx.docKey, '$argon2'])
      assert(!logs.includes(s), `private text in logs: ${String(s).slice(0, 30)}`);
    for (const line of [
      'Password changed; all sessions revoked',
      'User logged in with MFA',
      'Retention sweep',
    ])
      assert(logs.includes(line), `expected log line missing: ${line}`);
    return `${secrets.length} secrets (passwords, canary, tokens, refresh tokens, TOTP secrets, recovery codes, signatures, synthetic production secrets) and ${emails.length} e-mail addresses absent from ${logs.split('\n').length} log lines; operational lines present`;
  });
  await step(85, 'client bundle contains no server secret', async () => {
    const dir = path.join(ROOT, 'apps/web/.next/static');
    const files = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(js|css|json|map|txt)$/.test(e.name)) files.push(p);
      }
    };
    walk(dir);
    const serverEnv = {
      ...rootEnv,
      ...parseEnvFile(path.join(ROOT, 'apps/web/.env')),
      ...parseEnvFile(path.join(ROOT, 'apps/web/.env.local')),
    };
    const values = Object.entries(serverEnv)
      .filter(
        ([k, v]) =>
          !k.startsWith('NEXT_PUBLIC_') &&
          /SECRET|PASS|KEY|TOKEN|DATABASE_URL|DSN/.test(k) &&
          v.length >= 8,
      )
      .map(([k, v]) => [k, v]);
    const names = [
      'BOOKING_QUOTE_SECRET',
      'APP_DATA_ENCRYPTION_KEY',
      'PAYHERE_MERCHANT_SECRET',
      'JWT_PRIVATE_KEY',
      'STORAGE_SECRET_KEY',
      'SMTP_PASS',
      'DATABASE_URL',
    ];
    let bytes = 0;
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf8');
      bytes += text.length;
      for (const [k, v] of values)
        assert(!text.includes(v), `${path.relative(ROOT, f)} contains the value of ${k}`);
      for (const n of names) assert(!text.includes(n), `${path.relative(ROOT, f)} mentions ${n}`);
      assert(
        !text.includes('BEGIN PRIVATE KEY') && !text.includes(DEV_ENCRYPTION_KEY),
        `${path.relative(ROOT, f)} contains key material`,
      );
    }
    return `${files.length} client files (${(bytes / 1024 / 1024).toFixed(1)} MiB) scanned: none of ${values.length} server secret values, ${names.length} server variable names or key material`;
  });
  await step(
    86,
    'gitleaks scan clean (working tree incl. uncommitted files, and history)',
    async () => {
      const list = run('git', ['ls-files', '-co', '--exclude-standard', '-z'])
        .stdout.split('\0')
        .filter(Boolean);
      const staging = path.join(OUT, 'gitleaks-src');
      for (const f of list) {
        const src = path.join(ROOT, f);
        if (!fs.existsSync(src) || fs.statSync(src).isDirectory()) continue;
        const dst = path.join(staging, f);
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.copyFileSync(src, dst);
      }
      const mount = (p) => p.replace(/\\/g, '/');
      const tree = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${mount(staging)}:/src:ro`,
          'zricethezav/gitleaks:latest',
          'detect',
          '--no-git',
          '--source=/src',
          '--config=/src/.gitleaks.toml',
          '--redact',
          '--no-banner',
          '--exit-code=1',
        ],
        { encoding: 'utf8' },
      );
      fs.rmSync(staging, { recursive: true, force: true });
      assert(
        tree.status === 0,
        `working tree: exit ${tree.status}\n${(tree.stdout + tree.stderr).slice(-800)}`,
      );
      const history = spawnSync(
        'docker',
        [
          'run',
          '--rm',
          '-v',
          `${mount(ROOT)}:/repo:ro`,
          'zricethezav/gitleaks:latest',
          'detect',
          '--source=/repo',
          '--config=/repo/.gitleaks.toml',
          '--redact',
          '--no-banner',
          '--exit-code=1',
        ],
        { encoding: 'utf8' },
      );
      assert(
        history.status === 0,
        `history: exit ${history.status}\n${(history.stdout + history.stderr).slice(-800)}`,
      );
      const summary = (s) =>
        (s.stdout + s.stderr)
          .split('\n')
          .filter((l) => /no leaks found|commits scanned|scanned/i.test(l))
          .join(' / ');
      return `${list.length} tracked + untracked files: ${summary(tree)}; history: ${summary(history)}`;
    },
  );

  // ---------------------------------------------------------- 87–88 categories
  await step(87, 'scooter category inactive', async () => {
    assert(
      sql(`select is_active from vehicle_categories where id = 'scooter'`) === 'f',
      'scooter active',
    );
    const pub = expectStatus(
      await call('GET', '/reference/vehicle-categories'),
      200,
      'categories',
    ).map((c) => c.id);
    assert(!pub.includes('scooter'), 'scooter public');
    const r = await superAdmin('PATCH', '/admin/vehicle-categories/scooter', { isActive: true });
    assert(r.status === 409, `activation → ${r.status}`);
    return 'inactive; not public; activation by super admin → 409';
  });
  await step(88, 'tuk-tuk category inactive', async () => {
    assert(
      sql(`select is_active from vehicle_categories where id = 'tuktuk'`) === 'f',
      'tuktuk active',
    );
    const r = await superAdmin('PATCH', '/admin/vehicle-categories/tuktuk', { isActive: true });
    assert(r.status === 409, `activation → ${r.status}`);
    return 'inactive; activation by super admin → 409';
  });
  await step(43, 'no token, password or hash in any non-auth response', async () => {
    const all = captured.map((c) => c.text).join('\n');
    const leaked = secrets.filter((s) => all.includes(s));
    assert(leaked.length === 0, `secret in a response: ${leaked[0]?.slice(0, 6)}…`);
    for (const s of [
      'password_hash',
      'passwordHash',
      'tokenHash',
      'token_hash',
      'md5sig',
      'merchantSecret',
      'vrp-private',
      'secretEnvelope',
      '$argon2',
    ])
      assert(!all.includes(s), `"${s}" in a response`);
    return `${captured.length} successful non-auth responses: no token, password, hash, signature, MFA secret or private storage key`;
  });
  await step(93, 'pages render (including the new security page)', async () => {
    const pages = [
      '/',
      '/search',
      `/vehicles/${ctx.vehicle.slug}`,
      '/login',
      '/account',
      '/account/security',
      '/account/privacy',
      '/admin',
      '/admin/privacy-requests',
      '/admin/system',
    ];
    for (const p of pages) {
      const r = await fetch(`${WEB}${p}`);
      assert(r.status === 200, `${p} → ${r.status}`);
      const html = await r.text();
      for (const s of [ctx.vehicle.plate, ctx.provider.email, ctx.note, ctx.docKey])
        assert(!html.includes(s), `${p} leaks ${String(s).slice(0, 20)}`);
    }
    return `${pages.length} pages → 200 without leaking plate / e-mail / note / keys`;
  });

  // ----------------------------------------------------------- 89–92 shutdown
  if (boss) await boss.stop({ graceful: true, timeout: 5000 }).catch(() => {});
  boss = undefined;
  const probeExit = await stopGracefully(ctx.probe);
  await step(89, 'API shuts down cleanly', async () => {
    const exit = await stopGracefully(ctx.api);
    const logText = fs.readFileSync(ctx.api.file, 'utf8');
    assert(
      exit.code === 0 && logText.includes('[smoke] graceful shutdown completed'),
      `exit ${JSON.stringify(exit)}`,
    );
    assert(!(await portOpen(API_PORT)), 'port still open');
    assert(probeExit.code === 0, `probe exit ${JSON.stringify(probeExit)}`);
    return 'SIGTERM → Nest shutdown hooks completed, exit 0, port 4000 released; production-mode probe also exited 0';
  });
  await step(90, 'worker shuts down cleanly', async () => {
    const exit = await stopGracefully(ctx.worker);
    const logText = fs.readFileSync(ctx.worker.file, 'utf8');
    assert(
      exit.code === 0 && logText.includes('[smoke] graceful shutdown completed'),
      `exit ${JSON.stringify(exit)}`,
    );
    return 'SIGTERM → Nest shutdown hooks completed (pg-boss stopped), exit 0';
  });
  await step(91, 'web shuts down cleanly', async () => {
    const exit = await stopGracefully(ctx.web);
    // Next.js's own SIGTERM cleanup ends with process.exit(143) (128 + SIGTERM) by design.
    assert(exit.code === 143 || exit.code === 0, `exit ${JSON.stringify(exit)}`);
    assert(!(await portOpen(WEB_PORT)), 'port still open');
    return `next start ran its SIGTERM cleanup (exit ${exit.code}), port 3000 released`;
  });
  await step(92, 'no temporary test processes or connections left', async () => {
    const alive = children.filter((c) => !c.exit).map((c) => c.name);
    assert(alive.length === 0, `still running: ${alive}`);
    for (const port of [API_PORT, PROBE_PORT, WEB_PORT])
      assert(!(await portOpen(port)), `port ${port} open`);
    if (process.platform === 'win32') {
      const tasks = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], { encoding: 'utf8' }).stdout;
      const pids = children
        .map((c) => String(c.child.pid))
        .filter((pid) => tasks.includes(`"${pid}"`));
      assert(pids.length === 0, `pids alive: ${pids}`);
    }
    let pg = 0;
    for (let i = 0; i < 20; i += 1) {
      pg = Number(
        sql(
          `select count(*) from pg_stat_activity where datname = '${DB_NAME}' and application_name = 'postgres.js'`,
        ),
      );
      if (pg <= ctx.pgClientsBefore) break;
      await sleep(500);
    }
    assert(
      pg <= ctx.pgClientsBefore,
      `${pg} app connections left (before: ${ctx.pgClientsBefore})`,
    );
    return `${children.length} processes exited; ports ${API_PORT}/${PROBE_PORT}/${WEB_PORT} free; database connections back to ${pg}`;
  });
} catch (e) {
  log(`[fatal] ${e.stack ?? e.message}`);
  results.push({ no: 'setup', title: 'fatal error outside a step', ok: false });
} finally {
  if (boss) await boss.stop({ graceful: false, timeout: 2000 }).catch(() => {});
  forceStopAll();
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  log(
    `\nSUMMARY: ${passed}/${results.length} steps passed${failed.length ? ` — FAILED: ${failed.map((r) => r.no).join(', ')}` : ''}`,
  );
  const ok = failed.length === 0 && results.length >= REQUIRED_STEPS;
  if (!ok && failed.length === 0)
    log(`only ${results.length} steps ran; ${REQUIRED_STEPS} required`);
  log(`EXIT ${ok ? 0 : 1}`);
  process.exit(ok ? 0 : 1);
}
