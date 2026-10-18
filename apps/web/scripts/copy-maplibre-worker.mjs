// Copies MapLibre's worker module and the shared module it imports into
// `public/maplibre/` before `next dev` / `next build` (risk register O12).
//
// The bundler emits `maplibre-gl-shared.mjs` under a content-hashed name, but
// the worker module imports it as `./maplibre-gl-shared.mjs`, so a bundled
// worker can never start ("Worker failed to load"). Served side by side from a
// stable same-origin path, the relative import resolves and MapLibre creates a
// plain module worker (`worker-src 'self'`) instead of a blob wrapper. Both files
// come from the installed package, so they always match the main-thread version.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(appDir, 'package.json'));
const distDir = path.dirname(require.resolve('maplibre-gl/package.json'));
const target = path.join(appDir, 'public', 'maplibre');

fs.mkdirSync(target, { recursive: true });
for (const file of ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']) {
  fs.copyFileSync(path.join(distDir, 'dist', file), path.join(target, file));
}
console.log(`MapLibre worker copied to ${path.relative(appDir, target)}/`);
