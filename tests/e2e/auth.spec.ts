import { expect, test } from '@playwright/test';
import { ACCOUNTS, PASSWORD, signIn, signOut } from './helpers';

/**
 * Signing in, and the boundaries around it.
 *
 * The unit tests cover the rules; these cover that a real browser experiences
 * them — that a redirect actually happens, that the cookie actually sticks,
 * and that each role actually lands where it is supposed to.
 */

test.describe('signing in', () => {
  test('an anonymous visitor is sent to the login page', async ({ page }) => {
    await page.goto('/forms');
    await expect(page).toHaveURL(/\/login/);
  });

  test('the intended destination survives the detour', async ({ page }) => {
    await page.goto('/notifications');
    await expect(page).toHaveURL(/next=%2Fnotifications/);
  });

  test('a wrong password is refused without saying which part was wrong', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/email/i).fill(ACCOUNTS.exec);
    await page.getByLabel(/password/i).fill('definitely-not-the-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test('an unknown address gets the same message as a wrong password', async ({ page }) => {
    // Distinguishing the two would let anyone enumerate staff addresses.
    await page.goto('/login');
    await page.getByLabel(/email/i).fill('nobody@dac.test');
    await page.getByLabel(/password/i).fill(PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  });

  test('a sales executive lands on their forms', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await expect(page).toHaveURL(/\/forms/);
  });

  test('a signatory lands on their queue', async ({ page }) => {
    await signIn(page, ACCOUNTS.agm);
    await expect(page).toHaveURL(/\/signatory\/queue/);
  });

  test('the co-ordinator lands on theirs', async ({ page }) => {
    await signIn(page, ACCOUNTS.coordinator);
    await expect(page).toHaveURL(/\/coordinator\/queue/);
  });

  test('an admin lands on the admin area', async ({ page }) => {
    await signIn(page, ACCOUNTS.admin);
    await expect(page).toHaveURL(/\/admin\//);
  });

  test('signing out ends the session', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await signOut(page);

    // Going back must not resurrect it.
    await page.goto('/forms');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('the session cookie', () => {
  test('is httpOnly and same-site, so script cannot read it', async ({ page, context }) => {
    await signIn(page, ACCOUNTS.exec);

    const cookie = (await context.cookies()).find((c) => c.name === 'dac_session');
    expect(cookie, 'the session cookie should be set').toBeDefined();
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe('Lax');

    // Belt and braces: the page itself must not be able to see it.
    const visible = await page.evaluate(() => document.cookie);
    expect(visible).not.toContain('dac_session');
  });
});

test.describe('role boundaries', () => {
  test('a signatory cannot reach the admin area, and is told 404 not 403', async ({ page }) => {
    // 403 would confirm the area exists. The RBAC layer deliberately 404s.
    await signIn(page, ACCOUNTS.agm);

    const response = await page.goto('/admin/users');
    expect(response?.status()).toBe(404);
  });

  test('a sales executive cannot reach the audit trail', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    const response = await page.goto('/admin/audit');
    expect(response?.status()).toBe(404);
  });

  test('a signatory cannot open a booking that is not theirs', async ({ page }) => {
    await signIn(page, ACCOUNTS.mis);
    const response = await page.goto('/forms/00000000-0000-0000-0000-000000000000');
    expect(response?.status()).toBe(404);
  });
});

test.describe('security headers', () => {
  test('are present on a real page load', async ({ page }) => {
    const response = await page.goto('/login');
    const headers = response?.headers() ?? {};

    expect(headers['x-frame-options']).toBe('DENY');
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(headers['content-security-policy']).toContain("object-src 'none'");
    expect(headers['content-security-policy']).toContain("form-action 'self'");
  });
});
