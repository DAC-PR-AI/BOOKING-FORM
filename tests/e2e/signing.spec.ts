import { expect, test } from '@playwright/test';
import { ACCOUNTS, createSubmittedBooking, drawSignature, signIn } from './helpers';

/**
 * The signature pad, and the flow moving.
 *
 * This is the one part of the system that genuinely cannot be tested below the
 * browser: a canvas, pointer events, and a PNG produced from them. The flow
 * rules themselves are covered by unit tests and `verify-sign.ts`; what these
 * check is that a person can actually sign, and that signing moves the booking
 * to the next person.
 */

test.describe('capturing an applicant signature', () => {
  test('the creator signs on behalf of the applicant, in person', async ({ page }) => {
    const formId = createSubmittedBooking({ joint: true });

    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}`);

    // Step 1 is the applicant capture, assigned to the creator.
    await expect(page.getByText(/waiting on 1st applicant/i)).toBeVisible();

    await page.getByRole('link', { name: /capture .*signature/i }).first().click();
    await page.waitForURL(/\/sign\/1/);

    // The screen says this one happens in person, on this device.
    await expect(page.getByText(/hand the device to the applicant/i)).toBeVisible();

    // Nothing can be signed until there is a stroke and the confirmation.
    const submit = page.getByRole('button', { name: /sign and send on/i });
    await expect(submit).toBeDisabled();

    await drawSignature(page);
    await expect(submit).toBeDisabled(); // still needs the witness confirmation

    await page.getByRole('checkbox').check();
    await expect(submit).toBeEnabled();

    await submit.click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    // The flow has moved on to the second applicant.
    await expect(page.getByText(/waiting on 2nd applicant/i)).toBeVisible();
  });

  test('the drawn signature is stored and shown back', async ({ page }) => {
    const formId = createSubmittedBooking({ joint: false });

    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}/sign/1`);

    await drawSignature(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /sign and send on/i }).click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    // The signature image renders on the timeline, served through the
    // authorising route rather than a public URL.
    const signature = page.getByRole('img', { name: /signature for 1st applicant/i });
    await expect(signature).toBeVisible();
    await expect(signature).toHaveAttribute('src', /\/api\/signatures\//);

    // And it is a real image the browser could decode, not a broken one.
    // Polled, because the src is a redirect to a short-lived signed URL and
    // the element is visible well before the bytes arrive.
    await expect
      .poll(() => signature.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });
});

test.describe('a staff signature', () => {
  test('appears in the role’s queue, and signing passes it on', async ({ page }) => {
    const formId = createSubmittedBooking({ joint: false });

    // Get it past the applicant step first.
    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}/sign/1`);
    await drawSignature(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /sign and send on/i }).click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    // The Booking ID, which is unique — the applicant name is not, and a
    // development database accumulates fixtures from earlier runs.
    const bookingId = (await page.getByRole('heading', { level: 1 }).first().textContent())?.trim();
    expect(bookingId).toMatch(/^DAC\/\d{4}\/\d{5}$/);

    // The AGM now sees it, and did not before.
    await signIn(page, ACCOUNTS.agm);
    await expect(page).toHaveURL(/\/signatory\/queue/);

    const queued = page.getByRole('listitem').filter({ hasText: bookingId as string });
    await expect(queued).toHaveCount(1);

    await queued.getByRole('link', { name: /review and sign/i }).click();
    await page.waitForURL(/\/sign\/3/);

    // Everything needed to decide is on the page.
    await expect(page.getByText(/what you are approving/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /documents \(/i })).toBeVisible();
    await expect(page.getByText(/signed so far/i)).toBeVisible();

    await drawSignature(page);
    await page.getByRole('button', { name: /sign and send on/i }).click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    await expect(page.getByText(/waiting on dgm \/ gm/i)).toBeVisible();

    // It has left the AGM's queue.
    await page.goto('/signatory/queue');
    await expect(
      page.getByRole('listitem').filter({ hasText: bookingId as string }),
    ).toHaveCount(0);
  });

  test('the co-ordinator cannot sign without ticking validated', async ({ page }) => {
    const formId = createSubmittedBooking({ joint: false });

    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}/sign/1`);
    await drawSignature(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /sign and send on/i }).click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    for (const [step, account] of [
      [3, ACCOUNTS.agm],
      [4, ACCOUNTS.gm],
      [5, ACCOUNTS.vpSales],
    ] as const) {
      await signIn(page, account);
      await page.goto(`/forms/${formId}/sign/${step}`);
      await drawSignature(page);
      await page.getByRole('button', { name: /sign and send on/i }).click();
      await page.waitForURL(new RegExp(`/forms/${formId}$`));
    }

    await signIn(page, ACCOUNTS.coordinator);
    await page.goto(`/forms/${formId}/sign/6`);

    await drawSignature(page);

    // The one step that asserts the form was checked, not merely approved.
    const submit = page.getByRole('button', { name: /sign and send on/i });
    await expect(submit).toBeDisabled();

    await page.getByRole('checkbox', { name: /validated/i }).check();
    await expect(submit).toBeEnabled();
  });
});

test.describe('sending a booking back', () => {
  test('needs a reason, and the creator sees it', async ({ page }) => {
    const formId = createSubmittedBooking({ joint: false });

    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}/sign/1`);
    await drawSignature(page);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: /sign and send on/i }).click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    await signIn(page, ACCOUNTS.agm);
    await page.goto(`/forms/${formId}/sign/3`);

    await page.getByRole('button', { name: /send back for changes/i }).click();

    const send = page.getByRole('button', { name: /^send back$/i });
    await expect(send).toBeDisabled();

    await page.getByRole('textbox', { name: /send back|note|comment/i }).or(
      page.locator('textarea'),
    ).first().fill('The bank name does not match the cheque.');
    await expect(send).toBeEnabled();

    await send.click();
    await page.waitForURL(new RegExp(`/forms/${formId}$`));

    // The creator sees the reason, and can edit again.
    await signIn(page, ACCOUNTS.exec);
    await page.goto(`/forms/${formId}`);

    await expect(page.getByText(/returned for changes/i).first()).toBeVisible();
    await expect(page.getByText(/the bank name does not match the cheque/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /edit the form/i })).toBeVisible();
  });
});
