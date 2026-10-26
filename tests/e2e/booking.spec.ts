import { expect, test } from '@playwright/test';
import { ACCOUNTS, signIn } from './helpers';

/**
 * Creating and filling a booking form, in a real browser.
 *
 * Covers the things the unit tests and verification scripts structurally
 * cannot: that autosave actually fires on typing, that the boxed character
 * inputs behave like the printed boxes, that the file picker really uploads,
 * and that the submit gate's outstanding list is what a person sees.
 *
 * It does not re-check the validation rules — 516 unit tests do that far
 * faster. This is about the browser.
 */

test.describe('a new booking form', () => {
  test('autosaves as it is typed', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);

    await page.getByRole('link', { name: /new booking form/i }).click();
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    const formUrl = page.url();

    // The header says changes save automatically before anything is typed.
    await expect(page.getByText(/changes save automatically/i)).toBeVisible();

    await page.getByLabel('Sales Head', { exact: true }).fill('ARUN MURUGAN');
    await page.getByLabel('Lead ID', { exact: true }).fill('LEAD-E2E-01');

    // Autosave is debounced at 1.2s; the header is how a user knows.
    await expect(page.getByText(/all changes saved at/i)).toBeVisible({ timeout: 15_000 });

    // The real check: it survives a reload, which is what a user relies on.
    await page.goto(formUrl);
    await expect(page.getByLabel('Sales Head', { exact: true })).toHaveValue('ARUN MURUGAN');
    await expect(page.getByLabel('Lead ID', { exact: true })).toHaveValue('LEAD-E2E-01');
  });

  test('the boxed inputs behave like the printed boxes', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    // Ten boxes for a mobile number, as counted off the paper form.
    const mobileBoxes = page
      .getByRole('group', { name: 'Mobile number' })
      .first()
      .getByRole('textbox');
    await expect(mobileBoxes).toHaveCount(10);

    // Typing advances from box to box without the user tabbing.
    await mobileBoxes.first().click();
    await page.keyboard.type('9876543210');

    for (const [index, digit] of [...'9876543210'].entries()) {
      await expect(mobileBoxes.nth(index)).toHaveValue(digit);
    }

    // Backspace steps back, as it does on paper when you cross one out.
    await page.keyboard.press('Backspace');
    await expect(mobileBoxes.nth(9)).toHaveValue('');
  });

  test('pasting a whole number fills the boxes', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    const aadhaarBoxes = page
      .getByRole('group', { name: 'Adhaar number' })
      .first()
      .getByRole('textbox');
    await expect(aadhaarBoxes).toHaveCount(12);

    // A real ClipboardEvent constructed in the page, rather than the clipboard
    // API: headless Chromium grants no clipboard permission, and this is what
    // the component's own onPaste handler actually receives.
    await aadhaarBoxes.first().click();
    await aadhaarBoxes.first().evaluate((input) => {
      const transfer = new DataTransfer();
      // Spaced, as people copy it off the card.
      transfer.setData('text/plain', '2345 6789 0124');
      input.dispatchEvent(
        new ClipboardEvent('paste', {
          clipboardData: transfer,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    await expect(aadhaarBoxes.nth(0)).toHaveValue('2');
    await expect(aadhaarBoxes.nth(11)).toHaveValue('4');
  });
});

test.describe('the submit gate', () => {
  test('lists everything outstanding, grouped as the paper form reads', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    await page.getByRole('link', { name: /review and submit/i }).click();
    await page.waitForURL(/\/review/);

    await expect(page.getByText(/things are still outstanding/i)).toBeVisible();

    // Grouped by block of the paper form, not one error at a time.
    await expect(page.getByRole('heading', { name: /booking details/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /supporting documents/i })).toBeVisible();

    // And the way out of each.
    await expect(page.getByRole('link', { name: /go to documents/i })).toBeVisible();

    // Submitting is not offered while anything is missing.
    const submit = page.getByRole('button', { name: /submit and start/i });
    await expect(submit).toBeDisabled();
    await expect(page.getByText(/finish the outstanding items above first/i)).toBeVisible();
  });

  test('shows the terms, and marks the unapproved version as such', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    await page.getByRole('link', { name: /review and submit/i }).click();
    await page.waitForURL(/\/review/);

    await expect(
      page.getByRole('heading', { name: /terms & conditions for provisional allotment/i }).first(),
    ).toBeVisible();

    // v1 is transcribed from a photograph and not signed off. That must be
    // visible, not buried.
    await expect(page.getByText(/has not been approved by dac/i)).toBeVisible();
  });
});

test.describe('supporting documents', () => {
  test('uploads a file through the picker and shows it attached', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);

    await page.getByRole('link', { name: /supporting documents/i }).click();
    await page.waitForURL(/\/documents/);

    await expect(page.getByText(/0 of \d+ required documents attached/i)).toBeVisible();

    // A 1×1 PNG is enough: the server checks the magic number, not the picture.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );

    const row = page.getByRole('listitem').filter({ hasText: /simple cost sheet/i });
    await row.locator('input[type="file"]').setInputFiles({
      name: 'cost-sheet.png',
      mimeType: 'image/png',
      buffer: png,
    });

    await expect(row.getByRole('link', { name: /cost-sheet\.png/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/1 of \d+ required documents attached/i)).toBeVisible();

    // And it can be taken off again.
    await row.getByRole('button', { name: /remove/i }).click();
    await expect(page.getByText(/0 of \d+ required documents attached/i)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('refuses a file type the slot does not accept', async ({ page }) => {
    await signIn(page, ACCOUNTS.exec);
    await page.goto('/forms/new');
    await page.getByRole('button', { name: /create draft/i }).click();
    await page.waitForURL(/\/forms\/[^/]+\/edit/);
    await page.getByRole('link', { name: /supporting documents/i }).click();
    await page.waitForURL(/\/documents/);

    // The passport photo slot takes images only, never a PDF.
    const photoRow = page.getByRole('listitem').filter({ hasText: /passport-size photo/i }).first();
    await photoRow.locator('input[type="file"]').setInputFiles({
      name: 'not-a-photo.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n% not really\n'),
    });

    await expect(photoRow.getByRole('alert')).toBeVisible({ timeout: 20_000 });
  });
});
