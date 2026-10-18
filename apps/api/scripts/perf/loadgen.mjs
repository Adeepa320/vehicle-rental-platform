#!/usr/bin/env node
/**
 * Dependency-free load generator for the Phase 10 performance checks.
 *
 *   node apps/api/scripts/perf/loadgen.mjs --scenario search   --base http://localhost:4000/api/v1 --concurrency 20 --duration 60 --out search.json
 *   node apps/api/scripts/perf/loadgen.mjs --scenario booking  --accounts <file from perf:seed --accounts-out> --concurrency 10 --iterations 200
 *   node apps/api/scripts/perf/loadgen.mjs --scenario conflict --accounts <file> --clients 25
 *
 * Latencies are measured from the client (fetch start → response body read) on the same
 * machine, so they include the HTTP stack but not WAN latency; the report labels them as
 * "client-observed". Percentiles are computed over every request of a scenario and per
 * request variant. Any non-expected status counts as an error.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const args = parseArgs(process.argv.slice(2));
const BASE = (args.base ?? 'http://localhost:4000/api/v1').replace(/\/+$/, '');
const DAY = 86_400_000;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key.slice(2)] = true;
    else {
      out[key.slice(2)] = next;
      i += 1;
    }
  }
  return out;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarise(samples) {
  const ok = samples.filter((s) => s.ok);
  const sorted = ok.map((s) => s.ms).sort((a, b) => a - b);
  return {
    requests: samples.length,
    errors: samples.length - ok.length,
    errorRate:
      samples.length === 0 ? 0 : Number(((samples.length - ok.length) / samples.length).toFixed(4)),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    max: sorted.at(-1) ?? null,
    mean:
      sorted.length === 0
        ? null
        : Number((sorted.reduce((a, b) => a + b, 0) / sorted.length).toFixed(1)),
  };
}

async function timed(name, request, expected = 200) {
  const started = performance.now();
  let status = 0;
  let body = null;
  try {
    const res = await request();
    status = res.status;
    body = await res.json().catch(() => null);
  } catch (error) {
    status = -1;
    body = { error: String(error) };
  }
  const ms = Number((performance.now() - started).toFixed(1));
  return { name, ms, status, ok: status === expected, body };
}

async function runWorkers(concurrency, work) {
  await Promise.all(Array.from({ length: concurrency }, (_, i) => work(i)));
}

function report(title, samples, extra = {}) {
  const byVariant = {};
  for (const s of samples) (byVariant[s.name] ??= []).push(s);
  const result = {
    title,
    base: BASE,
    generatedAt: new Date().toISOString(),
    note: 'client-observed latency in ms on the same host (HTTP stack included, no WAN)',
    overall: summarise(samples),
    variants: Object.fromEntries(Object.entries(byVariant).map(([k, v]) => [k, summarise(v)])),
    ...extra,
  };
  const rows = [['variant', 'req', 'err', 'p50', 'p95', 'p99', 'max']];
  for (const [k, v] of Object.entries(result.variants))
    rows.push([k, v.requests, v.errors, v.p50, v.p95, v.p99, v.max]);
  rows.push([
    'OVERALL',
    result.overall.requests,
    result.overall.errors,
    result.overall.p50,
    result.overall.p95,
    result.overall.p99,
    result.overall.max,
  ]);
  const widths = rows[0].map((_, c) => Math.max(...rows.map((r) => String(r[c] ?? '').length)));
  console.warn(`\n${title}`);
  for (const r of rows)
    console.warn(r.map((cell, c) => String(cell ?? '').padEnd(widths[c])).join('  '));
  if (extra.throughputRps !== undefined)
    console.warn(
      `throughput ${extra.throughputRps} req/s over ${extra.durationSeconds} s, error rate ${result.overall.errorRate}`,
    );
  if (args.out) {
    writeFileSync(args.out, JSON.stringify(result, null, 2));
    console.warn(`written ${args.out}`);
  }
  return result;
}

// ------------------------------------------------------------------ search

async function searchScenario() {
  const concurrency = Number(args.concurrency ?? 20);
  const duration = Number(args.duration ?? 60);
  const random = rng(7);
  const places = await (await fetch(`${BASE}/reference/places`)).json();
  const categories = await (await fetch(`${BASE}/reference/vehicle-categories`)).json();
  const placeList = (places.data ?? places).filter((p) => p.isActive !== false);
  const categoryList = (categories.data ?? categories)
    .filter((c) => c.isActive !== false)
    .map((c) => c.id);
  if (placeList.length === 0 || categoryList.length === 0)
    throw new Error('reference data not reachable');
  const now = Date.now();
  const dates = () => {
    const start = new Date(now + (2 + Math.floor(random() * 28)) * DAY);
    start.setUTCHours(18, 30, 0, 0); // 00:00 Colombo
    const end = new Date(start.getTime() + (1 + Math.floor(random() * 4)) * DAY);
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  };
  const pick = (list) => list[Math.floor(random() * list.length)];
  const variants = [
    ['place', () => ({ placeId: pick(placeList).id, limit: 20 })],
    [
      'place+category',
      () => ({ placeId: pick(placeList).id, categoryId: pick(categoryList), limit: 20 }),
    ],
    ['place+dates', () => ({ placeId: pick(placeList).id, ...dates(), limit: 20 })],
    [
      'place+radius30+distance',
      () => ({ placeId: pick(placeList).id, radiusKm: 30, sort: 'distance', limit: 20 }),
    ],
    [
      'place+dates+price_asc',
      () => ({ placeId: pick(placeList).id, ...dates(), sort: 'price_asc', limit: 20 }),
    ],
    [
      'place+automatic+dates',
      () => ({ placeId: pick(placeList).id, transmission: 'automatic', ...dates(), limit: 20 }),
    ],
  ];
  const samples = [];
  const deadline = Date.now() + duration * 1000;
  const started = Date.now();
  await runWorkers(concurrency, async () => {
    while (Date.now() < deadline) {
      const [name, build] = pick(variants);
      const query = new URLSearchParams(Object.entries(build()).map(([k, v]) => [k, String(v)]));
      const first = await timed(name, () => fetch(`${BASE}/vehicles/search?${query}`));
      samples.push(first);
      if (first.ok && first.body?.nextCursor) {
        query.set('cursor', first.body.nextCursor);
        samples.push(await timed('page2', () => fetch(`${BASE}/vehicles/search?${query}`)));
      }
    }
  });
  const seconds = (Date.now() - started) / 1000;
  return report('Public search (10k listings dataset expected)', samples, {
    concurrency,
    durationSeconds: Number(seconds.toFixed(1)),
    throughputRps: Number((samples.length / seconds).toFixed(1)),
    target: 'PRD §4: search API p95 < 500 ms at 10k listings',
  });
}

// ----------------------------------------------------------------- booking

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
    body: JSON.stringify({ email, password, client: 'mobile' }),
  });
  if (res.status !== 200) throw new Error(`login ${email}: ${res.status}`);
  const body = await res.json();
  if (body.mfaRequired)
    throw new Error(`login ${email}: MFA required; use accounts without MFA for load tests`);
  return body.accessToken;
}

function loadAccounts() {
  if (!args.accounts)
    throw new Error('--accounts <file written by perf:seed --accounts-out> is required');
  return JSON.parse(readFileSync(args.accounts, 'utf8'));
}

async function bookingScenario() {
  const accounts = loadAccounts();
  const concurrency = Number(args.concurrency ?? 10);
  const iterations = Number(args.iterations ?? 200);
  const customers = await Promise.all(
    accounts.customers.slice(0, concurrency).map((c) => login(c.email, accounts.password)),
  );
  const providers = await Promise.all(
    accounts.providers
      .slice(0, concurrency)
      .map(async (p) => ({ ...p, token: await login(p.email, accounts.password) })),
  );
  const samples = [];
  const outcomes = { requested: 0, accepted: 0, acceptConflicts: 0, failures: 0 };
  let next = 0;
  const started = Date.now();
  await runWorkers(concurrency, async (worker) => {
    const customer = customers[worker % customers.length];
    const provider = providers[worker % providers.length];
    for (;;) {
      const iteration = next++;
      if (iteration >= iterations) return;
      const slugs = provider.vehicleSlugs;
      const slug = slugs[iteration % slugs.length];
      const windowIndex = Math.floor(iteration / slugs.length);
      const start = new Date(Date.now() + (3 + windowIndex * 3) * DAY);
      start.setUTCHours(18, 30, 0, 0);
      const end = new Date(start.getTime() + 2 * DAY);
      const quote = await timed('quote', () =>
        fetch(
          `${BASE}/vehicles/${encodeURIComponent(slug)}/quote?startsAt=${start.toISOString()}&endsAt=${end.toISOString()}`,
        ),
      );
      samples.push(quote);
      if (!quote.ok || !quote.body?.bookable) {
        outcomes.failures += 1;
        continue;
      }
      const create = await timed(
        'create-booking',
        () =>
          fetch(`${BASE}/bookings`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${customer}`,
              'idempotency-key': randomUUID(),
            },
            body: JSON.stringify({
              vehicleId: quote.body.vehicle?.id ?? quote.body.vehicleId,
              startsAt: start.toISOString(),
              endsAt: end.toISOString(),
              quoteToken: quote.body.quoteToken,
              driver: {
                fullName: 'Load Test',
                licenceCountry: 'LK',
                licenceExpiresOn: '2030-01-01',
              },
            }),
          }),
        201,
      );
      samples.push(create);
      if (!create.ok) {
        outcomes.failures += 1;
        continue;
      }
      outcomes.requested += 1;
      samples.push(
        await timed('provider-inbox', () =>
          fetch(`${BASE}/providers/me/bookings?status=requested&limit=20`, {
            headers: { authorization: `Bearer ${provider.token}` },
          }),
        ),
      );
      const accept = await timed('accept', () =>
        fetch(`${BASE}/providers/me/bookings/${create.body.id}/accept`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${provider.token}`,
          },
          body: JSON.stringify({ version: create.body.version ?? 1 }),
        }),
      );
      samples.push(accept);
      if (accept.ok) outcomes.accepted += 1;
      else if (accept.status === 409) outcomes.acceptConflicts += 1;
      else outcomes.failures += 1;
    }
  });
  const seconds = (Date.now() - started) / 1000;
  return report('Booking flow: quote → request → inbox → accept', samples, {
    concurrency,
    iterations,
    durationSeconds: Number(seconds.toFixed(1)),
    throughputRps: Number((samples.length / seconds).toFixed(1)),
    outcomes,
    target: 'no official p95 target (PRD); zero correctness failures and an acceptable error rate',
  });
}

// ---------------------------------------------------------------- conflict

async function conflictScenario() {
  const accounts = loadAccounts();
  const clients = Number(args.clients ?? 25);
  const provider = accounts.providers[0];
  const providerToken = await login(provider.email, accounts.password);
  const customers = await Promise.all(
    accounts.customers.slice(0, clients).map((c) => login(c.email, accounts.password)),
  );
  const slug = provider.vehicleSlugs[0];
  const start = new Date(Date.now() + 200 * DAY);
  start.setUTCHours(18, 30, 0, 0);
  const end = new Date(start.getTime() + 2 * DAY);
  const quote = await (
    await fetch(
      `${BASE}/vehicles/${encodeURIComponent(slug)}/quote?startsAt=${start.toISOString()}&endsAt=${end.toISOString()}`,
    )
  ).json();
  if (!quote.bookable) throw new Error(`vehicle ${slug} not bookable for the conflict window`);
  const created = await Promise.all(
    customers.map((token) =>
      timed(
        'create-booking',
        () =>
          fetch(`${BASE}/bookings`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${token}`,
              'idempotency-key': randomUUID(),
            },
            body: JSON.stringify({
              vehicleId: quote.vehicle?.id ?? quote.vehicleId,
              startsAt: start.toISOString(),
              endsAt: end.toISOString(),
              quoteToken: quote.quoteToken,
              driver: {
                fullName: 'Load Test',
                licenceCountry: 'LK',
                licenceExpiresOn: '2030-01-01',
              },
            }),
          }),
        201,
      ),
    ),
  );
  const ids = created.filter((c) => c.ok).map((c) => c.body.id);
  const accepts = await Promise.all(
    ids.map((id) =>
      timed('accept', () =>
        fetch(`${BASE}/providers/me/bookings/${id}/accept`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${providerToken}` },
          body: JSON.stringify({ version: 1 }),
        }),
      ),
    ),
  );
  const accepted = accepts.filter((a) => a.status === 200).length;
  const conflicts = accepts.filter((a) => a.status === 409).length;
  const verdict = accepted === 1 && conflicts === ids.length - 1 ? 'PASS' : 'FAIL';
  console.warn(
    `conflict: ${ids.length} requests for the same vehicle and dates → accepted ${accepted}, 409 ${conflicts}, other ${ids.length - accepted - conflicts} → ${verdict}`,
  );
  return report('Concurrent acceptance of overlapping requests', [...created, ...accepts], {
    clients,
    outcome: { requested: ids.length, accepted, conflicts, verdict },
    target:
      'exactly one accept succeeds; every other accept is 409 (vehicle_holds exclusion constraint)',
  });
}

const scenarios = { search: searchScenario, booking: bookingScenario, conflict: conflictScenario };
const run = scenarios[args.scenario ?? 'search'];
if (!run) {
  console.error(`unknown scenario; use one of ${Object.keys(scenarios).join(', ')}`);
  process.exit(2);
}
run()
  .then((result) => {
    if (result.outcome?.verdict === 'FAIL') process.exitCode = 1;
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
