import { formatLkr } from '@vrp/contracts';

import { RUN_ID, registerVerifiedUser } from '../fixtures/accounts';
import {
  completeRental,
  getQuote,
  listProviderReviews,
  providerAction,
  replyToReview,
  rentalWindow,
  requestBooking,
} from '../fixtures/bookings';
import { createApprovedVehicle, uniqueDailyRate, type ApprovedVehicle } from '../fixtures/provider';
import {
  FAKE_CHECKOUT_URL,
  completeFakePayment,
  escapeRegExp,
  expect,
  loginViaUi,
  statusBadge,
  test,
} from '../fixtures/test';
import { loadWorld, type Account, type World } from '../fixtures/world';

/**
 * The customer journey end to end in one browser session: discover → quote →
 * request (logging in on the way) → provider accepts → pay the advance through
 * the fake gateway → contact reveal → handover → review → provider reply on
 * the public page. Provider-side steps go through the API; `provider.spec.ts`
 * covers them in the browser.
 */
test.describe.configure({ mode: 'serial' });

let world: World;
let vehicle: ApprovedVehicle;
let customer: Account;
const stay = rentalWindow(10, 2);
const reviewText = `Smooth handover and a spotless car (${RUN_ID}).`;
const replyText = `Thank you for renting with us (${RUN_ID}).`;

test.beforeAll(async () => {
  world = loadWorld();
  vehicle = await createApprovedVehicle(world.provider, world.admin.accessToken, {
    title: `E2E Aqua happy ${RUN_ID}`,
    dailyRate: uniqueDailyRate(),
  });
  customer = await registerVerifiedUser('customer', 'Nimal Perera');
});

test('customer searches, requests, pays, collects and reviews', async ({ page }) => {
  test.setTimeout(300_000);
  let bookingId = '';

  await test.step('home → search near Mirissa with dates', async () => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Rent a car');
    await page.getByLabel('Where').selectOption(world.places.mirissaId);
    await page.getByLabel('Pickup').fill(stay.startDay);
    await page.getByLabel('Return').fill(stay.endDay);
    await page.locator('form').getByRole('button', { name: 'Search' }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await expect(page.getByRole('heading', { name: 'Vehicles near Mirissa' })).toBeVisible();
    await expect(page.getByText(/only vehicles free for the whole window/)).toBeVisible();
    // Older runs leave listings behind; the daily-price filter brings this run's car to the first page.
    await page.getByLabel('Minimum daily price (LKR)').fill(vehicle.dailyRate);
    await page.getByLabel('Minimum daily price (LKR)').blur();
    await expect(page).toHaveURL(/minDailyRate=/);
    await page.getByLabel('Maximum daily price (LKR)').fill(vehicle.dailyRate);
    await page.getByLabel('Maximum daily price (LKR)').blur();
    await expect(page).toHaveURL(/maxDailyRate=/);
    const card = page.getByRole('article').filter({ hasText: vehicle.title });
    await expect(card).toBeVisible();
    await expect(card).toContainText(world.provider.displayName);
    await expect(card).toContainText('Platform-approved provider');
    await card.getByRole('link', { name: vehicle.title }).click();
  });

  await test.step('vehicle page quotes the dates and offers the request', async () => {
    await expect(page).toHaveURL(
      new RegExp(
        `/vehicles/${escapeRegExp(vehicle.slug)}\\?startDate=${stay.startDay}&endDate=${stay.endDay}$`,
      ),
    );
    await expect(page.getByRole('heading', { level: 1, name: vehicle.title })).toBeVisible();
    const quote = await getQuote(vehicle.slug, stay);
    expect(quote.bookable).toBe(true);
    await expect(page.getByText('Available', { exact: true })).toBeVisible();
    await expect(page.getByText(`Rental ${formatLkr(quote.price.subtotal)}`)).toBeVisible();
    // No address, pickup instructions or registration number on the public page.
    await expect(page.getByText('12 Beach Road')).toHaveCount(0);
    await expect(page.getByText(vehicle.registrationNumber)).toHaveCount(0);
    await page.getByRole('button', { name: 'Request to book' }).click();
  });

  await test.step('login mid-flow returns to the booking form', async () => {
    await expect(page).toHaveURL(/\/login\?next=%2Fbookings%2Fnew/);
    await page.getByLabel('Email').fill(customer.email);
    await page.getByLabel('Password').fill(customer.password);
    await page.locator('form').getByRole('button', { name: 'Log in', exact: true }).click();
    await expect(page).toHaveURL(
      new RegExp(`/bookings/new\\?vehicle=${escapeRegExp(vehicle.slug)}`),
    );
    await expect(page.getByRole('heading', { name: 'Request to book' })).toBeVisible();
    await expect(page.getByLabel('Driver’s full name')).toHaveValue(customer.fullName);
  });

  await test.step('send the booking request', async () => {
    await page.getByLabel('Licence valid until').fill('2031-12-31');
    await page
      .getByLabel('Message to the provider (optional)')
      .fill('Arriving by train around noon.');
    await page.getByRole('button', { name: 'Send booking request' }).click();
    await expect(page).toHaveURL(/\/bookings\/[0-9a-f-]{36}$/);
    bookingId = page.url().split('/').pop() as string;
    await expect(statusBadge(page, 'Requested')).toBeVisible();
    await expect(page.getByText(/Waiting for the provider to accept/)).toBeVisible();
    await expect(
      page.getByText('Contact details are shared once the booking is confirmed.'),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /contact details/ })).toHaveCount(0);
  });

  await test.step('provider accepts (API) and the customer sees the payment step', async () => {
    await providerAction(world.provider.accessToken, bookingId, 'accept', {
      providerNote: 'See you at the blue gate.',
    });
    await page.reload();
    await expect(statusBadge(page, 'Accepted')).toBeVisible();
    await expect(page.getByText('Advance not paid', { exact: true })).toBeVisible();
    await expect(page.getByText('See you at the blue gate.')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Pay advance securely/ })).toBeVisible();
  });

  await test.step('pay the advance through the fake gateway', async () => {
    await page.getByRole('button', { name: /^Pay advance securely/ }).click();
    await page.waitForURL(FAKE_CHECKOUT_URL);
    await expect(page.getByRole('heading', { name: /Fake payment gateway/ })).toBeVisible();
    await completeFakePayment(page, 'success', {
      id: bookingId,
      customerToken: customer.accessToken,
    });
    await expect(page.getByRole('heading', { name: 'Payment status' })).toBeVisible();
    await expect(page.getByText('Payment confirmed', { exact: true })).toBeVisible({
      timeout: 45_000,
    });
  });

  await test.step('contact details and the pickup address are revealed', async () => {
    await page.getByRole('button', { name: 'Return to booking' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}$`));
    await expect(statusBadge(page, 'Confirmed')).toBeVisible();
    await expect(page.getByText('Advance paid', { exact: true })).toBeVisible();
    await expect(page.getByText('12 Beach Road, Mirissa 81740')).toBeVisible();
    await page.getByRole('button', { name: 'Show provider contact details' }).click();
    await expect(page.getByText(world.provider.contactName)).toBeVisible();
    await expect(page.getByRole('link', { name: world.provider.phone })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open WhatsApp chat' })).toBeVisible();
  });

  await test.step('after pickup and return (API) the customer leaves a review', async () => {
    await completeRental(world.provider.accessToken, bookingId);
    await page.reload();
    await expect(statusBadge(page, 'Completed')).toBeVisible();
    await expect(page.getByText('Handover records')).toBeVisible();
    await page.getByRole('button', { name: 'Leave a review' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}/review$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Review ${vehicle.title}`);
    const overall = page.getByRole('group', { name: 'Overall rating' });
    await overall.locator('label').nth(4).click();
    await expect(overall.getByRole('radio', { name: '5 stars' })).toBeChecked();
    await page.getByLabel('Comment (optional)').fill(reviewText);
    await page.getByRole('button', { name: 'Publish review' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      `Your review of ${vehicle.title}`,
    );
    await expect(page.getByText(reviewText)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Edit review' })).toBeVisible();
  });

  await test.step('the provider reply (API) shows on the public vehicle page', async () => {
    const review = (await listProviderReviews(world.provider.accessToken)).find(
      (r) => r.booking.id === bookingId,
    );
    expect(review, 'the review is listed for the provider').toBeDefined();
    await replyToReview(world.provider.accessToken, (review as { id: string }).id, replyText);
    await page.goto(`/vehicles/${vehicle.slug}`);
    const reviews = page.getByRole('region', { name: 'Reviews' });
    await expect(reviews.getByText(reviewText)).toBeVisible();
    await expect(reviews.getByText('Nimal P.', { exact: true })).toBeVisible();
    await expect(reviews.getByText(replyText)).toBeVisible();
    await expect(
      reviews.getByText(new RegExp(`Reply from ${escapeRegExp(world.provider.displayName)}`)),
    ).toBeVisible();
    await expect(page.getByText('1 review', { exact: false }).first()).toBeVisible();
  });
});

/**
 * The fake gateway's checkout form posts to the API and is redirected (303) back
 * to the web app; the API's CSP allows the web origin in `form-action`, so the
 * browser follows the redirect to the payment status page.
 */
test('the fake gateway returns the browser to the payment status page', async ({
  page,
  consoleWatch,
}) => {
  const second = await registerVerifiedUser('customer-redirect', 'Nimal Perera');
  const w = rentalWindow(40, 2);
  const booking = await requestBooking(second.accessToken, vehicle.id, w);
  await providerAction(world.provider.accessToken, booking.id, 'accept');
  await loginViaUi(page, second, { next: `/bookings/${booking.id}` });
  await page.getByRole('button', { name: /^Pay advance securely/ }).click();
  await page.waitForURL(FAKE_CHECKOUT_URL);
  await page.getByRole('button', { name: 'Pay successfully' }).click();
  await expect(page).toHaveURL(new RegExp(`/bookings/${booking.id}/payment\\?result=return$`));
  expect(consoleWatch.knownIssues.filter((m) => m.startsWith('fake-gateway-redirect'))).toEqual([]);
});

/**
 * The pickup-area map renders (risk register O12, resolved 2026-10-18): MapLibre's
 * worker is served from `/maplibre/`, so it starts on every load. Any worker error
 * would be an unexpected console error and fail the test through `consoleWatch`.
 * The "Map unavailable" fallback is the next test.
 */
test('the pickup-area map on the public vehicle page renders', async ({ page }, testInfo) => {
  await page.goto(`/vehicles/${vehicle.slug}`);
  await expect(page.getByRole('heading', { level: 1, name: vehicle.title })).toBeVisible();
  // The map mounts only near the viewport (O13); bring the pickup-area card into view first.
  await page.getByText('Pickup area', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.locator('canvas.maplibregl-canvas')).toBeVisible();
  await expect(page.getByText(/Map unavailable/)).toHaveCount(0);
  testInfo.annotations.push({
    type: 'map-outcome',
    description: 'map rendered (MapLibre worker loaded)',
  });
});

test('the pickup-area map degrades to a notice when the tile host is unreachable', async ({
  page,
  consoleWatch,
}) => {
  // Registered after the fixture's stub, so this handler wins: the style request fails.
  await page.route(/^https:\/\/tiles\.openfreemap\.org\//, (route) =>
    route.fulfill({ status: 503, body: 'unavailable' }),
  );
  await page.goto(`/vehicles/${vehicle.slug}`);
  await page.getByText('Pickup area', { exact: true }).scrollIntoViewIfNeeded();
  await expect(page.getByText(/Map unavailable\. Pickup is in/)).toBeVisible();
  await expect(page.locator('canvas.maplibregl-canvas')).toHaveCount(0);
  // The booking panel does not depend on the map.
  await expect(page.getByRole('heading', { level: 1, name: vehicle.title })).toBeVisible();
  // Only the deliberately failed tile-host request may have been logged.
  const unexpected = consoleWatch.errors.filter(
    (e) => !/tiles\.openfreemap\.org|status of 503/.test(e),
  );
  consoleWatch.errors.splice(0, consoleWatch.errors.length, ...unexpected);
});
