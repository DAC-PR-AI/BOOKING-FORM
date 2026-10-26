import { execSync } from 'node:child_process';
import type { Page } from '@playwright/test';

/**
 * Shared helpers for the end-to-end specs.
 *
 * Signing in goes through the real login form rather than injecting a cookie:
 * the login path is itself one of the things worth testing, and a helper that
 * bypasses it would quietly stop covering the redirect, the role-based landing
 * page and the session cookie's attributes.
 */

export const PASSWORD = process.env.SEED_PASSWORD ?? 'DacDev!2026';

export const ACCOUNTS = {
  admin: 'admin@dac.test',
  exec: 'exec@dac.test',
  agm: 'agm@dac.test',
  gm: 'gm@dac.test',
  vpSales: 'vpsales@dac.test',
  coordinator: 'coordinator@dac.test',
  mis: 'mis@dac.test',
  director: 'director@dac.test',
  crm: 'crm@dac.test',
} as const;

/**
 * Creates a booking through the fixture script rather than the browser.
 *
 * Filling sixty fields with Playwright to reach the interesting part would be
 * slow and brittle, and the form itself is already covered by `booking.spec`
 * and by the unit tests. What these specs are for is the part that only works
 * in a browser — the signature pad — so the booking that leads up to it is set
 * up the fast way.
 */
export function createSubmittedBooking(options: { joint?: boolean } = {}): string {
  // A fixed command string, not an args array with `shell: true`. Node warns
  // about the latter because a shell concatenates arguments rather than
  // escaping them; here every part is a literal and nothing from a test ever
  // reaches it, so there is no injection surface to begin with. A string also
  // avoids Windows refusing to exec `npx.cmd` without a shell.
  const command =
    'npx tsx --tsconfig scripts/tsconfig.json scripts/dev-fixture.ts --submit' +
    (options.joint === false ? '' : ' --joint');

  const output = execSync(command, { encoding: 'utf8' });

  const id = /^ {2}id {9}(\S+)/m.exec(output)?.[1];
  if (!id) throw new Error(`The fixture script printed no booking id:
${output}`);
  return id;
}

export async function signIn(page: Page, email: string): Promise<void> {
  // Drop any existing session first. A signed-in visitor to /login is
  // redirected straight to their dashboard, so without this, switching user
  // mid-spec just times out waiting for a form that is not there — which is
  // most of what these specs do, since a booking passes through nine people.
  await page.context().clearCookies();

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(PASSWORD);
  await page.getByRole('button', { name: /sign in|log in/i }).click();

  // Each role lands somewhere different; waiting for "not /login" is what they
  // have in common.
  await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20_000 });
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: /sign out/i }).click();
  await page.waitForURL(/\/login/);
}

/**
 * Draws on the signature pad.
 *
 * Uses mouse events over the canvas rather than dispatching synthetic pointer
 * events, so the pad's own pointer handling — capture, move, release — is what
 * is being exercised. A stroke of several segments, because a single click
 * produces a dot that the server's blank-pad heuristic may well reject.
 */
export async function drawSignature(page: Page): Promise<void> {
  const canvas = page.getByRole('img', { name: /signature box/i });
  await canvas.waitFor({ state: 'visible' });

  // Scroll it into view first. `boundingBox()` is viewport-relative, and the
  // pad sits far enough down the signing page that its coordinates can fall
  // below the fold — the mouse then lands on nothing and not a single event
  // reaches the canvas, which looks exactly like a broken pad.
  await canvas.scrollIntoViewIfNeeded();

  const box = await canvas.boundingBox();
  if (!box) throw new Error('The signature pad has no box to draw in.');

  const midY = box.y + box.height / 2;
  await page.mouse.move(box.x + box.width * 0.15, midY);
  await page.mouse.down();

  for (let i = 1; i <= 12; i += 1) {
    const x = box.x + box.width * (0.15 + (0.7 * i) / 12);
    const y = midY + Math.sin(i) * (box.height * 0.22);
    await page.mouse.move(x, y, { steps: 3 });
  }

  await page.mouse.up();
}
