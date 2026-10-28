#!/usr/bin/env node
/**
 * Runs a pnpm command with DATABASE_URL pointed at the local demo database
 * (`vehicle_rental_demo`, created by `pnpm demo:seed`). Everything else comes
 * from the repo-root `.env` as usual; the dev database is never touched.
 *
 *   node scripts/with-demo-db.mjs --filter @vrp/api dev:worker
 *
 * Local only: refuses NODE_ENV=production, a LAUNCH_MODE and non-local database hosts.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function dotEnv(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!match) continue;
    let value = match[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[match[1]] = value;
  }
  return out;
}

function fail(message) {
  console.error(`with-demo-db: ${message}`);
  process.exit(1);
}

const fileEnv = dotEnv(path.join(ROOT, '.env'));
const env = { ...fileEnv, ...process.env };
if (env.NODE_ENV === 'production' || env.LAUNCH_MODE) {
  fail('refusing to run the demo with NODE_ENV=production or a LAUNCH_MODE');
}
if (!env.DATABASE_URL) fail('DATABASE_URL is not set (copy .env.example to .env)');

const url = new URL(env.DATABASE_URL);
if (!LOCAL_HOSTS.has(url.hostname)) fail('the demo only runs against a database on localhost');
const name = env.DEMO_DATABASE_NAME ?? 'vehicle_rental_demo';
if (!/^[a-z_][a-z0-9_]*_demo$/.test(name)) fail('DEMO_DATABASE_NAME must end in "_demo"');
url.pathname = `/${name}`;

const args = process.argv.slice(2);
if (args.length === 0) fail('usage: node scripts/with-demo-db.mjs <pnpm arguments>');

/** True when something already listens on the port (e.g. a running `pnpm dev`). */
function inUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
}

// The demo shares the dev build folders: a second `nest start --watch` would wipe apps/api/dist
// under a running `pnpm dev`, so web + API refuse to start while the dev servers are up.
// (The worker has no port to probe: stop `pnpm dev:worker` before `pnpm demo:worker`.)
if (args.includes('dev')) {
  for (const port of [Number(env.API_PORT ?? 4000), 3000]) {
    if (await inUse(port)) fail(`port ${port} is already in use; stop \`pnpm dev\` first`);
  }
}
console.warn(`with-demo-db: DATABASE_URL → local database "${name}"`);

// One command string: Node 24 warns (DEP0190) when an argument array is used with a shell.
const child = spawn(`pnpm ${args.join(' ')}`, {
  cwd: ROOT,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, DATABASE_URL: url.toString() },
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
