/**
 * Registration form validation — @playwright/test spec
 *
 * The SDK enforces a credential contract (citadel_user/src/credentials.rs) and
 * rejects the whole registration with a generic toast. Before this, the form
 * knew none of it, so the only way to learn that passwords cap at 17 was to
 * complete the form, submit, wait for a round-trip and read
 * "Something went wrong: Username must be between 3 and 37 characters".
 *
 * These run entirely client-side — no account is registered — so they are
 * cheap and do not contend for the shared backend.
 */

import { test, expect, type Page } from '@playwright/test';
import { waitForAppReady } from '../lib/index.js';
import { config } from '../lib/config.js';

/** Walk the join wizard as far as the profile form. */
async function openProfileForm(page: Page): Promise<void> {
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);

  const joinBtn = page.getByTestId('create-account-button');
  await joinBtn.waitFor({ state: 'visible', timeout: 30_000 });
  await joinBtn.click({ force: true });

  const serverInput = page.getByRole('textbox', { name: 'Workspace Address' });
  await serverInput.waitFor({ state: 'visible', timeout: 30_000 });
  await serverInput.fill(config.WORKSPACE_SERVER);
  await page.getByRole('button', { name: 'NEXT' }).click();

  // Security settings step — defaults are fine.
  await page.getByRole('button', { name: 'NEXT' }).click();

  await page.locator('#username').waitFor({ state: 'visible', timeout: 30_000 });
}

test.describe('registration validates before submitting', () => {
  test.beforeEach(async ({ page }) => {
    await openProfileForm(page);
  });

  test('a password longer than the SDK allows is reported, not truncated', async ({ page }) => {
    // Typical password-manager output. The SDK maximum is 17.
    const managerPassword = 'Xk4$mQ2!vB9#nR7&pL7x';
    expect(managerPassword.length).toBeGreaterThan(17);

    const field = page.locator('#password');
    await field.fill(managerPassword);
    await field.blur();

    // The value must survive intact. A maxLength attribute here would silently
    // clip it to 17, registering a secret the user never saw and cannot
    // reproduce from their vault — worse than refusing it outright.
    await expect(field).toHaveValue(managerPassword);

    const error = page.locator('#password-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/17 characters or fewer/);
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(field).toHaveAttribute('aria-describedby', 'password-error');
  });

  test('a too-short username is reported on blur', async ({ page }) => {
    const field = page.locator('#username');
    await field.fill('ab');
    await field.blur();

    const error = page.locator('#username-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/at least 3/);
  });

  test('nothing is reported while the field is still being typed', async ({ page }) => {
    // Errors appear on blur or submit. Telling someone their 1-character
    // username is too short mid-keystroke is noise, not help.
    const field = page.locator('#username');
    await field.fill('a');
    await expect(page.locator('#username-error')).toHaveCount(0);
  });

  test('a username past the maximum cannot be entered', async ({ page }) => {
    const field = page.locator('#username');
    await field.fill('a'.repeat(60));
    // Visible text, so capping is self-evident to the user rather than hidden.
    await expect(field).toHaveValue('a'.repeat(37));
  });

  test('submitting an invalid form does not leave the form', async ({ page }) => {
    await page.locator('#fullName').fill('Test User');
    await page.locator('#username').fill('ab'); // too short
    await page.locator('#password').fill('validpass1');
    await page.locator('#confirmPassword').fill('validpass1');

    // The form's own submit. A name-based lookup also matches the Landing
    // page's "Create Account" button, which is still in the DOM behind the
    // modal overlay and therefore never clickable.
    await page.locator('form button[type="submit"]').click();

    // Still on the profile form: the registration was never attempted.
    await expect(page.locator('#username')).toBeVisible();
    await expect(page.locator('#username-error')).toBeVisible();
  });

  test('mismatched passwords are reported inline, not only as a toast', async ({ page }) => {
    await page.locator('#password').fill('validpass1');
    const confirm = page.locator('#confirmPassword');
    await confirm.fill('validpass2');
    await confirm.blur();

    const error = page.locator('#confirmPassword-error');
    await expect(error).toBeVisible();
    await expect(error).toHaveText(/do not match/);
  });

  // Inline errors are the one place the destructive colour is read as PROSE.
  // `--destructive` is a SURFACE token (white sits on it at 4.53:1) and as text
  // on the dark background it was only 3.72:1 — under the 4.5:1 floor for body
  // text. axe never caught it because error states are not rendered during the
  // page scans. Measured here on a real rendered error.
  test('the inline error text meets AA contrast where it is actually rendered', async ({ page }) => {
    const field = page.locator('#password');
    await field.fill('short');
    await field.blur();
    const error = page.locator('#password-error');
    await expect(error).toBeVisible();

    const ratio = await error.evaluate((el) => {
      const parse = (c: string) => (c.match(/[\d.]+/g) || []).map(Number);
      const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
      const lum = ([r, g, b]: number[]) =>
        0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);

      // Walk up for the first ancestor that actually paints a background;
      // the error <p> itself is transparent.
      let bg: number[] | null = null;
      for (let n: HTMLElement | null = el as HTMLElement; n; n = n.parentElement) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c.length >= 3 && (c.length < 4 || c[3] > 0)) { bg = c; break; }
      }
      const fg = parse(getComputedStyle(el as HTMLElement).color);
      if (!bg) return null;
      const a = lum(fg), b = lum(bg);
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });

    expect(ratio, 'could not resolve a painted background').not.toBeNull();
    expect(
      ratio as number,
      `inline error text is ${(ratio as number).toFixed(2)}:1 against its background; ` +
        'WCAG AA requires 4.5:1 for body text',
    ).toBeGreaterThanOrEqual(4.5);
  });

  // Password managers key off autocomplete. Without it they fall back to
  // heuristics that routinely read a registration form as a login, so the
  // credential is never offered back on the next visit — and the users most
  // affected are the ones using a manager, which is the same group the SDK's
  // 17-character password ceiling already inconveniences. WCAG 1.3.5 asks for
  // the same attributes.
  test('the profile form tells a password manager what each field is', async ({ page }) => {
    const expected: ReadonlyArray<readonly [string, string]> = [
      ['#fullName', 'name'],
      ['#username', 'username'],
      // new-password, NOT current-password: this form CREATES a credential, and
      // the wrong value here makes a manager offer to fill an existing one.
      ['#password', 'new-password'],
      ['#confirmPassword', 'new-password'],
    ];
    for (const [selector, value] of expected) {
      await expect(page.locator(selector), `${selector} should declare its purpose`).toHaveAttribute(
        'autocomplete',
        value,
      );
    }
  });
});
