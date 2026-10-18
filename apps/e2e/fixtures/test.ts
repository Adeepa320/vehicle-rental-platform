import { test as base, expect, type Page, type TestInfo } from '@playwright/test';

import { getBooking } from './bookings';
import { API_ORIGIN, API_URL } from './env';
import { freshTotpCode } from './totp';
import { loadWorld, type World } from './world';

/** Everything the browser reported that a clean page must not produce. */
export interface ConsoleWatch {
  /** `console.error` output and failed resource loads that are not expected (fail the test). */
  errors: string[];
  /** Uncaught exceptions / unhandled rejections in the page (fail the test). */
  pageErrors: string[];
  /** Subset of `errors`: Content-Security-Policy refusals, with the blocked resource and directive. */
  cspViolations: string[];
  /**
   * `Failed to load resource` entries Chromium logs for API responses with an
   * expected 4xx status (401 on the silent refresh of an anonymous visitor,
   * 403/409 refusals a scenario provokes on purpose). Reported, never fatal.
   */
  expectedApiRefusals: string[];
  /** Messages matched by `KNOWN_CONSOLE_ISSUES` (documented defects of the app under test). Reported, never fatal. */
  knownIssues: string[];
  /** Fails the test if anything was collected; attaches the full list to the report. */
  assertClean(testInfo?: TestInfo): Promise<void>;
}

/** Chromium's wording for every enforced CSP refusal ("Refused to …", "Sending form data to … violates …"). */
const CSP_PATTERN = /Content Security Policy/i;
const RESOURCE_PATTERN = /^Failed to load resource: the server responded with a status of (\d{3})/;
/** API statuses the application handles itself; anything else (5xx, missing assets) is an error. */
const EXPECTED_API_STATUSES = new Set([400, 401, 403, 404, 409, 422]);

/**
 * Console errors the web app produces today that the suite documents instead of
 * fixing (it cannot change `apps/web`). Matching messages are reported as
 * `knownIssues` in the attachment and do not fail the test; anything else does.
 */
export const KNOWN_CONSOLE_ISSUES: {
  id: string;
  matches: (text: string, url: string) => boolean;
  note: string;
}[] = [
  // 'maplibre-worker-blocked-by-csp' was resolved on 2026-10-18 (risk register O12): the worker is
  // served from /maplibre/ so its shared-module import resolves. A worker error now fails the test.
];

/**
 * Records console errors, uncaught page errors and CSP refusals on a page.
 * Attach it to every page the test opens (the `page` fixture does so itself).
 */
export function watchConsole(page: Page): ConsoleWatch {
  const errors: string[] = [];
  const pageErrors: string[] = [];
  const cspViolations: string[] = [];
  const expectedApiRefusals: string[] = [];
  const knownIssues: string[] = [];
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const location = message.location();
    const where = location.url ? ` [${location.url}:${location.lineNumber}]` : '';
    const text = `${message.text()}${where}`;
    const known = KNOWN_CONSOLE_ISSUES.find((issue) => issue.matches(message.text(), location.url));
    if (known) {
      knownIssues.push(`${known.id}: ${text}`);
      return;
    }
    if (CSP_PATTERN.test(message.text())) {
      cspViolations.push(text);
      errors.push(text);
      return;
    }
    const resource = RESOURCE_PATTERN.exec(message.text());
    if (resource) {
      const status = Number(resource[1]);
      if (location.url.startsWith(API_ORIGIN) && EXPECTED_API_STATUSES.has(status)) {
        expectedApiRefusals.push(text);
        return;
      }
    }
    errors.push(text);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(`${error.name}: ${error.message}`);
  });
  return {
    errors,
    pageErrors,
    cspViolations,
    expectedApiRefusals,
    knownIssues,
    async assertClean(testInfo) {
      const anything =
        errors.length + pageErrors.length + expectedApiRefusals.length + knownIssues.length > 0;
      if (testInfo && anything) {
        await testInfo.attach('browser-console', {
          contentType: 'application/json',
          body: JSON.stringify(
            { errors, pageErrors, cspViolations, expectedApiRefusals, knownIssues },
            null,
            2,
          ),
        });
      }
      expect.soft(cspViolations, `Content-Security-Policy violations on ${page.url()}`).toEqual([]);
      expect.soft(pageErrors, `uncaught page errors on ${page.url()}`).toEqual([]);
      expect(errors, `browser console errors on ${page.url()}`).toEqual([]);
    },
  };
}

/**
 * The map is a third-party convenience layer (OpenFreeMap tiles). Unless
 * `E2E_REAL_MAP=1`, its style is answered locally with an empty MapLibre style so
 * the run is deterministic and offline-safe; the CSP still has to allow the
 * origin for the request to be made at all.
 */
export async function stubMapTiles(page: Page): Promise<void> {
  if (process.env.E2E_REAL_MAP === '1') return;
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ version: 8, sources: {}, layers: [] }),
    }),
  );
}

export interface Fixtures {
  world: World;
  consoleWatch: ConsoleWatch;
}

/**
 * Project-wide test base: every page is watched for console errors, uncaught
 * exceptions and CSP refusals, and the test fails at the end if any occurred.
 */
/** Console watches per page created by the `page` fixture. */
const watches = new WeakMap<Page, ConsoleWatch>();

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their dependencies
  world: async ({}, use) => {
    await use(loadWorld());
  },
  // The watch is created by the `page` override below; this fixture only exposes it.
  consoleWatch: async ({ page }, use) => {
    const watch = watches.get(page);
    if (!watch) throw new Error('consoleWatch is only available for the page fixture');
    await use(watch);
  },
  page: async ({ page }, use, testInfo) => {
    await stubMapTiles(page);
    const watch = watchConsole(page);
    watches.set(page, watch);
    await use(page);
    await watch.assertClean(testInfo);
  },
});

export { expect };

/** The status badge next to the page title of a booking / listing page (inside `<main><header>`). */
export function statusBadge(page: Page, label: string) {
  return page.locator('main header').getByText(label, { exact: true });
}

export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export const FAKE_CHECKOUT_URL = `${API_URL}/payments/fake/checkout`;

export type FakeOutcome = 'success' | 'cancel' | 'fail';
const FAKE_BUTTON: Record<FakeOutcome, string> = {
  success: 'Pay successfully',
  cancel: 'Cancel payment',
  fail: 'Simulate a failed payment',
};

/**
 * On the fake gateway page, presses the button for `outcome` and lands on the
 * payment status page. The gateway processes the notification and answers a
 * 303 to `/bookings/{id}/payment?result=…`; Chromium currently refuses that
 * redirect (see `fake-gateway-redirect-blocked-by-form-action` in
 * `KNOWN_CONSOLE_ISSUES`), so when the browser is still on the gateway page
 * once the API shows the outcome, the helper opens the return URL itself.
 * The redirect proper is asserted by a `test.fail` test in the happy path.
 */
export async function completeFakePayment(
  page: Page,
  outcome: FakeOutcome,
  booking: { id: string; customerToken: string },
): Promise<void> {
  const expectedState =
    outcome === 'success' ? 'paid' : outcome === 'cancel' ? 'cancelled' : 'failed';
  const result = outcome === 'success' ? 'return' : 'cancel';
  const returnPath = `/bookings/${booking.id}/payment?result=${result}`;
  await expect(page).toHaveURL(FAKE_CHECKOUT_URL);
  await page.getByRole('button', { name: FAKE_BUTTON[outcome] }).click();
  await expect
    .poll(
      async () => {
        if (page.url().includes('/payment?result=')) return 'redirected';
        const current = await getBooking(booking.customerToken, booking.id);
        return current.payment.state === expectedState ? 'processed' : 'pending';
      },
      {
        timeout: 30_000,
        intervals: [500, 1_000],
        message: `gateway outcome "${outcome}" reaches the API`,
      },
    )
    .not.toBe('pending');
  if (!page.url().includes('/payment?result=')) await page.goto(returnPath);
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(returnPath)}$`));
}

export interface UiLoginOptions {
  /** Where to land afterwards (`/login?next=…`); defaults to the account page. */
  next?: string;
  /** Base32 secret of an enrolled administrator: completes the authenticator step. */
  totpSecret?: string | null;
}

/** Logs in through the real login page (and the two-step page for enrolled admins). */
export async function loginViaUi(
  page: Page,
  account: { email: string; password: string },
  options: UiLoginOptions = {},
): Promise<void> {
  const next = options.next ? `?next=${encodeURIComponent(options.next)}` : '';
  await page.goto(`/login${next}`);
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Password').fill(account.password);
  await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
  if (options.totpSecret) {
    // The card title is a <div>, not a heading.
    await expect(page.getByText('Two-step verification', { exact: true })).toBeVisible();
    await page.getByLabel('Authenticator code').fill(await freshTotpCode(options.totpSecret));
    await page.getByRole('button', { name: 'Verify and log in' }).click();
  }
  await expect(page).not.toHaveURL(/\/login/);
  // The header switches to the account menu once the session is stored.
  await expect(
    page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Log out' }),
  ).toBeVisible();
}
