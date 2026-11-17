/**
 * Keyboard operability — @playwright/test spec
 *
 * axe checks that controls are *labelled*; this checks that they can actually be
 * *reached and used* without a mouse. The two miss different things: a button
 * with a perfect accessible name is still useless if Tab never lands on it, and
 * a dialog that cannot be closed from the keyboard traps whoever opens it.
 *
 * Scoped to the first-run path, because that is where being locked out costs the
 * most — someone who cannot complete registration never reaches the rest.
 */

import { test, expect, type BrowserContext, type Locator, type Page } from '@playwright/test';
import {
  clearBrowserStorage,
  closeAnyModals,
  createAccount,
  waitForAppReady,
  waitForWorkspaceLoaded,
  revealPeekToggle,
  rootRow,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { pressAccountMenuItem } from '../lib/account-menu.js';

/**
 * Bound on the tab walk.
 *
 * Generous because the landing page grows: every orphaned session from an
 * earlier run adds a switch button and a close button to the tab order, so a
 * tight bound turns "someone left sessions on the server" into a failure that
 * reads like a missing control.
 */
const MAX_TAB_STOPS = 80;

async function freshPage(page: Page): Promise<void> {
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await clearBrowserStorage(page);
  await page.reload({ waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
}

/**
 * Wait for running animations to finish.
 *
 * Radix ignores Escape while a dialog is still animating in, so a test that
 * presses it the instant `toBeVisible` resolves gets no response and reports the
 * dialog as un-closable. Waiting for the transition to end is what a person
 * does without thinking about it.
 */
async function settleAnimations(page: Page): Promise<void> {
  await page
    .waitForFunction(
      () => document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle'),
      undefined,
      { timeout: 10_000 }
    )
    .catch(() => {
      // Indefinite animations (spinners) never finish; proceeding is better than
      // failing an operability check over one.
    });
}

/** A description of whatever currently has focus. */
async function focused(page: Page): Promise<{ tag: string; name: string; visible: boolean }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { tag: 'body', name: '', visible: false };
    const rect = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(),
      name: (el.getAttribute('aria-label') || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60),
      visible: rect.width > 0 && rect.height > 0,
    };
  });
}

/**
 * Tab forward, collecting what receives focus, until `stop` is satisfied.
 *
 * Returns everything seen, so a failure can say what the tab order actually was
 * rather than only that the target was missed.
 */
async function tabUntil(
  page: Page,
  stop: (name: string) => boolean
): Promise<{ found: boolean; seen: string[] }> {
  const seen: string[] = [];
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const el = await focused(page);
    if (el.tag === 'body') continue;
    seen.push(`${el.tag}:${el.name}`);
    if (stop(el.name)) return { found: true, seen };
  }
  return { found: false, seen };
}

test.describe('Keyboard operability', () => {
  test.beforeEach(async ({ page }) => {
    await freshPage(page);
  });

  test('every landing action is reachable by Tab', async ({ page }) => {
    // All three entry points, in one walk. If any is unreachable there is no
    // keyboard-only way into the product at all.
    const wanted = ['Create Account', 'Sign In', 'Manage Accounts'];
    const seen: string[] = [];

    for (let i = 0; i < MAX_TAB_STOPS; i++) {
      await page.keyboard.press('Tab');
      const el = await focused(page);
      if (el.tag !== 'body') seen.push(el.name);
    }

    const missing = wanted.filter((w) => !seen.some((s) => s.includes(w)));
    expect(missing, `unreachable by keyboard. Tab order was: ${seen.filter(Boolean).join(' | ')}`).toEqual([]);
  });

  test('focus never lands on an invisible element', async ({ page }) => {
    // A focusable element with no box is focus going somewhere the user cannot
    // see — the cursor vanishes and the page appears to stop responding to Tab.
    for (let i = 0; i < MAX_TAB_STOPS; i++) {
      await page.keyboard.press('Tab');
      const el = await focused(page);
      if (el.tag === 'body') continue;
      expect(el.visible, `focus landed on an invisible <${el.tag}> "${el.name}"`).toBe(true);
    }
  });

  test('the join flow can be driven to the security step by keyboard alone', async ({ page }) => {
    const reached = await tabUntil(page, (name) => name.includes('Create Account'));
    expect(reached.found, `never reached Create Account. Saw: ${reached.seen.join(' | ')}`).toBe(true);

    await page.keyboard.press('Enter');

    const address = page.getByRole('textbox', { name: 'Workspace Address' });
    await expect(address).toBeVisible({ timeout: 30_000 });

    // Type into it without clicking: focus should already be there, or reachable.
    if (!(await address.evaluate((el) => el === document.activeElement))) {
      const toField = await tabUntil(page, () => true);
      expect(toField.found).toBe(true);
      await address.focus();
    }
    await page.keyboard.type(config.WORKSPACE_SERVER);

    const next = await tabUntil(page, (name) => name.toUpperCase().includes('NEXT'));
    expect(next.found, `never reached NEXT. Saw: ${next.seen.join(' | ')}`).toBe(true);
    await page.keyboard.press('Enter');

    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({ timeout: 30_000 });
  });

  test('a dialog opened by keyboard can be closed by keyboard', async ({ page }) => {
    // Focus the button directly rather than tabbing to it. Whether it is
    // *reachable* is the first test's job; this one is about whether the dialog
    // it opens can be dismissed. Blind-tabbing coupled the two, and once the
    // landing page grew an Active Sessions navbar the walk landed on a session
    // icon instead — opening a different dialog and failing here for a reason
    // that had nothing to do with Escape.
    const manageAccounts = page.getByRole('button', { name: 'Manage Accounts' });
    await expect(manageAccounts).toBeVisible({ timeout: 30_000 });
    await manageAccounts.focus();
    await expect(manageAccounts).toBeFocused();

    await page.keyboard.press('Enter');

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await settleAnimations(page);

    // Escape is the only exit a keyboard user can rely on; a dialog that ignores
    // it is a trap, whatever its close button looks like.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });
});

/**
 * The controls inside the workspace that were specifically made keyboard-
 * reachable, so a regression there is caught rather than rediscovered.
 *
 * Each of these was broken at some point: the tree's expand toggle was a
 * focusable span nested inside the row button, directory rows were a div with an
 * onClick and no role at all, and the "disabled" wrapper greyed things out with
 * pointer-events while leaving them Tab-and-Enter operable.
 */
test.describe.serial('Keyboard operability (workspace)', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    context = await browser.newContext();
    page = await context.newPage();
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);

    const username = `kbd_${Date.now()}`;
    expect(
      await createAccount(page, username, {
        isFirstUser: true,
        password: config.DEFAULT_PASSWORD,
        uxTracker: null,
      }),
      `could not register ${username}`
    ).toBe(true);

    // Checked, not fired and forgotten: this returns false rather than
    // throwing, so ignoring it let a workspace that never loaded run the
    // whole block and fail later somewhere unrelated.
    expect(
      await waitForWorkspaceLoaded(page, 60_000),
      'the workspace should finish loading',
    ).toBe(true);
    await closeAnyModals(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('the tree expand toggle is a real, focusable control', async () => {
    // It used to be a <span role="button" tabIndex={0}> INSIDE the row button.
    // That is nested interactive content: the row claimed to be one control
    // while containing another, and which one Tab reached was up to the browser.
    //
    // The focused tree puts the chevron (the "peek") on a peer of the selection
    // that has children, so whether one is on screen depends on what is
    // selected. revealPeekToggle selects its way to one.
    //
    // isVisible() answers immediately -- it does not wait. Asked before the tree
    // has painted it returns false, the test skips itself, and the run reports a
    // benign "no expandable tree node" while the assertions below never execute.
    // A test that can silently disable itself reports safety it did not check.
    // Waiting for the tree first makes the skip mean what it says: this
    // workspace genuinely has no peer with children, rather than the tree
    // merely not being ready yet.
    await expect(rootRow(page), 'the hierarchy should render').toBeVisible({ timeout: 15_000 });
    const found: Locator | null = await revealPeekToggle(page);
    if (!found) {
      test.skip(true, 'no expandable tree node in this workspace');
      return;
    }
    const toggle: Locator = found;

    await expect(toggle).toHaveJSProperty('tagName', 'BUTTON');

    await toggle.focus();
    await expect(toggle).toBeFocused();

    // aria-expanded has to actually track the state, or a screen-reader user is
    // told nothing changed.
    const before = await toggle.getAttribute('aria-expanded');
    await page.keyboard.press('Enter');
    await expect(toggle).not.toHaveAttribute('aria-expanded', before ?? '');
  });

  test('the settings dialog closes with Escape', async () => {
    await pressAccountMenuItem(page, 'account-menu-settings');

    const dialog = page.locator('[role="dialog"]').first();
    await expect(dialog).toBeVisible({ timeout: 30_000 });
    await settleAnimations(page);

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  });

  test('directory rows can be selected without a mouse', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/directory');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible({ timeout: 30_000 });

    // The row is a button named for the member it opens. It used to be a plain
    // div with an onClick, so the profile panel beside it — which says "Click on
    // a user to view their profile" — could not be filled from the keyboard.
    const row = page.getByRole('button', { name: /^View profile for / }).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await row.focus();
    await expect(row).toBeFocused();
    await page.keyboard.press('Enter');

    // Selecting shows the member in the profile panel, replacing its empty state.
    await expect(page.getByText('Select a User')).toBeHidden({ timeout: 15_000 });
  });
});
