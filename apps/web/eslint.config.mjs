import next from '@vrp/eslint-config/next';

const config = [
  // Vendor files copied from maplibre-gl by scripts/copy-maplibre-worker.mjs.
  { ignores: ['public/maplibre/**'] },
  ...next,
];

export default config;
