#!/usr/bin/env node
/**
 * EXPLAIN (ANALYZE, BUFFERS) for the public search as PostgreSQL executes it
 * (Phase 10 performance review). Mirrors `DiscoveryService.search`: the
 * searchable predicate (approved + slug, active provider, active location,
 * active category, ≥ 3 photos), the radius filter on `provider_locations.geom`,
 * the `NOT EXISTS` over `vehicle_holds` for a date window and the keyset
 * ordering, with `limit 21`. Run it against the synthetic dataset:
 *
 *   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/vehicle_rental_perf node apps/api/scripts/perf/explain.mjs [--out plans.txt]
 *
 * The output is meant to be read for sequential scans, index usage (GiST on
 * geom, the vehicle_holds range index, status/category indexes) and the
 * photo-count subquery cost; nothing is changed in the database.
 */
import { writeFileSync } from 'node:fs';

import { createDatabase } from '@vrp/database';
import { sql as drizzleSql } from 'drizzle-orm';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const out = outIndex >= 0 ? args[outIndex + 1] : undefined;
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required (point it at the perf database)');
  process.exit(2);
}

const handle = createDatabase({ url, max: 1, applicationName: 'vrp-perf-explain' });
const db = handle.db;
const query = (text) => db.execute(drizzleSql.raw(text));

const SEARCHABLE = `
  v.status = 'approved' and v.deleted_at is null and v.slug is not null
  and pp.status = 'active' and pp.deleted_at is null
  and pl.is_active = true and vc.is_active = true
  and (select count(*) from vehicle_photos ph where ph.vehicle_id = v.id and ph.deleted_at is null) >= 3`;

const FROM = `
  from vehicles v
  join provider_profiles pp on pp.id = v.provider_id
  join provider_locations pl on pl.id = v.location_id
  join vehicle_categories vc on vc.id = v.category_id`;

async function main() {
  const [place] = await query(
    'select id, name from places where is_launch_area = true order by search_rank desc, name limit 1',
  );
  if (!place) throw new Error('no launch-area place');
  const centre = `(select geom from places where id = '${place.id}')`;
  const start = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const end = new Date(Date.now() + 10 * 86_400_000).toISOString();
  const queries = {
    'place radius 15 km, relevance': `
      select v.id, v.slug, v.daily_rate, coalesce(ST_Distance(pl.geom, ${centre}), 1e9) as distance_m
      ${FROM}
      where ${SEARCHABLE}
        and ST_DWithin(pl.geom, ${centre}, 15000)
      order by distance_m asc, v.id desc
      limit 21`,
    'place + category + dates (holds excluded)': `
      select v.id, v.slug, v.daily_rate, coalesce(ST_Distance(pl.geom, ${centre}), 1e9) as distance_m
      ${FROM}
      where ${SEARCHABLE}
        and v.category_id = 'car'
        and ST_DWithin(pl.geom, ${centre}, 15000)
        and not exists (select 1 from vehicle_holds h where h.vehicle_id = v.id and h.starts_at < '${end}'::timestamptz and h.ends_at > '${start}'::timestamptz)
        and v.min_rental_days <= 3 and (v.max_rental_days is null or v.max_rental_days >= 3)
      order by distance_m asc, v.id desc
      limit 21`,
    'place radius 30 km, price ascending': `
      select v.id, v.slug, v.daily_rate
      ${FROM}
      where ${SEARCHABLE}
        and ST_DWithin(pl.geom, ${centre}, 30000)
      order by v.daily_rate asc, v.id desc
      limit 21`,
    'count searchable (no place)': `
      select count(*) ${FROM} where ${SEARCHABLE}`,
  };
  const chunks = [
    `# EXPLAIN (ANALYZE, BUFFERS) — ${new Date().toISOString()} — place ${place.name}\n`,
  ];
  for (const [name, text] of Object.entries(queries)) {
    const rows = await query(`explain (analyze, buffers, format text) ${text}`);
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    const timing = /Execution Time: ([\d.]+) ms/.exec(plan)?.[1];
    const seq = (plan.match(/Seq Scan on (\w+)/g) ?? []).map((s) => s.replace('Seq Scan on ', ''));
    chunks.push(
      `\n## ${name}\nexecution ${timing ?? '?'} ms; sequential scans: ${seq.length ? seq.join(', ') : 'none'}\n\n${plan}\n`,
    );
    console.warn(
      `${name}: ${timing ?? '?'} ms${seq.length ? ` (seq scan: ${seq.join(', ')})` : ''}`,
    );
  }
  const [counts] = await query(
    'select (select count(*) from vehicles) as vehicles, (select count(*) from vehicle_holds) as holds, (select count(*) from provider_locations) as locations',
  );
  chunks.push(`\n## dataset\n${JSON.stringify(counts)}\n`);
  if (out) {
    writeFileSync(out, chunks.join(''));
    console.warn(`written ${out}`);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => handle.close());
