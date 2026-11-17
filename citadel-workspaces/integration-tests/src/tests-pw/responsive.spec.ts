/**
 * Responsive layout — @playwright/test spec
 *
 * Checks the primary flows at phone width. The failure this targets is
 * horizontal overflow: content wider than the viewport, so the page scrolls
 * sideways and controls sit off-screen where nobody finds them.
 *
 * Overflow is asserted on the document rather than eyeballed, and the check
 * names the widest offending element — "the page scrolls sideways" is not
 * something anyone can act on, "this element is 480px in a 375px viewport" is.
 *
 * 375x667 is an iPhone SE, the narrowest mainstream size worth supporting. If
 * the layout holds here it holds on anything wider.
 */

import { test, expect, type BrowserContext, type Page } from '@playwright/test';
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

const PHONE = { width: 375, height: 667 };

/** How much overflow to tolerate. Sub-pixel rounding is not a layout bug. */
const SLOP_PX = 2;

interface Overflow {
  scrollWidth: number;
  clientWidth: number;
  worst: { tag: string; cls: string; width: number; right: number } | null;
}

/**
 * Measure horizontal overflow and identify the element responsible.
 *
 * Elements are checked against the documentElement's client width; the widest
 * right edge past it is reported. Fixed/absolute overlays that are deliberately
 * off-screen (closed drawers, toast rails) are skipped — they are positioned
 * outside the viewport by design and are not what this is looking for.
 */
async function measureOverflow(page: Page): Promise<Overflow> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const limit = doc.clientWidth;
    let worst: { tag: string; cls: string; width: number; right: number } | null = null;

    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      if (style.position === 'fixed' || style.visibility === 'hidden' || style.display === 'none') continue;
      // A deliberately off-screen panel (a closed drawer) has no painted size.
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit) continue;
      if (!worst || rect.right > worst.right) {
        worst = {
          tag: el.tagName.toLowerCase(),
          cls: String(el.className).slice(0, 120),
          width: Math.round(rect.width),
          right: Math.round(rect.right),
        };
      }
    }

    return { scrollWidth: doc.scrollWidth, clientWidth: limit, worst };
  });
}

async function expectNoHorizontalOverflow(page: Page, screen: string): Promise<void> {
  const { scrollWidth, clientWidth, worst } = await measureOverflow(page);

  const detail = worst
    ? `\n  widest offender: <${worst.tag} class="${worst.cls}"> ` +
      `is ${worst.width}px wide, right edge at ${worst.right}px (viewport ${clientWidth}px)`
    : '';

  expect(
    scrollWidth,
    `${screen} scrolls horizontally at ${PHONE.width}px: document is ${scrollWidth}px ` +
      `against a ${clientWidth}px viewport.${detail}`
  ).toBeLessThanOrEqual(clientWidth + SLOP_PX);
}

/**
 * Any element sticking out of the flex parent that sizes it.
 *
 * `w-full` is 100% of the PARENT, not "the space that is left". On a flex child
 * with a sibling those are different numbers, and the difference gets painted
 * over whatever sits alongside. The workspace switcher did exactly this: it
 * overhung its group by the width of the sidebar toggle beside it and covered
 * the notification bell with its chevron.
 *
 * Every check already in place missed it, because they all ask whether the
 * DOCUMENT is wider than the viewport. This one stayed comfortably inside
 * 375px and collided with a sibling instead.
 */
async function measureFlexOverhang(
  page: Page,
): Promise<Array<{ tag: string; cls: string; by: number }>> {
  return page.evaluate(() => {
    const out: Array<{ tag: string; cls: string; by: number }> = [];
    for (const el of Array.from(document.querySelectorAll('*'))) {
      const parent = el.parentElement;
      if (!parent) continue;
      const ps = getComputedStyle(parent);
      if (!ps.display.includes('flex')) continue;
      // A parent that clips or scrolls cannot leak a child over its neighbours.
      if (ps.overflowX !== 'visible') continue;
      const es = getComputedStyle(el);
      if (es.position === 'absolute' || es.position === 'fixed') continue;
      if (es.display === 'none' || es.visibility === 'hidden') continue;
      // Pulling an element out deliberately is a legitimate technique; only
      // unintended overhang is worth reporting.
      if (parseFloat(es.marginLeft) < 0 || parseFloat(es.marginRight) < 0) continue;
      const r = el.getBoundingClientRect();
      const pr = parent.getBoundingClientRect();
      if (r.width === 0 || pr.width === 0) continue;
      const by = Math.max(r.right - pr.right, pr.left - r.left);
      if (by > 1) {
        out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 80), by: Math.round(by) });
      }
    }
    return out.sort((a, b) => b.by - a.by);
  });
}

/**
 * Anything cut off by an ancestor that clips horizontally with no way to scroll.
 *
 * The sibling-overhang check above only inspects FLEX parents, and that is not
 * where this family of bug always lives. The user-search row sat inside a Radix
 * ScrollArea whose viewport child is `display: table; min-width: 100%` — a table
 * shrink-wraps to MAX-CONTENT, so the row grew to 331px inside a 291px viewport
 * and 40px of it, the end of the name and part of the role badge, was simply
 * clipped. The name had `text-ellipsis` and it never engaged, because inside a
 * table there was always more width to take.
 *
 * `overflowX: hidden` is the signal: content wider than that box is gone, with
 * no scrollbar to reach it. Boxes that scroll horizontally are excluded — being
 * wider than the viewport is the whole point of those.
 */
async function measureClippedContent(
  page: Page,
): Promise<Array<{ tag: string; cls: string; by: number; clipper: string }>> {
  return page.evaluate(() => {
    const out: Array<{ tag: string; cls: string; by: number; clipper: string }> = [];
    const label = (el: Element) => `${el.tagName}.${String(el.className || '').slice(0, 50)}`;

    /**
     * Screen-reader-only content is clipped ON PURPOSE — `clip: rect(0,0,0,0)`
     * with a 1x1 box is how a heading stays in the accessibility tree while
     * taking no visual space. Everything inside one is therefore "cut off" by
     * definition, and reporting it hides real clipping in the noise. Matched on
     * the clip signature, so an element clipped by ordinary overflow still
     * counts.
     */
    const inSrOnly = (el: Element): boolean => {
      for (let n: Element | null = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.clip === 'rect(0px, 0px, 0px, 0px)' || cs.clipPath === 'inset(50%)') return true;
      }
      return false;
    };

    for (const el of Array.from(document.querySelectorAll('*'))) {
      const style = getComputedStyle(el);
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      if (style.position === 'fixed') continue;
      if (inSrOnly(el)) continue;

      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Nearest ancestor that clips horizontally without offering a scrollbar.
      let clipper: Element | null = el.parentElement;
      while (clipper) {
        const cs = getComputedStyle(clipper);
        if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') break;
        if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { clipper = null; break; }
        clipper = clipper.parentElement;
      }
      if (!clipper) continue;

      const cRect = clipper.getBoundingClientRect();
      const by = Math.round(Math.max(rect.right - cRect.right, cRect.left - rect.left));
      if (by > 1) {
        out.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 60), by, clipper: label(clipper) });
      }
    }
    return out.sort((a, b) => b.by - a.by);
  });
}

/**
 * Interactive elements smaller than the WCAG 2.2 floor of 24x24 CSS px.
 *
 * Separate from overflow because axe reports neither, and this one is easy to
 * assume is covered: a 16px control has a correct role, a correct accessible
 * name and passing contrast, so every accessibility gate already in place is
 * green while it remains genuinely hard to hit with a thumb. Three shipped that
 * way on the pre-auth screens, one of them the close button shared by every
 * dialog in the app.
 */
const MIN_TARGET_PX = 24;

/**
 * Fixed-position panels that hang outside the viewport.
 *
 * `position: fixed` elements are laid out against the viewport, not the
 * document, so one that is wider than the screen does NOT grow
 * `document.scrollWidth` — every overflow check here stays green while the
 * panel sits partly off-screen. The notification sheet did exactly this: an
 * unprefixed `w-[400px]` on a 375px phone put 25px of the panel, including the
 * heading's own padding, past the left edge. It read as "this panel has no
 * margin" rather than as overflow.
 */
async function measureOffscreenPanels(
  page: Page,
): Promise<Array<{ tag: string; cls: string; left: number; right: number }>> {
  return page.evaluate(() => {
    const out: Array<{ tag: string; cls: string; left: number; right: number }> = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
      const style = getComputedStyle(el);
      if (style.position !== 'fixed') continue;
      if (style.display === 'none' || style.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // 1px of slop: sub-pixel layout rounding is not a defect.
      if (r.left < -1 || r.right > window.innerWidth + 1) {
        out.push({
          tag: el.tagName.toLowerCase(),
          cls: (el.className || '').toString().slice(0, 80),
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    }
    return out.sort((a, b) => a.left - b.left);
  });
}

async function expectNoSmallTapTargets(page: Page, screen: string): Promise<void> {
  // Settle first, or the reading is fiction. Radix animates dialogs in with
  // `zoom-in-95`, so a 24px control measures 22.8 mid-flight and every button in
  // an opening modal reports as undersized. The first run of this check "found"
  // two such controls, both of which round-tripped to exactly 24 — the tell that
  // the transform, not the CSS, was being measured.
  await page
    .evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          // Indefinite animations (spinners, pulses) never finish; waiting on
          // one would hang instead of settling.
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ).then(() => undefined),
    )
    .catch(() => undefined);

  const small = await page.evaluate((min) => {
    const selector =
      'button,a[href],[role="button"],[role="switch"],[role="tab"],input[type="checkbox"],input[type="radio"]';
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        const style = getComputedStyle(el);
        if (style.visibility === 'hidden' || style.display === 'none') return false;
        // Screen-reader-only controls are deliberately 1x1 and clipped: they
        // exist for AT and keyboard, and are never a pointer target, so a 24px
        // minimum would forbid the technique rather than catch a defect. The
        // skip link is one. Matched on the clip signature specifically, so a
        // genuinely 1px VISIBLE button still fails.
        const clipped =
          style.clip === 'rect(0px, 0px, 0px, 0px)' || style.clipPath === 'inset(50%)';
        if (clipped && rect.width <= 1 && rect.height <= 1) return false;
        return rect.width < min || rect.height < min;
      })
      .map((el) => {
        const rect = el.getBoundingClientRect();
        const label = (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 30);
        return `<${el.tagName.toLowerCase()}> "${label}" ${Math.round(rect.width)}x${Math.round(rect.height)}`;
      });
  }, MIN_TARGET_PX);

  expect(
    small,
    `${screen} has tap targets under ${MIN_TARGET_PX}px at ${PHONE.width}px:\n  ` + small.join('\n  ')
  ).toEqual([]);
}

async function click(page: Page, name: RegExp | string): Promise<void> {
  const button = page.getByRole('button', { name }).first();
  await expect(button).toBeVisible({ timeout: 30_000 });
  await button.click({ force: true });
}

test.describe('Responsive layout at 375px', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(PHONE);
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);
  });

  test('landing page fits the viewport', async ({ page }) => {
    await expectNoHorizontalOverflow(page, 'landing');
  });

  test('landing actions are reachable', async ({ page }) => {
    // The three entry points. If one is off-screen at this width there is no way
    // into the product from a phone.
    for (const name of ['Create Account', 'Sign In', 'Manage Accounts']) {
      await expect(page.getByRole('button', { name })).toBeInViewport({ timeout: 15_000 });
    }
  });

  test('join flow fits the viewport', async ({ page }) => {
    await click(page, 'Create Account');
    const address = page.getByRole('textbox', { name: 'Workspace Address' });
    await expect(address).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, 'join/address');

    await address.fill(config.WORKSPACE_SERVER);
    await click(page, 'NEXT');
    await expect(page.getByRole('heading', { name: 'Security Settings' })).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, 'join/security');
  });

  test('login form fits the viewport, including advanced options', async ({ page }) => {
    await click(page, 'Sign In');
    await expect(page.getByRole('heading', { name: 'Login to Workspace' })).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, 'login');

    const advanced = page.getByRole('button', { name: /Advanced Options/i });
    if (await advanced.isVisible().catch(() => false)) {
      await advanced.click({ force: true });
      // The passkey-enrol switch, or -- where WebAuthn cannot run on this page --
      // the sentence saying so. Plaintext "Remember Credentials" is gone.
      await expect(page.getByText(/Add a security key after I sign in|Passkeys need a secure/i)).toBeVisible({ timeout: 15_000 });
      await expectNoHorizontalOverflow(page, 'login/advanced');
    }
  });

  test('manage accounts dialog fits the viewport', async ({ page }) => {
    await click(page, 'Manage Accounts');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });
    await expectNoHorizontalOverflow(page, 'manage-accounts');
  });
});

/**
 * The workspace itself at phone width.
 *
 * This is where overflow is most likely: a fixed-width sidebar beside a content
 * column has to collapse rather than push the page sideways. Serial and sharing
 * one account, since registering is the slow part.
 */
test.describe.serial('Responsive workspace at 375px', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    // Registering and loading a workspace is well over the 120s default this
    // hook inherits from the per-test timeout — it involves a real server
    // round-trip and the P2P stack coming up. Timing out here reports as a
    // layout failure, which is misleading; the scans themselves are fast.
    test.setTimeout(300_000);

    context = await browser.newContext({ viewport: PHONE });
    page = await context.newPage();

    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);

    const username = `resp_${Date.now()}`;
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

  test('workspace shell fits the viewport', async () => {
    await expectNoHorizontalOverflow(page, 'workspace');
  });

  // The office title used to be `hidden md:block`, so at THIS width it left the
  // accessibility tree entirely and the page had no h1 — the document's own
  // heading silently became the top level instead. Which element was the page
  // heading depended on the viewport, which is why this is asserted at phone
  // width specifically and not only in the accessibility suite's desktop run.
  test('the page still has its heading at phone width', async () => {
    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1'))
        // sr-only elements still have an offsetParent, so this counts the
        // heading that is present-but-invisible, which is the point.
        .filter((h) => (h as HTMLElement).offsetParent !== null)
        .map((h) => (h.textContent || '').trim().slice(0, 40)),
    );
    expect(headings.length, `expected exactly one h1, got ${JSON.stringify(headings)}`).toBe(1);
  });

  test('workspace shell has no unhittable controls', async () => {
    await expectNoSmallTapTargets(page, 'workspace');
  });

  test('nothing overhangs the flex parent that sizes it', async () => {
    const offenders = await measureFlexOverhang(page);
    const worst = offenders[0];
    expect(
      offenders,
      worst
        ? `${offenders.length} element(s) stick out of their flex parent; widest is ` +
          `<${worst.tag} class="${worst.cls}"> by ${worst.by}px`
        : '',
    ).toEqual([]);
  });

  test('nothing is silently clipped by an ancestor that cannot scroll', async () => {
    const offenders = await measureClippedContent(page);
    const worst = offenders[0];
    expect(
      offenders,
      worst
        ? `${offenders.length} element(s) are cut off; widest is <${worst.tag} class="${worst.cls}"> ` +
          `by ${worst.by}px inside ${worst.clipper}`
        : '',
    ).toEqual([]);
  });

  test('sidebar opens as a drawer and closes again', async () => {
    // At this width the sidebar has to be dismissable, or it covers the content
    // with no way back. The toggle is exposed at all widths — it used to be
    // desktop-hidden, which left no way to collapse it at all.
    const toggle = page.getByTestId('sidebar-toggle');
    await expect(toggle).toBeVisible({ timeout: 15_000 });

    // Below the mobile breakpoint the Sidebar renders as a Sheet, marked
    // data-mobile. Asserting on it rather than only on overflow means this test
    // fails if the drawer stops opening — and, more importantly, leaves the app
    // in a known state for whatever runs next in this serial suite. Toggling
    // twice and assuming it closed is what let an open drawer swallow the clicks
    // in the following test.
    const drawer = page.locator('[data-mobile="true"]');

    await toggle.click({ force: true });
    await expect(drawer).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, 'workspace/sidebar-open');

    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden({ timeout: 15_000 });
    await expectNoHorizontalOverflow(page, 'workspace/sidebar-closed');
  });

  test('settings modal fits the viewport', async () => {
    await pressAccountMenuItem(page, 'account-menu-settings');
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'settings');
    // Settings is dense with switches and icon buttons, which is where a
    // sub-24px control is most likely to hide.
    await expectNoSmallTapTargets(page, 'settings');

    await page.keyboard.press('Escape');
  });

  test('user directory fits the viewport', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/directory');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    await expect(page.getByRole('heading', { name: 'User Directory' })).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'directory');
    // Rows of per-user actions — the shape that produced the 16px controls
    // found on the pre-auth screens.
    await expectNoSmallTapTargets(page, 'directory');

    // Also here, not only on the shell: this is the surface that carried the
    // bug the check was written for. The search results sit in a ScrollArea
    // whose viewport child is `display: table`, which sizes to max-content —
    // so a long username grew the row past the viewport and the overflow was
    // clipped instead of truncated.
    const clipped = await measureClippedContent(page);
    const worst = clipped[0];
    expect(
      clipped,
      worst
        ? `${clipped.length} element(s) cut off in the directory; widest is ` +
          `<${worst.tag} class="${worst.cls}"> by ${worst.by}px inside ${worst.clipper}`
        : '',
    ).toEqual([]);
  });

  /**
   * Messages is master-detail below `md`: one pane at a time. Nothing guarded
   * that, even after it was fixed — a 288px conversation list beside a flex-1
   * detail left the detail 87px wide at 375px and broke its text mid-word.
   *
   * Asserted through the panes themselves rather than through overflow alone,
   * because the broken layout did NOT overflow: both columns fitted inside 375px
   * by squeezing the detail into a sliver, so an overflow scan called it fine.
   */
  test('messages shows one pane at a time on a phone', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/messages');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    const list = page.getByRole('heading', { name: 'Conversations' });
    await expect(list).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'messages');
    await expectNoSmallTapTargets(page, 'messages');

    // With nothing selected the list owns the screen, so the detail pane's
    // empty state must not be sharing it. This is the assertion that fails if
    // the master-detail conditional is dropped.
    await expect(
      page.getByRole('heading', { name: 'No conversation selected' }),
    ).toBeHidden();

    // And the list really is full-bleed, not a 288px column with the rest of
    // the width given to something invisible.
    const width = await page
      .locator('h2', { hasText: 'Conversations' })
      .evaluate((el) => {
        const pane = el.closest('div')?.parentElement;
        return pane ? pane.getBoundingClientRect().width : 0;
      });
    expect(width, 'the conversation list should span the phone viewport').toBeGreaterThan(300);
  });

  /**
   * The other half of the same rule. Hiding a pane at every width would pass
   * the phone test and quietly ship a desktop app that lost its detail view, so
   * the breakpoint is pinned from both sides.
   */
  test('messages shows both panes once there is room', async () => {
    await page.setViewportSize({ width: 1280, height: 800 });
    try {
      await page.evaluate(() => {
        window.history.pushState({}, '', '/messages');
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
      await expect(page.getByRole('heading', { name: 'Conversations' })).toBeVisible({
        timeout: 30_000,
      });
      await expect(
        page.getByRole('heading', { name: 'No conversation selected' }),
      ).toBeVisible({ timeout: 30_000 });
    } finally {
      // Restored even on failure: this suite is serial and everything after it
      // assumes a phone.
      await page.setViewportSize(PHONE);
    }
  });

  /**
   * A panel that opens over the app, sized from its content rather than from
   * the viewport — the shape that survives a desktop layout and pushes a phone
   * sideways. Notification rows carry a title, a body and a timestamp on one
   * line, which is exactly what stops fitting first.
   */
  test('notification centre fits the viewport', async () => {
    // By testid. `svg.lucide-bell` is an icon library's internal class name --
    // nothing promises to keep it, and when it goes this click lands nowhere,
    // the sheet never opens, and the 375px checks below never run.
    //
    // And NOT forced. These tests share one page, so by the time this one runs
    // the drawer, the settings modal and the user directory have each opened
    // and closed something. `force: true` skips exactly the check that would
    // say one of them is still on top: the click "succeeds" against an
    // overlay, the sheet never opens, and the assertion below waits its full
    // thirty seconds before saying only "element(s) not found". That is what
    // this test did -- failing on the first attempt and passing on the retry
    // in under a second, for two runs.
    //
    // Closing first is the fix; clicking honestly is what reports it if the
    // close was not enough, naming the element that intercepted the pointer.
    await closeAnyModals(page);
    await page.getByTestId('notification-bell').click();
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'notifications');
    await expectNoSmallTapTargets(page, 'notifications');

    // The panel is position:fixed, so the overflow scan above cannot see it
    // hanging off the screen. Measured against the viewport instead.
    const offscreen = await measureOffscreenPanels(page);
    const worst = offscreen[0];
    expect(
      offscreen,
      worst
        ? `${offscreen.length} fixed panel(s) sit outside the viewport; ` +
          `<${worst.tag} class="${worst.cls}"> spans ${worst.left}..${worst.right} in 375px`
        : '',
    ).toEqual([]);

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="dialog"]').first()).toBeHidden({ timeout: 15_000 });
  });

  /**
   * The file grid is the one surface built from fixed-width tiles, so it is the
   * most likely to lay out past a phone. Clipping matters as much as overflow
   * here: a grid inside a scroll container can cut a filename off entirely
   * rather than push the page, and nothing about that looks wrong until you
   * need the name.
   */
  test('file manager fits the viewport', async () => {
    await page.evaluate(() => {
      window.history.pushState({}, '', '/workspace?section=files');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    // `section=files` alone opens Server Storage, whose tree is always seeded
    // with the protected Sent Files folder: settled on that row, the scan sees
    // the file browser itself rather than whatever the shell showed first.
    await expect(page.getByTestId('vfs-item-Sent Files')).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'files');
    await expectNoSmallTapTargets(page, 'files');

    const clipped = await measureClippedContent(page);
    const worst = clipped[0];
    expect(
      clipped,
      worst
        ? `${clipped.length} element(s) cut off in the file manager; widest is ` +
          `<${worst.tag} class="${worst.cls}"> by ${worst.by}px inside ${worst.clipper}`
        : '',
    ).toEqual([]);
  });
});

/**
 * The theme editor is the densest thing in the app — a preview of the whole
 * workspace, a preset gallery and a colour wheel — and a colour wheel is a
 * fixed-size widget, exactly the sort that survives a desktop layout and pushes
 * a phone sideways.
 *
 * Its own session, for the same reason as the accessibility spec: only the
 * account that INITIALISES the workspace holds the `themes` permission, and the
 * block above deliberately registers a fresh user, who gets a correctly
 * read-only editor with no wheel in it to measure.
 */
test.describe.serial('Responsive theme editor at 375px', () => {
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(300_000);

    context = await browser.newContext({ viewport: PHONE });
    page = await context.newPage();

    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60_000 });
    await waitForAppReady(page, 60_000);

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

    // The workspace keeps streaming data in after it first renders, and a
    // re-render dismisses an open Radix dropdown, so opening the menu is
    // retried rather than clicked once and waited on.
    await pressAccountMenuItem(page, 'account-menu-settings');

    // Wait for the dialog, do not assume it. Clicking the tab straight after
    // the menu item raced the modal mounting: the click landed on nothing and
    // then waited out the whole hook timeout with no useful diagnosis.
    await expect(page.locator('[role="dialog"]').first()).toBeVisible({ timeout: 30_000 });
    // A settle, not a poll. Retrying the tab click instead re-clicks the avatar
    // path underneath and ends up dismissing the settings dialog entirely — the
    // run finished with no dialog at all. The dialog reports visible the moment
    // its open animation starts, and a click that lands before Radix has
    // mounted the panel activates nothing.
    await page.waitForTimeout(2_000);

    const openEditor = page.getByTestId('open-workspace-appearance');
    await page.getByRole('tab', { name: /^theme$/i }).click({ force: true });
    await expect(openEditor).toBeVisible({ timeout: 30_000 });

    // The settings modal scrolls its own body, and at this width the appearance
    // section sits below the fold, so the click needs it laid out on screen.
    await openEditor.scrollIntoViewIfNeeded();
    await openEditor.click();
    await expect(page.getByTestId('workspace-appearance-modal')).toBeVisible({ timeout: 30_000 });
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('the editor fits the viewport', async () => {
    await expectNoHorizontalOverflow(page, 'theme editor');
  });

  test('the colour wheel fits the viewport', async () => {
    // Only rendered once a part of the preview is selected, so the editor above
    // never measures it.
    await page.getByTestId('preview-region-sidebar').click({ force: true });
    await expect(page.getByTestId('color-wheel')).toBeVisible({ timeout: 30_000 });

    await expectNoHorizontalOverflow(page, 'theme editor — colour wheel');
  });

  test('save and cancel stay reachable', async () => {
    // A tall editor on a short screen can push its own actions off the bottom,
    // leaving no way to apply or abandon the edit — the modal becomes a trap.
    await expect(page.getByTestId('appearance-save')).toBeInViewport();
  });
});
