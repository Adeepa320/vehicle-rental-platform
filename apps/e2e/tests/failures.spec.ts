import {
  PROTECTED_CATEGORY_REASON,
  compareAmounts,
  formatLkr,
  multiplyAmount,
} from '@vrp/contracts';

import { RUN_ID, createAdmin, registerVerifiedUser } from '../fixtures/accounts';
import { call, type ApiErrorBody } from '../fixtures/api';
import {
  completeRental,
  createReview,
  getBooking,
  getQuote,
  listProviderReviews,
  providerAction,
  replyToReview,
  requestBooking,
  rentalWindow,
  type Window,
} from '../fixtures/bookings';
import { sql } from '../fixtures/db';
import {
  createApprovedVehicle,
  uniqueDailyRate,
  vehiclePayload,
  type ApprovedVehicle,
} from '../fixtures/provider';
import {
  FAKE_CHECKOUT_URL,
  completeFakePayment,
  expect,
  loginViaUi,
  statusBadge,
  test,
} from '../fixtures/test';
import { loadWorld, type Account, type AdminAccount, type World } from '../fixtures/world';

/**
 * Refusals the customer, provider and admin must see in the browser: stale
 * quote, stale version, dates taken by another booking, locked contact,
 * failed / cancelled payments, a review locked by the provider's reply, the
 * protected scooter category and an elapsed payment window.
 */
test.describe.configure({ mode: 'serial' });

let world: World;
let vehicle: ApprovedVehicle;
let customerA: Account;
let customerB: Account;
let superAdmin: AdminAccount;
/** Booking A is created in the browser by the stale-quote test and drives the following tests. */
let bookingAId = '';
const stayA: Window = rentalWindow(10, 2);
const stayB: Window = rentalWindow(20, 2);

test.beforeAll(async () => {
  world = loadWorld();
  vehicle = await createApprovedVehicle(world.provider, world.admin.accessToken, {
    title: `E2E Aqua failures ${RUN_ID}`,
    dailyRate: uniqueDailyRate(),
  });
  customerA = await registerVerifiedUser('customer-a', 'Ravi Fernando');
  customerB = await registerVerifiedUser('customer-b', 'Dilani Jayasuriya');
  superAdmin = await createAdmin('failures-admin', { role: 'super_admin', enrol: true });
});

test('a quote whose price changed is refused and refreshed before the request goes through', async ({
  page,
}) => {
  await loginViaUi(page, customerA, {
    next: `/bookings/new?vehicle=${vehicle.slug}&startDate=${stayA.startDay}&endDate=${stayA.endDay}`,
  });
  await expect(page.getByRole('heading', { name: 'Request to book' })).toBeVisible();
  const oldSubtotal = multiplyAmount(vehicle.dailyRate, 2);
  await expect(page.getByText(`Rental ${formatLkr(oldSubtotal)}`)).toBeVisible();

  // The provider raises the daily rate after the page quoted the old one.
  const newRate = String(Number(vehicle.dailyRate) + 500);
  await call('PATCH', `/providers/me/vehicles/${vehicle.id}`, {
    token: world.provider.accessToken,
    body: { dailyRate: newRate },
  });
  await page.getByLabel('Licence valid until').fill('2031-12-31');
  await page.getByRole('button', { name: 'Send booking request' }).click();

  // Scoped to the form: Next.js keeps its own empty route announcer with role="alert" on the page.
  const alert = page.locator('form').getByRole('alert');
  await expect(alert).toContainText(
    'The price above has been refreshed; please review it and submit again.',
  );
  const newSubtotal = multiplyAmount(newRate, 2);
  await expect(page.getByText(`Rental ${formatLkr(newSubtotal)}`)).toBeVisible();
  await expect(page).toHaveURL(/\/bookings\/new/);

  // Submitting the refreshed quote succeeds at the new price.
  await page.getByRole('button', { name: 'Send booking request' }).click();
  await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
  bookingAId = page.url().split('/').pop() as string;
  await expect(statusBadge(page, 'Requested')).toBeVisible();
  const booking = await getBooking(customerA.accessToken, bookingAId);
  expect(compareAmounts(booking.price.subtotal, newSubtotal)).toBe(0);
});

test('accepting a request that was already accepted reports the stale version', async ({
  page,
}) => {
  await loginViaUi(page, world.provider, { next: `/provider/bookings/${bookingAId}` });
  await expect(statusBadge(page, 'Requested')).toBeVisible();
  await page.getByRole('button', { name: 'Accept request' }).click();
  // Meanwhile the same provider accepts from another device.
  const accepted = await providerAction(world.provider.accessToken, bookingAId, 'accept');
  expect(accepted.status).toBe('accepted');
  await page.getByRole('button', { name: 'Accept and reserve' }).click();
  await expect(page.getByRole('alert').first()).toContainText(/reload and try again/);
  await expect(statusBadge(page, 'Requested')).toBeVisible();
  await page.reload();
  await expect(statusBadge(page, 'Accepted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept request' })).toHaveCount(0);
});

test('a second customer cannot book dates reserved by an accepted request', async ({ page }) => {
  const quote = await getQuote(vehicle.slug, stayA);
  expect(quote.bookable).toBe(false);
  expect(quote.reasons).toContain('date_conflict');

  await page.goto(`/vehicles/${vehicle.slug}?startDate=${stayA.startDay}&endDate=${stayA.endDay}`);
  await expect(page.getByText('Not available', { exact: true })).toBeVisible();
  await expect(page.getByText('Not available for these dates.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Request to book' })).toBeDisabled();
  await expect(page.locator('a[href*="/bookings/new"]')).toHaveCount(0);

  // The booking form refuses the dates as well when reached directly.
  await loginViaUi(page, customerB, {
    next: `/bookings/new?vehicle=${vehicle.slug}&startDate=${stayA.startDay}&endDate=${stayA.endDay}`,
  });
  await expect(page.getByText(/cannot be booked for these dates any more/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send booking request' })).toBeDisabled();
});

test('contact details stay locked until the booking is confirmed', async ({ page }) => {
  await loginViaUi(page, customerA, { next: `/bookings/${bookingAId}` });
  await expect(statusBadge(page, 'Accepted')).toBeVisible();
  await expect(
    page.getByText('Contact details are shared once the booking is confirmed.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: /contact details/ })).toHaveCount(0);
  await expect(
    page.getByText('The exact address is shared once the booking is confirmed.'),
  ).toBeVisible();
  await expect(page.getByText('12 Beach Road')).toHaveCount(0);

  const refused = await call<ApiErrorBody>('GET', `/bookings/${bookingAId}/contact`, {
    token: customerA.accessToken,
    expect: [403],
  });
  expect(refused.body.error?.code).toBe('CONTACT_NOT_AVAILABLE_YET');
});

test('failed and cancelled payments can be retried until one succeeds', async ({ page }) => {
  const target = { id: bookingAId, customerToken: customerA.accessToken };
  await loginViaUi(page, customerA, { next: `/bookings/${bookingAId}` });
  await page.getByRole('button', { name: /^Pay advance securely/ }).click();
  await page.waitForURL(FAKE_CHECKOUT_URL);
  await completeFakePayment(page, 'fail', target);
  await expect(page.getByText('Payment failed', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/nothing was charged/)).toBeVisible();

  await page.getByRole('button', { name: /^Pay advance securely/ }).click();
  await page.waitForURL(FAKE_CHECKOUT_URL);
  await completeFakePayment(page, 'cancel', target);
  await expect(page.getByText('Payment cancelled', { exact: true })).toBeVisible({
    timeout: 30_000,
  });

  await page.getByRole('button', { name: /^Pay advance securely/ }).click();
  await page.waitForURL(FAKE_CHECKOUT_URL);
  await completeFakePayment(page, 'success', target);
  await expect(page.getByText('Payment confirmed', { exact: true })).toBeVisible({
    timeout: 45_000,
  });
  const booking = await getBooking(customerA.accessToken, bookingAId);
  expect(booking.status).toBe('confirmed');
  expect(booking.payment.state).toBe('paid');
});

test('a review is locked once the provider has replied', async ({ page }) => {
  await completeRental(world.provider.accessToken, bookingAId);
  const comment = `Great trip along the coast (${RUN_ID}).`;
  await createReview(customerA.accessToken, bookingAId, { overallRating: 5, comment });
  const review = (await listProviderReviews(world.provider.accessToken)).find(
    (r) => r.booking.id === bookingAId,
  );
  expect(review).toBeDefined();
  await replyToReview(world.provider.accessToken, (review as { id: string }).id, 'Come back soon!');

  await loginViaUi(page, customerA, { next: `/bookings/${bookingAId}/review` });
  await expect(page.getByText(comment)).toBeVisible();
  await expect(page.getByText('Come back soon!')).toBeVisible();
  await expect(
    page.getByText('This review can no longer be edited because the provider has replied.'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit review' })).toHaveCount(0);

  const refused = await call<ApiErrorBody>('PUT', `/bookings/${bookingAId}/review`, {
    token: customerA.accessToken,
    body: { overallRating: 1, comment: 'Changed my mind' },
    expect: [409],
  });
  expect(refused.body.error?.code).toBe('REVIEW_LOCKED_AFTER_REPLY');
});

test('the protected scooter category cannot be reactivated or chosen', async ({ page }) => {
  await loginViaUi(page, superAdmin, {
    totpSecret: superAdmin.totpSecret,
    next: '/admin/reference',
  });
  await expect(page.getByRole('heading', { level: 1, name: 'Reference data' })).toBeVisible();
  await page.getByRole('button', { name: 'Categories' }).click();
  const row = page.getByRole('row').filter({ hasText: '(scooter)' });
  await expect(row).toBeVisible();
  await expect(row.getByText('Inactive', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Activate' })).toBeDisabled();
  await expect(row).toContainText('Pending the product / legal decision');

  const refused = await call<ApiErrorBody>('PATCH', '/admin/vehicle-categories/scooter', {
    token: superAdmin.accessToken,
    body: { isActive: true },
    expect: [409],
  });
  expect(refused.body.error?.code).toBe('CONFLICT');
  expect(refused.body.error?.message).toBe(PROTECTED_CATEGORY_REASON);

  const listing = await call('POST', '/providers/me/vehicles', {
    token: world.provider.accessToken,
    body: vehiclePayload(world.provider.locationId, {
      title: `E2E scooter ${RUN_ID}`,
      dailyRate: '2500',
      categoryId: 'scooter',
    }),
    expect: [400, 404, 409, 422],
  });
  expect(listing.status).toBeGreaterThanOrEqual(400);
});

test('an accepted booking whose payment window elapsed is expired by the worker', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const booking = await requestBooking(customerB.accessToken, vehicle.id, stayB);
  await providerAction(world.provider.accessToken, booking.id, 'accept');
  // Move the payment deadline into the past; the worker's expiry sweep runs every minute.
  const updated = sql(
    `update bookings set confirm_by = now() - interval '1 minute' where id = '${booking.id}' and status = 'accepted' returning id`,
  );
  // psql prints the returned row and then the command tag ("UPDATE 1").
  expect(updated).toContain(booking.id);
  await expect
    .poll(async () => (await getBooking(customerB.accessToken, booking.id)).status, {
      timeout: 120_000,
      intervals: [3_000],
      message: 'the worker expires the accepted booking',
    })
    .toBe('expired');

  await loginViaUi(page, customerB, { next: `/bookings/${booking.id}` });
  await expect(statusBadge(page, 'Expired')).toBeVisible();
  await expect(page.getByText('This request expired without a confirmation.')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Pay advance securely/ })).toHaveCount(0);
  const quote = await getQuote(vehicle.slug, stayB);
  expect(quote.bookable, 'the dates are free again').toBe(true);
});
