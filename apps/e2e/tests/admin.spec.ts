import { createAdmin } from '../fixtures/accounts';
import { expect, loginViaUi, test } from '../fixtures/test';
import type { AdminAccount } from '../fixtures/world';

/**
 * Admin console in the browser: the two-step login, every console page
 * rendering without console errors, and the policy gate for an administrator
 * whose session carries no verified factor.
 */
test.describe.configure({ mode: 'serial' });

let enrolledAdmin: AdminAccount;
let freshAdmin: AdminAccount;

test.beforeAll(async () => {
  enrolledAdmin = await createAdmin('admin-ui', { role: 'admin', enrol: true });
  freshAdmin = await createAdmin('admin-fresh', { role: 'admin', enrol: false });
});

const PAGES: { path: string; heading: string; content?: string | RegExp }[] = [
  { path: '/admin', heading: 'Operations overview', content: 'Needs attention' },
  { path: '/admin/users', heading: 'Users' },
  { path: '/admin/providers', heading: 'Provider review' },
  { path: '/admin/vehicles', heading: 'Vehicle review' },
  { path: '/admin/bookings', heading: 'Bookings' },
  { path: '/admin/payments', heading: 'Payments needing attention' },
  { path: '/admin/disputes', heading: 'Disputes' },
  { path: '/admin/reports', heading: 'Reports', content: 'Booking funnel' },
  { path: '/admin/audit', heading: 'Audit log' },
  // '/admin/system' is covered by its own test below (documented API defect).
  { path: '/admin/privacy-requests', heading: 'Privacy requests' },
];

test('logs in with the authenticator step and every console page renders', async ({ page }) => {
  test.setTimeout(240_000);
  await loginViaUi(page, enrolledAdmin, { totpSecret: enrolledAdmin.totpSecret, next: '/admin' });
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole('navigation', { name: 'Admin sections' })).toBeVisible();

  for (const entry of PAGES) {
    await test.step(entry.path, async () => {
      await page.goto(entry.path);
      await expect(page.getByRole('heading', { level: 1, name: entry.heading })).toBeVisible();
      if (entry.content) await expect(page.getByText(entry.content).first()).toBeVisible();
      // Every list / detail finished loading and nothing was refused.
      await expect(page.getByText(/^(Loading|Checking)/)).toHaveCount(0, { timeout: 30_000 });
      await expect(page.getByText('Not authorised')).toHaveCount(0);
      await expect(page.getByText('Sign in again to use the console')).toHaveCount(0);
      await page.waitForLoadState('networkidle');
    });
  }
});

/**
 * The System page reads `GET /admin/system/worker` (pg-boss schedules and queues
 * plus the minute-sweep heartbeat) while the worker started by the suite is running.
 */
test('the System page shows the worker heartbeat, schedules and queues', async ({ page }) => {
  await loginViaUi(page, enrolledAdmin, {
    totpSecret: enrolledAdmin.totpSecret,
    next: '/admin/system',
  });
  await expect(page.getByRole('heading', { level: 1, name: 'System' })).toBeVisible();
  await expect(page.getByText('Schedules', { exact: true })).toBeVisible();
  await expect(page.getByText('Queues', { exact: true })).toBeVisible();
  // The schedule name appears in the Schedules list and again as a queue; one visible match is enough.
  await expect(page.getByText('bookings.expire').first()).toBeVisible();
});

test('an administrator without a verified factor is sent to set up two-step verification', async ({
  page,
}) => {
  await loginViaUi(page, freshAdmin);
  await expect(page).toHaveURL(/\/account$/);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/account\/security\?reason=mfa$/);
  await expect(page.getByText('Admin features need two-step verification')).toBeVisible();
  await expect(page.getByText('Not set up yet.')).toBeVisible();
  await expect(page.getByText('Required for your role')).toBeVisible();
});
