import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests.
 *
 * These drive a real browser against a real server and a real database, which
 * is the point: everything below this level is already covered by 516 unit
 * tests and five verification scripts. What those cannot reach is the browser
 * — that the autosave actually fires, that a form a signatory may not see
 * really 404s in a session, that the signature pad produces a usable PNG from
 * pointer events.
 *
 * They run against `next dev` rather than a production build so a failure
 * points at a source line. The trade is a slower first page; `webServer`
 * reuses an already-running dev server locally and starts its own in CI.
 */
export default defineConfig({
  testDir: './tests/e2e',
  // One worker: these share one database and one set of seeded accounts, so
  // parallel runs would fight over the same bookings.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    // The signature pad is built for a tablet handed across a desk, so the
    // tests drive it the same way the applicant will.
    hasTouch: true,
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], hasTouch: true } }],

  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000/login',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
