import { RUN_ID, registerVerifiedUser } from '../fixtures/accounts';
import {
  createReview,
  payAdvanceViaFakeGateway,
  requestBooking,
  rentalWindow,
} from '../fixtures/bookings';
import { createApprovedVehicle, uniqueDailyRate, type ApprovedVehicle } from '../fixtures/provider';
import { escapeRegExp, expect, loginViaUi, statusBadge, test } from '../fixtures/test';
import { loadWorld, type Account, type World } from '../fixtures/world';

/**
 * The provider's side in the browser: inbox → accept → contact after the
 * advance is paid → handover records → review reply → listing and documents
 * pages. The customer's steps run through the API.
 */
test.describe.configure({ mode: 'serial' });

let world: World;
let vehicle: ApprovedVehicle;
let customer: Account;
let booking: { id: string; reference: string };
const stay = rentalWindow(10, 2);
const reviewText = `Friendly provider, car as described (${RUN_ID}).`;
const replyText = `Thanks for the kind words (${RUN_ID}).`;

test.beforeAll(async () => {
  world = loadWorld();
  vehicle = await createApprovedVehicle(world.provider, world.admin.accessToken, {
    title: `E2E Aqua provider ${RUN_ID}`,
    dailyRate: uniqueDailyRate(),
  });
  customer = await registerVerifiedUser('customer', 'Kamala Silva');
  booking = await requestBooking(customer.accessToken, vehicle.id, stay);
});

test('sees the request in the inbox and accepts it', async ({ page }) => {
  await loginViaUi(page, world.provider, { next: '/provider/bookings' });
  await expect(page.getByRole('heading', { level: 1, name: 'Bookings' })).toBeVisible();
  const row = page.getByRole('link', { name: new RegExp(escapeRegExp(booking.reference)) });
  await expect(row).toContainText(vehicle.title);
  // Only the customer's first name is shown before the contact reveal.
  await expect(row).toContainText('Kamala');
  await expect(row).not.toContainText('Kamala Silva');
  await expect(row).toContainText('Requested');
  await row.click();
  await expect(page).toHaveURL(new RegExp(`/provider/bookings/${booking.id}$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText(booking.reference);
  await expect(page.getByText(/requested by Kamala/)).toBeVisible();
  await page.getByRole('button', { name: 'Accept request' }).click();
  await page
    .getByLabel('Accept request: optional note')
    .fill('Blue gate opposite the fish market.');
  await page.getByRole('button', { name: 'Accept and reserve' }).click();
  await expect(statusBadge(page, 'Accepted')).toBeVisible();
  await expect(page.getByText('Awaiting the customer’s advance.')).toBeVisible();
  await expect(page.getByText('Accepted by the provider')).toBeVisible();
});

test('sees the customer contact once the advance is paid', async ({ page }) => {
  const paid = await payAdvanceViaFakeGateway(customer.accessToken, booking.id, 'success');
  expect(paid.status).toBe('confirmed');
  await loginViaUi(page, world.provider, { next: `/provider/bookings/${booking.id}` });
  await expect(statusBadge(page, 'Confirmed')).toBeVisible();
  await expect(page.getByText('Advance paid', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show customer contact details' }).click();
  await expect(page.getByRole('link', { name: customer.email })).toBeVisible();
});

test('records the pickup and the return', async ({ page }) => {
  await loginViaUi(page, world.provider, { next: `/provider/bookings/${booking.id}` });
  await page.getByRole('button', { name: 'Record pickup' }).click();
  await page.getByLabel('Odometer (km, optional)').fill('1000');
  await page.getByLabel('Fuel level (optional)').selectOption('6');
  await page
    .getByLabel('Note (optional, shared with the customer)')
    .fill('Full tank, no scratches.');
  await page.getByRole('button', { name: 'Confirm pickup' }).click();
  await expect(statusBadge(page, 'In progress')).toBeVisible();
  await expect(page.getByText('Handover records')).toBeVisible();
  await expect(page.getByText(/1000 km · fuel 3\/4 · Full tank, no scratches\./)).toBeVisible();

  await page.getByRole('button', { name: 'Record return' }).click();
  await page.getByLabel('Odometer (km, optional)').fill('1300');
  await page.getByLabel('Fuel level (optional)').selectOption('5');
  await page.getByRole('button', { name: 'Confirm return' }).click();
  await expect(statusBadge(page, 'Completed')).toBeVisible();
  await expect(page.getByText(/1300 km · fuel 5\/8/)).toBeVisible();
});

test('replies to the customer review', async ({ page }) => {
  await createReview(customer.accessToken, booking.id, { overallRating: 4, comment: reviewText });
  await loginViaUi(page, world.provider, { next: '/provider/reviews' });
  await expect(page.getByRole('heading', { level: 1, name: 'Reviews' })).toBeVisible();
  const item = page.getByRole('listitem').filter({ hasText: reviewText });
  await expect(item).toContainText(booking.reference);
  await expect(item).toContainText('Kamala S.');
  await item.getByRole('button', { name: 'Reply' }).click();
  await item.getByLabel('Reply: reason (required)').fill(replyText);
  await item.getByRole('button', { name: 'Publish reply' }).click();
  await expect(item.getByText('Your reply')).toBeVisible();
  await expect(item.getByText(replyText)).toBeVisible();
  await expect(item.getByRole('button', { name: 'Reply' })).toHaveCount(0);
});

test('opens the listing page and the documents page', async ({ page }) => {
  await loginViaUi(page, world.provider, { next: `/provider/vehicles/${vehicle.id}` });
  await expect(page.getByRole('heading', { level: 1, name: vehicle.title })).toBeVisible();
  await expect(statusBadge(page, 'Approved')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage availability' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Take offline' })).toBeVisible();

  await page.goto('/provider/documents');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Verification documents' }),
  ).toBeVisible();
  await expect(page.getByText('Your provider documents')).toBeVisible();
  await expect(page.getByText(vehicle.title, { exact: true })).toBeVisible();
});
