import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { MIGRATIONS_FOLDER } from '../migrate';

/**
 * drizzle-kit quotes column types it does not recognise as native, and PostGIS
 * `geography(...)` is not on its list, so a generated migration contains
 * `"geography(Point,4326)"` — which PostgreSQL rejects as an unknown type.
 * Generated SQL must be hand-corrected (DATABASE_DESIGN.md §2); this test
 * fails fast if a future migration ships with the quoted form.
 */
describe('migration files', () => {
  const files = fs
    .readdirSync(MIGRATIONS_FOLDER)
    .filter((name) => name.endsWith('.sql'))
    .sort();

  it('exist and are listed in the journal in order', () => {
    const journal = JSON.parse(
      fs.readFileSync(path.join(MIGRATIONS_FOLDER, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { idx: number; tag: string }[] };
    expect(files.length).toBeGreaterThan(0);
    expect(journal.entries.map((entry) => `${entry.tag}.sql`)).toEqual(files);
    expect(journal.entries.map((entry) => entry.idx)).toEqual(files.map((_, i) => i));
  });

  it('never quote PostGIS geography/geometry column types', () => {
    for (const file of files) {
      const sql = fs.readFileSync(path.join(MIGRATIONS_FOLDER, file), 'utf8');
      expect(sql, `${file} contains a quoted PostGIS type; remove the double quotes`).not.toMatch(
        /"geo(graphy|metry)\(/i,
      );
    }
  });

  it('create the required extensions in the first migration', () => {
    const first = fs.readFileSync(path.join(MIGRATIONS_FOLDER, files[0] as string), 'utf8');
    for (const extension of ['postgis', 'btree_gist', 'citext']) {
      expect(first).toMatch(new RegExp(`CREATE EXTENSION IF NOT EXISTS ${extension}`, 'i'));
    }
  });
});
