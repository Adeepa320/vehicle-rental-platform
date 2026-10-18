import { defineConfig, devices } from '@playwright/test';

import {
  API_DIR,
  API_URL,
  E2E_DIR,
  WEB_URL,
  WORKER_HEALTH_PORT,
  apiEnv,
  webEnv,
  workerEnv,
} from './fixtures/env';

/**
 * Which Chromium to drive. Default: the installed Google Chrome (`chrome`), so a
 * local run needs no browser download. `PLAYWRIGHT_CHANNEL=msedge` uses Edge;
 * an empty `PLAYWRIGHT_CHANNEL=` selects Playwright's bundled Chromium
 * (`pnpm --filter @vrp/e2e install:browsers` first), which is what CI should use.
 */
const browserChannel = process.env.PLAYWRIGHT_CHANNEL ?? 'chrome';

/**
 * Browser end-to-end suite (Phase 10). Runs against the *built* API, worker and
 * web app, started here with `reuseExistingServer: false` so the run never
 * talks to a stray dev server. Servers start in order: API → worker → web.
 * The `setup` project creates the shared accounts once; spec files then run in
 * parallel with their own vehicles, customers and admins.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 3,
  timeout: 150_000,
  expect: { timeout: 15_000 },
  outputDir: 'test-results',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'test-results/results.json' }],
  ],
  use: {
    baseURL: WEB_URL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    locale: 'en-GB',
    timezoneId: 'Asia/Colombo',
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/, timeout: 180_000 },
    {
      name: 'chromium',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        ...(browserChannel ? { channel: browserChannel } : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: API_DIR,
      url: `${API_URL}/ready`,
      env: apiEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'node scripts/run-worker.mjs',
      cwd: E2E_DIR,
      url: `http://127.0.0.1:${WORKER_HEALTH_PORT}/health`,
      env: workerEnv(),
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'pnpm --filter @vrp/web start',
      cwd: E2E_DIR,
      url: WEB_URL,
      env: webEnv(),
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
