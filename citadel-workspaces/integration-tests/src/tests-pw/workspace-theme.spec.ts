/**
 * Workspace theming — @playwright/test spec
 *
 * The theme is a workspace-wide setting stored in workspace metadata, so the
 * assertions that matter are the ones a unit test cannot make: that a saved
 * theme actually reaches the server and comes back after a reload, and that the
 * CSS variables on the document really change.
 *
 * The load-bearing check is the LAST one. A workspace theme and a member's
 * light/dark preference are separate concerns, and conflating them is the
 * obvious way to build this wrong — an admin must not be able to force everyone
 * into dark mode by choosing the workspace palette.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  adminCredentials,
  clearBrowserStorage,
  closeAnyModals,
  hasWorkspaceAdmin,
  loginAfterDisconnect,
  waitForAppReady,
  waitForWorkspaceLoaded,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { pressAccountMenuItem } from '../lib/account-menu.js';

/** Read a design token off the document, which is where applyTheme writes. */
async function readToken(page: Page, name: string): Promise<string> {
  return page.evaluate(
    (token) => getComputedStyle(document.documentElement).getPropertyValue(token).trim(),
    name,
  );
}

async function openAppearanceSettings(page: Page): Promise<void> {
  await pressAccountMenuItem(page, 'account-menu-settings');
  // The tab is labelled "Theme"; its visible text is hidden below `sm`, so the
  // accessible name comes from the aria-label rather than the span.
  await page.getByRole('tab', { name: /^theme$/i }).click();
  await expect(page.getByTestId('workspace-appearance-section')).toBeVisible({ timeout: 15_000 });
}

async function openThemeEditor(page: Page): Promise<void> {
  await page.getByTestId('open-workspace-appearance').click();
  await expect(page.getByTestId('workspace-appearance-modal')).toBeVisible({ timeout: 15_000 });
}

test.describe.serial('Workspace theming', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Registering and loading a workspace involves a real server round-trip and
    // the P2P stack coming up, well over the inherited per-test timeout.
    test.setTimeout(300_000);

    context = await browser.newContext();
    page = await context.newPage();

    // Log in as the admin global-setup registered rather than registering a
    // fresh account. Editing the theme needs the `themes` permission, and only
    // the account that INITIALISES the workspace gets one — a spec that
    // registers its own user is the second user and correctly gets nothing.
    // Registering here produced a modal that was read-only for entirely
    // legitimate reasons, which is easy to mistake for a product defect.
    const admin = adminCredentials();

    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);

    const loggedIn = await loginAfterDisconnect(
      page,
      admin.username,
      admin.password,
      null,
      config.WORKSPACE_SERVER,
    );
    expect(loggedIn, `could not log in as the workspace admin (${admin.username})`).toBe(true);

    // Checked, not fired and forgotten: this returns false rather than
    // throwing, so ignoring it let a workspace that never loaded run the
    // whole block and fail later somewhere unrelated.
    expect(
      await waitForWorkspaceLoaded(page, 60_000),
      'the workspace should finish loading',
    ).toBe(true);
    await closeAnyModals(page);

    // If the server already held a workspace from an earlier run, global-setup's
    // account is a plain member and none of the editing assertions can pass.
    // Say so rather than reporting it as a theming failure.
    expect(
      hasWorkspaceAdmin(),
      'global-setup did not initialise the workspace, so no account here can edit the theme. ' +
        'Restart the stack: docker compose restart server internal-service',
    ).toBe(true);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('starts on the default theme, and says it is not yet chosen', async () => {
    await openAppearanceSettings(page);

    await expect(page.getByTestId('current-theme-name')).toHaveText('Avarok Purple');
    // "Nobody has chosen" is a different state from "the workspace chose this",
    // and the section distinguishes them.
    await expect(page.getByText(/not set for this workspace yet/i)).toBeVisible();
  });

  test('the editor opens with the preview and the preset gallery', async () => {
    await openThemeEditor(page);

    await expect(page.getByTestId('theme-preview')).toBeVisible();
    await expect(page.getByTestId('preset-avarok-purple')).toBeVisible();
    await expect(page.getByTestId('preset-nord')).toBeVisible();
    await expect(page.getByTestId('preset-material-lighter')).toBeVisible();
    await expect(page.getByTestId('preset-material-darker')).toBeVisible();
  });

  test('choosing a preset repaints the whole app, not just the mock', async () => {
    const before = await readToken(page, '--primary');

    await page.getByTestId('preset-dracula').click();

    // The preview lives inside the app it is previewing: selecting a theme
    // applies it to the document immediately, which is what makes the editor
    // worth using.
    await expect
      .poll(() => readToken(page, '--primary'), { timeout: 10_000 })
      .not.toBe(before);
  });

  test('clicking part of the preview opens the colour editor for that part', async () => {
    await page.getByTestId('preview-region-sidebar').click();

    const editor = page.getByTestId('appearance-color-editor');
    await expect(editor).toBeVisible();
    await expect(page.getByTestId('color-wheel')).toBeVisible();
    await expect(page.getByTestId('color-wheel-hex')).toBeVisible();
    await expect(page.getByTestId('color-wheel-native')).toBeVisible();
  });

  test('editing a preset creates a copy rather than changing the preset', async () => {
    const hex = page.getByTestId('color-wheel-hex');
    await hex.fill('2E4053');
    await hex.press('Enter');

    // Presets stay pristine so "put it back" is always available.
    await expect(page.getByTestId('appearance-theme-name')).toHaveValue('Dracula Copy');
    await expect(page.getByTestId('appearance-theme-name')).toBeEnabled();
  });

  test('the edited colour reaches the document', async () => {
    // 2E4053 is hsl(211 29% 25%) — assert the token moved to roughly there
    // rather than merely "changed", which a re-render could also satisfy.
    await expect
      .poll(() => readToken(page, '--surface'), { timeout: 10_000 })
      .toMatch(/^21[01]/);
  });

  test('saving persists the theme across a reload', async () => {
    // A reload plus a full workspace restore is a real server round-trip, over
    // the inherited per-test budget.
    test.setTimeout(180_000);

    await page.getByTestId('appearance-save').click();
    // Saving closes the editor. Waiting for that rather than assuming it keeps
    // the reload below from racing a modal still animating out.
    await expect(page.getByTestId('workspace-appearance-modal')).toHaveCount(0);

    // The theme rides in the workspace's metadata, so proving it persisted means
    // making a cold client load the workspace afresh — the assertion no unit
    // test can make.
    //
    // A reload is all that is needed: the app restores the session by itself and
    // comes back into the workspace shell. Earlier versions of this test called
    // loginAfterDisconnect, which navigates to the landing page and hunts for an
    // orphaned session — actively undoing a restore that had already succeeded,
    // and burning 300s in cascading fallbacks before failing. If session restore
    // ever regresses, the workspace assertion below is what catches it.
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);

    const loaded = await waitForWorkspaceLoaded(page, 90_000);
    expect(loaded, 'the app should restore the session and workspace after a reload').toBe(true);

    await openAppearanceSettings(page);
    await expect(page.getByTestId('current-theme-name')).toHaveText('Dracula Copy');
    await expect(page.getByText(/not set for this workspace yet/i)).toHaveCount(0);
  });

  test('the member keeps their own light/dark choice', async () => {
    // The one that matters most. The workspace picks the palette; the member
    // picks which half of it applies. If choosing a workspace theme also forced
    // a colour scheme, an admin could put every member into dark mode.
    const darkBackground = await readToken(page, '--background');

    await page.getByRole('radio', { name: /^light$/i }).click();

    await expect
      .poll(() => readToken(page, '--background'), { timeout: 10_000 })
      .not.toBe(darkBackground);

    // Still the workspace's theme, just its light palette.
    await expect(page.getByTestId('current-theme-name')).toHaveText('Dracula Copy');
  });
});
