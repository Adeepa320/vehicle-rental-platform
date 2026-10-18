import fs from 'node:fs';
import path from 'node:path';

import AxeBuilder from '@axe-core/playwright';
import type { Page, TestInfo } from '@playwright/test';

import { RUN_ID, createAdmin, registerVerifiedUser } from '../fixtures/accounts';
import { providerAction, requestBooking, rentalWindow } from '../fixtures/bookings';
import { E2E_DIR } from '../fixtures/env';
import { createApprovedVehicle, uniqueDailyRate, type ApprovedVehicle } from '../fixtures/provider';
import { expect, loginViaUi, test } from '../fixtures/test';
import { loadWorld, type Account, type AdminAccount, type World } from '../fixtures/world';

/**
 * axe-core audits of the main screens. `serious` and `critical` violations fail
 * the test; everything else is attached to the report and collected in
 * `test-results/a11y-summary.json`.
 */
test.describe.configure({ mode: 'serial' });

let world: World;
let vehicle: ApprovedVehicle;
let customer: Account;
let admin: AdminAccount;
let bookingId = '';
/** Dates of the accepted booking (the vehicle page shows "Not available" for them). */
const stay = rentalWindow(10, 2);
/** Dates nobody has booked. */
const free = rentalWindow(30, 2);

interface PageSummary {
  page: string;
  url: string;
  violations: {
    id: string;
    impact: string | null | undefined;
    count: number;
    help: string;
    targets: string[];
    html: string[];
    summary: string | null;
    known: string | null;
  }[];
}
const summary: PageSummary[] = [];

test.beforeAll(async () => {
  world = loadWorld();
  vehicle = await createApprovedVehicle(world.provider, world.admin.accessToken, {
    title: `E2E Aqua a11y ${RUN_ID}`,
    dailyRate: uniqueDailyRate(),
  });
  customer = await registerVerifiedUser('customer', 'Sunil Perera');
  const booking = await requestBooking(customer.accessToken, vehicle.id, stay);
  await providerAction(world.provider.accessToken, booking.id, 'accept');
  bookingId = booking.id;
  admin = await createAdmin('a11y-admin', { role: 'admin', enrol: true });
});

test.afterAll(async () => {
  const file = path.join(E2E_DIR, 'test-results', 'a11y-summary.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(summary, null, 2));
});

/**
 * Serious / critical findings in the web app that the suite documents instead
 * of fixing (it cannot change `apps/web`). Each entry names the rule and the
 * selector axe reports; matching nodes are reported as `known` and do not fail
 * the test, so a new violation anywhere else still does.
 */
const KNOWN_VIOLATIONS: { rule: string; target?: RegExp; html?: RegExp; note: string }[] = [
  // Empty since 2026-10-18: the colour-contrast (destructive / muted-foreground tokens) and
  // header-label findings of the first runs were fixed in apps/web. Add an entry only for a
  // documented defect that cannot be fixed yet; every other serious / critical violation fails.
];

/**
 * axe groups every offending node of a rule into one violation, so a violation is
 * known only when each of its nodes matches some documented entry for that rule
 * (by selector and / or outer HTML). Returns the matched notes, or null.
 */
function knownNotesFor(rule: string, nodes: { target: string; html: string }[]): string | null {
  const notes = new Set<string>();
  for (const node of nodes) {
    const entry = KNOWN_VIOLATIONS.find(
      (k) =>
        k.rule === rule &&
        (!k.target || k.target.test(node.target)) &&
        (!k.html || k.html.test(node.html)),
    );
    if (!entry) return null;
    notes.add(entry.note);
  }
  return [...notes].join(' | ');
}

/** Waits until the pickup-area map either rendered or showed its fallback notice (the two settled states). */
async function mapSettled(page: Page): Promise<void> {
  // The map mounts only near the viewport (O13); bring the pickup-area card into view first.
  await page.getByText('Pickup area', { exact: true }).scrollIntoViewIfNeeded();
  await expect(
    page.locator('canvas.maplibregl-canvas').or(page.getByText(/Map unavailable/)),
  ).toBeVisible();
}

async function audit(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
  const violations = results.violations.map((v) => {
    const targets = v.nodes.map((n) => n.target.join(' '));
    const nodes = v.nodes.map((n) => ({ target: n.target.join(' '), html: n.html }));
    const known = knownNotesFor(v.id, nodes);
    return {
      id: v.id,
      impact: v.impact,
      count: v.nodes.length,
      help: v.help,
      targets: targets.slice(0, 5),
      html: v.nodes.slice(0, 3).map((n) => n.html.slice(0, 300)),
      summary: v.nodes[0]?.failureSummary ?? null,
      known,
    };
  });
  summary.push({ page: name, url: page.url(), violations });
  await testInfo.attach(`axe-${name}`, {
    contentType: 'application/json',
    body: JSON.stringify({ url: page.url(), violations }, null, 2),
  });
  const blocking = violations.filter(
    (v) => (v.impact === 'serious' || v.impact === 'critical') && v.known === null,
  );
  expect(
    blocking,
    `serious/critical accessibility violations on ${name}: ${blocking.map((v) => `${v.id} (${v.impact}, ${v.count})`).join(', ')}`,
  ).toEqual([]);
}

test('home', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByLabel('Where')).toContainText('Mirissa');
  await audit(page, testInfo, 'home');
});

test('search results', async ({ page }, testInfo) => {
  await page.goto(
    `/search?placeId=${world.places.mirissaId}&startDate=${stay.startDay}&endDate=${stay.endDay}`,
  );
  await expect(page.getByRole('heading', { name: 'Vehicles near Mirissa' })).toBeVisible();
  await expect(page.getByRole('article').first()).toBeVisible();
  await audit(page, testInfo, 'search');
});

test('vehicle page (available dates)', async ({ page }, testInfo) => {
  await page.goto(`/vehicles/${vehicle.slug}?startDate=${free.startDay}&endDate=${free.endDay}`);
  await expect(page.getByRole('heading', { level: 1, name: vehicle.title })).toBeVisible();
  await expect(page.getByText('Available', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Reviews' })).toContainText('No reviews yet');
  await mapSettled(page);
  await audit(page, testInfo, 'vehicle');
});

test('vehicle page (dates taken)', async ({ page }, testInfo) => {
  await page.goto(`/vehicles/${vehicle.slug}?startDate=${stay.startDay}&endDate=${stay.endDay}`);
  await expect(page.getByText('Not available', { exact: true })).toBeVisible();
  await mapSettled(page);
  await audit(page, testInfo, 'vehicle-unavailable');
});

test('booking form', async ({ page }, testInfo) => {
  await loginViaUi(page, customer, {
    next: `/bookings/new?vehicle=${vehicle.slug}&startDate=${stay.startDay}&endDate=${stay.endDay}`,
  });
  await expect(page.getByRole('heading', { name: 'Request to book' })).toBeVisible();
  await expect(page.getByLabel('Driver’s full name')).toHaveValue(customer.fullName);
  await audit(page, testInfo, 'booking-form');
});

test('account security (change password)', async ({ page }, testInfo) => {
  await loginViaUi(page, customer, { next: '/account/security' });
  await expect(page.getByLabel('Current password')).toBeVisible();
  await expect(page.getByText('Not available for your account.')).toBeVisible();
  await audit(page, testInfo, 'account-security');
});

test('booking detail', async ({ page }, testInfo) => {
  await loginViaUi(page, customer, { next: `/bookings/${bookingId}` });
  await expect(page.getByRole('button', { name: /^Pay advance securely/ })).toBeVisible();
  await audit(page, testInfo, 'booking-detail');
});

test('provider booking detail', async ({ page }, testInfo) => {
  await loginViaUi(page, world.provider, { next: `/provider/bookings/${bookingId}` });
  await expect(page.getByText('Awaiting the customer’s advance.')).toBeVisible();
  await audit(page, testInfo, 'provider-booking-detail');
});

test('payment status', async ({ page }, testInfo) => {
  await loginViaUi(page, customer, { next: `/bookings/${bookingId}/payment` });
  await expect(page.getByRole('heading', { name: 'Payment status' })).toBeVisible();
  await expect(page.getByText('Waiting for payment confirmation')).toBeVisible();
  await audit(page, testInfo, 'payment-status');
});

test('admin overview', async ({ page }, testInfo) => {
  await loginViaUi(page, admin, { totpSecret: admin.totpSecret, next: '/admin' });
  await expect(page.getByRole('heading', { level: 1, name: 'Operations overview' })).toBeVisible();
  await expect(page.getByText('Needs attention')).toBeVisible();
  await expect(page.getByText(/^Loading/)).toHaveCount(0);
  await audit(page, testInfo, 'admin-overview');
});
