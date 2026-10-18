import { isMfaRequired, loginApi, registerVerifiedUser } from '../fixtures/accounts';
import { call } from '../fixtures/api';
import { expect, loginViaUi, test } from '../fixtures/test';

/**
 * Signed-in password change from `/account/security` (Phase 10, ASVS V6.2.3): a
 * wrong current password is refused in place; a successful change signs the
 * browser out, lands on the login page with a neutral notice and leaves no
 * password in the URL or browser storage. The old password stops working.
 */
test('a customer changes their password and is signed out everywhere', async ({ page }) => {
  const customer = await registerVerifiedUser('pwchange', 'Kamala Silva');
  const newPassword = 'E2E-new-passphrase-2026!';
  // A second, independent session (mobile-style) that the change must also end.
  const other = await loginApi(customer.email);
  if (isMfaRequired(other)) throw new Error('customer unexpectedly needs MFA');

  await loginViaUi(page, customer);
  await page.goto('/account/security');
  await expect(
    page.getByRole('navigation', { name: 'Account sections' }).locator('[aria-current="page"]'),
  ).toHaveText('Security');
  const current = page.getByLabel('Current password');
  const next = page.getByLabel('New password', { exact: true });
  const confirm = page.getByLabel('Confirm new password');
  await expect(current).toHaveAttribute('autocomplete', 'current-password');
  await expect(next).toHaveAttribute('autocomplete', 'new-password');
  await expect(confirm).toHaveAttribute('autocomplete', 'new-password');

  // Mismatched confirmation never reaches the server.
  await current.fill(customer.password);
  await next.fill(newPassword);
  await confirm.fill(`${newPassword}x`);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Passwords do not match')).toBeVisible();

  // Wrong current password: refused in place, still signed in.
  await current.fill('not-my-password-at-all');
  await confirm.fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByText('Your current password was not recognised.')).toBeVisible();
  await expect(page).toHaveURL(/\/account\/security/);

  await current.fill(customer.password);
  await next.fill(newPassword);
  await confirm.fill(newPassword);
  await page.getByRole('button', { name: 'Change password' }).click();

  await expect(page).toHaveURL(/\/login\?passwordChanged=1$/);
  await expect(page.getByText('Your password was changed. Please sign in again.')).toBeVisible();
  await expect(
    page.getByRole('navigation', { name: 'Account' }).getByRole('button', { name: 'Log out' }),
  ).toHaveCount(0);
  expect(page.url()).not.toContain(newPassword);
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(stored).not.toContain(newPassword);
  expect(stored).not.toContain(customer.password);

  // The independent session is gone too; the old password no longer works.
  const stale = await call('GET', '/users/me', { token: other.accessToken, expect: 401 });
  expect(stale.status).toBe(401);
  const oldLogin = await call('POST', '/auth/login', {
    body: { email: customer.email, password: customer.password, client: 'mobile' },
    expect: 401,
  });
  expect(oldLogin.status).toBe(401);

  await loginViaUi(page, { email: customer.email, password: newPassword });
});
