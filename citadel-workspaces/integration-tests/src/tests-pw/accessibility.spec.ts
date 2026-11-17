/**
 * Accessibility — @playwright/test spec
 *
 * Runs axe-core against the screens a new user meets before they have an
 * account: the landing page, the join flow, and the login form. These are the
 * first-run surfaces, so a barrier here blocks someone from ever reaching the
 * product.
 *
 * Gated on `serious` and `critical` impact only. `minor` and `moderate` are
 * reported to the log but not failed on — they are dominated by contrast
 * suggestions and best-practice advice that would make this spec a running
 * argument with the designer rather than a defect gate. Anything that actually
 * stops a keyboard or screen-reader user lands in the two levels asserted here.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { AxeBuilder } from '@axe-core/playwright';
import type { Result } from 'axe-core';
import {
  adminCredentials,
  clearBrowserStorage,
  closeAnyModals,
  createAccount,
  hasWorkspaceAdmin,
  loginAfterDisconnect,
  waitForAppReady,
  waitForWorkspaceLoaded,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { pressAccountMenuItem } from '../lib/account-menu.js';

/** WCAG 2.1 A and AA. The level a product is normally held to. */
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

type ColourScheme = 'light' | 'dark';

const BLOCKING = new Set(['serious', 'critical']);

async function freshPage(page: Page, scheme: ColourScheme = 'dark'): Promise<void> {
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await clearBrowserStorage(page);
  // next-themes reads this key while booting, so it has to be written AFTER the
  // storage clear and BEFORE the reload — the reloaded app is the one that
  // comes up in the chosen scheme.
  await page.evaluate((value) => localStorage.setItem('citadel:theme', value), scheme);
  await page.reload({ waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);

  // Assert the scheme actually took. Without this, a light-mode scan that
  // quietly came up dark would pass while testing the mode that was already
  // covered — a green result proving nothing, which is worse than no test.
  await expect
    .poll(
      () => page.evaluate(() => document.documentElement.classList.contains('dark')),
      { timeout: 15_000, message: `the app should render in ${scheme} mode` },
    )
    .toBe(scheme === 'dark');
}

/**
 * Wait for running CSS animations and transitions to finish.
 *
 * axe composites the colours it measures, so scanning during a fade-in reads the
 * blended value rather than the real one. That produced three different contrast
 * ratios for the SAME button on three screens (3.7, 3.88, 4.1) — a measurement
 * artefact that would have sent us to change a colour that is fine at rest.
 *
 * Waits on document.getAnimations() rather than a fixed delay, so it returns the
 * moment the page is actually still.
 */
/**
 * Finishes every animation instantly, for the duration of the scan.
 *
 * Waiting for animations to settle is not enough on a surface whose content
 * arrives over the network: the member list has no animations yet when the
 * wait runs, so it passes, and the rows then mount and fade in WHILE axe is
 * measuring. axe composites opacity into the effective colour, so it read
 * white text 30ms into a 300ms fade as `#292a35` on `#131420` — a 1.28:1
 * contrast failure for text that is fine at rest. It reproduced only in the
 * full suite, where earlier specs leave more accounts in the list, and passed
 * when the same test ran alone.
 *
 * Forcing animations to their end state makes the reading deterministic
 * without weakening it: contrast at rest is exactly what the check is for.
 */
async function freezeAnimations(page: Page): Promise<void> {
  await page.addStyleTag({
    content: `*, *::before, *::after {
      animation-duration: 0.001s !important;
      animation-delay: 0s !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.001s !important;
      transition-delay: 0s !important;
    }`,
  });
}

async function settleAnimations(page: Page): Promise<void> {
  await freezeAnimations(page);
  await page.waitForFunction(
    () => {
      // `every` on an EMPTY list is vacuously true, and that is the case that
      // bit: a list which loads over the network has no animations yet when
      // this first runs, so the predicate passed instantly, the rows then
      // mounted and faded in, and axe measured white text at ~9% opacity as a
      // 1.26:1 contrast failure. Requiring the still state to hold across two
      // frames means "nothing animating YET" cannot masquerade as settled.
      const still = () =>
        document.getAnimations().every((a) => a.playState === 'finished' || a.playState === 'idle');
      if (!still()) return false;
      return new Promise<boolean>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(still())));
      });
    },
    undefined,
    { timeout: 15_000 }
  ).catch(() => {
    // An indefinite animation (a spinner, a pulse) never finishes. Scanning
    // anyway is better than failing the a11y check over it; the report names the
    // element either way.
    console.log(`[a11y] animations still running; scanning anyway`);
  });
}

/**
 * Scan the current page and fail on anything of serious or critical impact.
 *
 * Reports the offending selector and the rule's help URL, because "3 violations"
 * in a CI log is not something anyone can act on.
 */

/**
 * Contrast of list markers against the page.
 *
 * axe does not evaluate ::marker pseudo-elements, so a marker can be
 * invisible while every scan reports clean. That is not hypothetical: the
 * prose bullets sat at Tailwind Typography's gray-300 default and measured
 * 1.47:1 against the light theme's white page — the bullets in every MDX
 * document were effectively not there, in the one mode nobody had screenshotted.
 *
 * Returns null when the surface has no list to measure, so a caller can tell
 * "no lists here" from "markers are fine".
 */
async function measureMarkerContrast(page: Page): Promise<number | null> {
  return page.evaluate(() => {
    // An li that actually RENDERS a marker. Plain `querySelector('li')` finds
    // the sidebar's menu items first — list-style:none, so they have no visible
    // marker and inherit a near-black colour that passes any threshold. A gate
    // written that way measures nothing and reports success, which is worse
    // than not having it.
    const li = Array.from(document.querySelectorAll('li')).find(
      (candidate) => getComputedStyle(candidate).listStyleType !== 'none',
    );
    if (!li) return null;
    const parse = (value: string) => (value.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const marker = parse(getComputedStyle(li, '::marker').color);
    const background = parse(getComputedStyle(document.body).backgroundColor);
    if (marker.length !== 3 || background.length !== 3) return null;
    const a = luminance(marker);
    const b = luminance(background);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  });
}

async function expectNoBlockingViolations(page: Page, screen: string): Promise<void> {
  await settleAnimations(page);

  const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze();

  const blocking = violations.filter((v: Result) => BLOCKING.has(v.impact ?? ''));
  const advisory = violations.filter((v: Result) => !BLOCKING.has(v.impact ?? ''));

  if (advisory.length) {
    console.log(
      `[a11y] ${screen}: ${advisory.length} advisory (not gated): ` +
        advisory.map((v: Result) => `${v.id}(${v.impact})`).join(', ')
    );
  }

  const detail = blocking
    .map((v: Result) => {
      // The element's markup and axe's explanation, not just a class name. A CI
      // log saying `.h-10` names nothing anyone can act on; the html and the
      // measured contrast ratio do.
      const nodes = v.nodes
        .slice(0, 3)
        .map((n) => {
          const why = (n.any?.[0]?.message ?? n.all?.[0]?.message ?? '').replace(/\s+/g, ' ');
          return `      at: ${String(n.target.join(' '))}\n      html: ${n.html.slice(0, 200)}` +
            (why ? `\n      why: ${why}` : '');
        })
        .join('\n');
      return `  ${v.impact} ${v.id}: ${v.help}\n${nodes}\n    see: ${v.helpUrl}`;
    })
    .join('\n');

  expect(blocking, `${screen} has blocking accessibility violations:\n${detail}`).toEqual([]);
}

/** Click without waiting for stability — the app re-renders while leader election settles. */
async function click(page: Page, name: RegExp | string): Promise<void> {
  const button = page.getByRole('button', { name }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click({ force: true });
}

/**
 * Both schemes, because every scan here used to run in the default one.
 *
 * That is not a hypothetical gap. A fill paired with `text-foreground` rather
 * than its own `-foreground` can only be right in one mode, since the page text
 * colour flips and the fill does not. The app defaults to dark, where the two
 * happened to coincide — so 56 such pairings shipped, and in light mode the
 * primary button on Login, Join and Connect measured 2.19:1. Ten green a11y
 * tests said nothing about it.
 */
const SCHEMES: readonly ColourScheme[] = ['dark', 'light'];

/**
 * Close whatever overlay is open, and wait until it is actually gone.
 *
 * These tests share one page and run in order, so each one's teardown is the
 * next one's precondition. `keyboard.press('Escape')` starts a Radix close
 * animation and returns immediately — so the next test's click landed while the
 * previous dialog was still on screen, was swallowed by its overlay, and the
 * assertion failed on a dialog that never opened. Measured as "notification
 * centre" waiting thirty seconds for `[role="dialog"]` after the settings test
 * had pressed Escape and moved on.
 */
async function closeAnyOverlay(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 10_000 });
}

for (const scheme of SCHEMES) {

test.describe(`Accessibility (first-run surfaces, ${scheme})`, () => {
  test.beforeEach(async ({ page }) => {
    await freshPage(page, scheme);
  });

  test('landing page', async ({ page }) => {
    // Asserted explicitly rather than left to the axe scan: a missing landmark
    // is impact 'moderate', which this suite reports but does not gate on, so
    // the scan alone would go green with no <main> on the page at all.
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoBlockingViolations(page, `landing/${scheme}`);
  });

  // Two surfaces this suite never reached, and where scanning found real
  // violations the moment it did: the 404 page had no <main> landmark at all,
  // and the connection-failure modal shipped a link at 2.83:1 contrast. Both
  // are states no other spec drives, which is exactly why they drifted.
  test('not-found page', async ({ page }) => {
    await page.goto(`${config.BASE_URL}/this-route-does-not-exist`, {
      waitUntil: 'commit',
      timeout: 60_000,
    });
    await expect(page.getByRole('heading', { name: '404' })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('main')).toBeVisible();
    await expectNoBlockingViolations(page, `not-found/${scheme}`);
  });

  test('connection-failure modal, including the agent download offer', async ({ page }) => {
    // Refusing the socket, rather than stopping the agent: the integration
    // stack shares one backend, so taking the agent down breaks every other
    // spec running against it. Note page.route() does NOT see websockets —
    // only routeWebSocket does, and a route() glob here fails silently by
    // simply never matching, which reads as "the modal never opened".
    await page.routeWebSocket('**/ws', (ws) => ws.close());
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await expect(page.getByText(/Don't have the agent running/i)).toBeVisible({ timeout: 120_000 });
    await expectNoBlockingViolations(page, `connection-failure/${scheme}`);
  });

  test('join workspace — address step', async ({ page }) => {
    await click(page, 'Create Account');
    await expect(page.getByRole('textbox', { name: 'Workspace Address' })).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, `join/address/${scheme}`);
  });

  test('join workspace — security step', async ({ page }) => {
    await click(page, 'Create Account');
    const address = page.getByRole('textbox', { name: 'Workspace Address' });
    await expect(address).toBeVisible({ timeout: 30_000 });
    await address.fill(config.WORKSPACE_SERVER);
    await click(page, 'NEXT');

    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, `join/security/${scheme}`);
  });

  // The wizard's third step was never scanned, which is how an icon-only
  // password toggle with no accessible name and tabIndex={-1} survived here
  // while the identical control on the login form was fully labelled.
  test('join workspace — profile step', async ({ page }) => {
    await click(page, 'Create Account');
    const address = page.getByRole('textbox', { name: 'Workspace Address' });
    await expect(address).toBeVisible({ timeout: 30_000 });
    await address.fill(config.WORKSPACE_SERVER);
    await click(page, 'NEXT');
    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({ timeout: 30_000 });
    await click(page, 'NEXT');

    await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, `join/profile/${scheme}`);
  });

  // Both password toggles must be operable by keyboard and announce what they
  // do. axe cannot see the keyboard trap: tabIndex={-1} removes the control
  // from the tab order entirely, which is a 2.1.1 failure no automated colour
  // or name check reports.
  test('the profile step password toggles are reachable and named', async ({ page }) => {
    await click(page, 'Create Account');
    const address = page.getByRole('textbox', { name: 'Workspace Address' });
    await expect(address).toBeVisible({ timeout: 30_000 });
    await address.fill(config.WORKSPACE_SERVER);
    await click(page, 'NEXT');
    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({ timeout: 30_000 });
    await click(page, 'NEXT');
    await expect(page.locator('#password')).toBeVisible({ timeout: 30_000 });

    // `show|hide <anything> password`, not `show password`.
    //
    // Both toggles used to be called "Show password" -- one name for two
    // controls, so a screen-reader user tabbing through heard it twice with
    // nothing to say which field they were on. They are now "Show profile
    // password" and "Show confirm profile password", and this assertion, pinned
    // to the exact old string, failed on the fix that improved them. A rename
    // that makes a name MORE specific must not read as the control vanishing.
    const toggles = page.getByRole('button', { name: /(show|hide).*password/i });
    await expect(toggles).toHaveCount(2); // profile password + confirm

    // And they must still be distinguishable from each other, which is the
    // reason they were renamed.
    const names = await toggles.evaluateAll((els) =>
      els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''),
    );
    expect(new Set(names).size).toBe(2);

    const first = toggles.first();
    await expect(first).toHaveAttribute('aria-pressed', 'false');

    // Reachable by keyboard, not just by mouse.
    await page.locator('#password').focus();
    await page.keyboard.press('Tab');
    await expect(first).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#password')).toHaveAttribute('type', 'text');
  });

  test('login form, including advanced options', async ({ page }) => {
    await click(page, 'Sign In');
    await expect(page.getByRole('heading', { name: 'Login to Workspace' })).toBeVisible({ timeout: 30_000 });

    // Expand Advanced Options too: the controls it hides (server address,
    // Configure, the passkey-enrol switch) are part of this screen and would
    // otherwise never be scanned.
    const advanced = page.getByRole('button', { name: /Advanced Options/i });
    if (await advanced.isVisible().catch(() => false)) {
      await advanced.click({ force: true });
    }

    await expectNoBlockingViolations(page, `login/${scheme}`);
  });

  // The mirror of the registration form: this signs in with an EXISTING
  // credential, so current-password. new-password here would make a manager
  // offer to save a new one on every sign-in.
  test('the login form tells a password manager what each field is', async ({ page }) => {
    await click(page, 'Sign In');
    await expect(page.locator('#username')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#username')).toHaveAttribute('autocomplete', 'username');
    await expect(page.locator('#password')).toHaveAttribute('autocomplete', 'current-password');
  });

  test('manage accounts dialog', async ({ page }) => {
    await click(page, 'Manage Accounts');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, `manage-accounts/${scheme}`);
  });
});
}

/**
 * The screens a user spends their time on, once they are in.
 *
 * Serial, sharing one page and one account: registering is the slow part, and
 * scanning five screens does not need five accounts. Each test navigates from
 * wherever the last one left off.
 */
test.describe.serial('Accessibility (authenticated surfaces)', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Registering and loading a workspace is well over the 120s default this
    // hook inherits from the per-test timeout — it involves a real server
    // round-trip and the P2P stack coming up. Timing out here reports as a
    // layout failure, which is misleading; the scans themselves are fast.
    test.setTimeout(300_000);

    // newContext, not browser.newPage(): the latter creates an implicit context
    // and axe refuses to run in one ("Please use browser.newContext()").
    context = await browser.newContext();
    page = await context.newPage();
    await freshPage(page);

    const username = `a11y_${Date.now()}`;
    const registered = await createAccount(page, username, {
      isFirstUser: true,
      password: config.DEFAULT_PASSWORD,
      uxTracker: null,
    });
    expect(registered, `could not register ${username}`).toBe(true);

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

  test('workspace shell', async () => {
    await expectNoBlockingViolations(page, 'workspace');
  });

  /**
   * The same shell in LIGHT.
   *
   * The scans above run in the default scheme, and that gap let light mode ship
   * substantially unusable: `prose-invert` applied unconditionally, `text-white`
   * on .prose in the stylesheet, and `text-primary-foreground` used as a
   * standalone colour on three sidebar rows. Every one rendered text
   * light-on-light, every one was invisible in dark, and axe reports exactly
   * this as a contrast violation — nobody had ever pointed it at light.
   *
   * The scheme is asserted before scanning: a light scan that quietly ran in
   * dark would pass while re-testing the mode already covered, which is worse
   * than not running at all.
   */
  test('workspace shell in light mode', async () => {
    test.setTimeout(180_000);
    await page.evaluate(() => localStorage.setItem('citadel:theme', 'light'));
    // Reload, not a history navigation: next-themes reads the key while
    // booting and does not remount on pushState.
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);
    await waitForWorkspaceLoaded(page, 90_000);
    await closeAnyModals(page);

    await expect
      .poll(
        () => page.evaluate(() => document.documentElement.classList.contains('dark')),
        { timeout: 15_000, message: 'the shell should be rendering in light mode' },
      )
      .toBe(false);

    await expectNoBlockingViolations(page, 'workspace/light');

    // Measured, because axe cannot see it. 3:1 is the WCAG threshold for
    // non-text content that conveys meaning, which a list marker does — it is
    // the only thing distinguishing a list from stacked paragraphs.
    const markerContrast = await measureMarkerContrast(page);
    expect(
      markerContrast,
      'the workspace should render MDX content with a list to measure',
    ).not.toBeNull();
    expect(
      markerContrast ?? 0,
      `list markers measure ${(markerContrast ?? 0).toFixed(2)}:1 in light mode`,
    ).toBeGreaterThanOrEqual(3);

    // The other surfaces, while we are already in light. Scanning only the
    // shell would have left settings and the directory unexamined in the very
    // mode that hid three separate defects.
    await pressAccountMenuItem(page, 'account-menu-settings');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, 'settings/light');
    await closeAnyOverlay(page);
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 15_000 });

    await page.evaluate(() => {
      window.history.pushState({}, '', '/directory');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible({ timeout: 30_000 });
    await expectNoBlockingViolations(page, 'directory/light');

    // Back to the default, so the scans after this one are unaffected.
    await page.evaluate(() => localStorage.setItem('citadel:theme', 'dark'));
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);
    await waitForWorkspaceLoaded(page, 90_000);
    await closeAnyModals(page);
  });

  test('settings modal', async () => {
    await pressAccountMenuItem(page, 'account-menu-settings');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'settings');

    await closeAnyOverlay(page);
  });

  test('notification centre', async () => {
    // Waited for, not forced blind: the bell is behind whatever the previous
    // test left on screen, and `force` clicks coordinates rather than a
    // control that is ready. See ROBUSTNESS.md round 312.
    const bell = page.getByTestId('notification-bell');
    await expect(bell).toBeEnabled({ timeout: 10_000 });
    await bell.click({ force: true });
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'notifications');

    await closeAnyOverlay(page);
  });

  test('user directory', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/directory');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'directory');
  });

  // Messages and the file manager are two of the surfaces a user spends the
  // most time on and neither was ever scanned. Comparing the scanned list
  // against the routes that actually exist is what turned up the join
  // wizard's unnamed password toggle, so the same comparison is applied here.
  test('messages', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/messages');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'messages');
  });

  // WCAG 2.4.2. Asserted against the RUNNING app, not the component: the unit
  // tests prove titleForPath maps routes to distinct names, which says nothing
  // about whether <DocumentTitle /> is actually mounted. Every route shared one
  // title before this, so a screen reader announced the same page name wherever
  // you navigated and every history entry looked identical.
  //
  // Each route asserts its OWN expected title rather than "it changed from the
  // last one". The relative version passed in isolation and failed in sequence:
  // it polled for "different from previous" and then read the title again, so a
  // route still mid-settle was recorded as that route's title and the next
  // comparison ran against a value that was never real.
  test('each route has its own page title', async () => {
    const expected: ReadonlyArray<readonly [string, RegExp]> = [
      ['/workspace', /^Workspace ·/],
      ['/messages', /^Messages ·/],
      ['/directory', /^Directory ·/],
    ];

    const seen: string[] = [];
    for (const [path, pattern] of expected) {
      await page.evaluate((p) => {
        window.history.pushState({}, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);

      await expect
        .poll(() => page.title(), { timeout: 15_000, message: `${path} should set its own title` })
        .toMatch(pattern);
      seen.push(await page.title());
    }

    expect(new Set(seen).size, `routes must not share a title, got ${JSON.stringify(seen)}`).toBe(
      seen.length,
    );
  });

  // The workspace had NO landmarks at all — no main, no nav, nothing — and 43
  // tabbable controls. Measured before the fix: 37 tab stops between the top of
  // the page and the first control inside the content area, every time you
  // navigated. axe stays silent because its `region` rule is moderate impact,
  // below the serious/critical threshold this suite fails on.
  test('the workspace can be entered without tabbing through the sidebar', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/workspace');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByTestId('sidebar-toggle')).toBeVisible({ timeout: 30_000 });

    // Structure a screen reader can navigate by.
    await expect(page.getByRole('main')).toBeAttached();
    await expect(page.getByRole('navigation', { name: /workspace navigation/i })).toBeAttached();
    await expect(page.getByRole('banner')).toBeAttached();

    // The skip link must be FIRST, or it is not a skip link.
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: /skip to main content/i });
    await expect(skip).toBeFocused();
    // Hidden until focused, so it costs the visual design nothing.
    await expect(skip).toBeVisible();

    await page.keyboard.press('Enter');
    // Focus must LAND in main, not merely scroll it into view — that is what
    // tabIndex={-1} on the target is for.
    await expect
      .poll(
        () => page.evaluate(() => {
          const el = document.activeElement;
          const main = document.querySelector('main');
          return Boolean(el && main && (el === main || main.contains(el)));
        }),
        { timeout: 5_000, message: 'focus should move into main' },
      )
      .toBe(true);
  });

  // Headings are how a screen reader user navigates WITHIN a page, and all
  // three main routes were broken in a different way: /workspace had two h1s
  // (the office name and the document's own title), /messages had none at all
  // and opened at h2, /directory jumped h1 -> h3. axe's heading-order rule is
  // moderate impact and page-has-heading-one is best-practice only, so neither
  // reaches the serious/critical threshold this suite fails on.
  test('every route has exactly one h1 and skips no heading levels', async () => {
    for (const path of ['/workspace', '/messages', '/directory']) {
      await page.evaluate((p) => {
        window.history.pushState({}, '', p);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, path);
      await expect(page.getByTestId('sidebar-toggle')).toBeVisible({ timeout: 30_000 });

      const outline = await expect
        .poll(
          () =>
            page.evaluate(() =>
              Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
                // Hidden headings are not in the outline a reader traverses,
                // but sr-only ones ARE — hence offsetParent, which sr-only
                // elements still have.
                .filter((h) => (h as HTMLElement).offsetParent !== null)
                .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 40) })),
            ),
          { timeout: 20_000, message: `${path} should render headings` },
        )
        .not.toEqual([]);
      void outline;

      const headings: Array<{ level: number; text: string }> = await page.evaluate(() =>
        Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))
          .filter((h) => (h as HTMLElement).offsetParent !== null)
          .map((h) => ({ level: Number(h.tagName[1]), text: (h.textContent || '').trim().slice(0, 40) })),
      );

      const h1s = headings.filter((h) => h.level === 1);
      expect(
        h1s.length,
        `${path} should have exactly one h1, got ${JSON.stringify(h1s.map((h) => h.text))}`,
      ).toBe(1);

      // A level may go deeper by one at a time; jumping h1 -> h3 leaves a reader
      // guessing whether a section was missed.
      const skips: string[] = [];
      for (let i = 1; i < headings.length; i += 1) {
        const jump = headings[i].level - headings[i - 1].level;
        if (jump > 1) {
          skips.push(
            `h${headings[i - 1].level} "${headings[i - 1].text}" -> h${headings[i].level} "${headings[i].text}"`,
          );
        }
      }
      expect(skips, `${path} skips heading levels:\n  ${skips.join('\n  ')}`).toEqual([]);
    }
  });

  test('file manager', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/workspace?section=files');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    // `section=files` alone opens Server Storage, whose tree is always seeded
    // with the protected Sent Files folder: settled on that row, the scan sees
    // the file browser itself rather than whatever the shell showed first.
    await expect(page.getByTestId('vfs-item-Sent Files')).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'files');
  });
});

/**
 * The theme editor needs its own session. Only the account that INITIALISES the
 * workspace holds the `themes` permission, and the describe above deliberately
 * registers a fresh user — who gets a correctly read-only editor with no colour
 * wheel to scan. Logging in as the admin here is the difference between scanning
 * the widget and scanning a disabled placeholder.
 */
test.describe.serial('Accessibility (theme editor)', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    context = await browser.newContext();
    page = await context.newPage();
    await freshPage(page);

    const admin = adminCredentials();
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

    expect(
      hasWorkspaceAdmin(),
      'global-setup did not initialise the workspace, so no account here can open the theme editor. ' +
        'Restart the stack: docker compose restart server internal-service',
    ).toBe(true);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('theme editor, including the colour wheel', async () => {
    // The largest surface added recently and the one axe is most likely to have
    // something to say about: a custom colour wheel is a hand-built widget, not
    // a native control, and the preview is a grid of buttons standing in for
    // parts of the app.
    await pressAccountMenuItem(page, 'account-menu-settings');

    await page.getByRole('tab', { name: /^theme$/i }).click({ force: true });
    const openAppearance = page.getByTestId('open-workspace-appearance');
    await expect(openAppearance).toBeEnabled({ timeout: 10_000 });
    await openAppearance.click({ force: true });
    await expect(page.getByTestId('workspace-appearance-modal')).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'theme editor');

    // The wheel only exists once a part of the preview is selected, so scanning
    // the editor alone would never see it.
    await page.getByTestId('preview-region-sidebar').click({ force: true });
    await expect(page.getByTestId('color-wheel')).toBeVisible({ timeout: 30_000 });

    await expectNoBlockingViolations(page, 'theme editor — colour wheel');
  });
});
