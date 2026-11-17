/**
 * Sharing a screen, and drawing on it.
 *
 * The wire and the fade arithmetic are covered by unit tests; what needs two
 * real browsers is the part that only exists between them: that a share
 * announced by one is decoded and shown by the other, that stopping it takes the
 * stage down on both sides, and that a stroke drawn on one appears on the other.
 *
 * `--auto-select-desktop-capture-source` in playwright.config.ts is what makes
 * this runnable at all: `getDisplayMedia` otherwise opens a picker that a
 * headless browser cannot answer, and the promise simply never settles.
 */
import { test, expect, chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { connectPair, expectCallLive, CALL_LAUNCH_ARGS } from './call-helpers.js';
import { config, isHeaded } from '../lib/config.js';
import { clearBrowserStorage, waitForAppReady } from '../lib/browser.js';
import { createAccount } from '../lib/account.js';

interface UserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  username: string;
}

const stamp: number = Date.now();
const USERS: Record<'a' | 'b', { username: string; password: string }> = {
  a: { username: `pw_share_a_${stamp}`, password: 'test12345' },
  b: { username: `pw_share_b_${stamp}`, password: 'test12345' },
};

async function createSession(label: 'a' | 'b', isFirst: boolean): Promise<UserSession> {
  const browser: Browser = await chromium.launch({
    headless: !isHeaded,
    slowMo: isHeaded ? 50 : 0,
    args: CALL_LAUNCH_ARGS,
  });
  const context: BrowserContext = await browser.newContext({
    storageState: undefined,
    permissions: ['camera', 'microphone'],
  });
  await context.clearCookies();
  const page: Page = await context.newPage();

  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await clearBrowserStorage(page);
  await waitForAppReady(page, 60_000);

  const user = USERS[label];
  const registered: boolean = await createAccount(page, user.username, {
    isFirstUser: isFirst,
    password: user.password,
    uxTracker: null,
  });
  if (!registered) {
    await browser.close();
    throw new Error(`Failed to register ${label}: ${user.username}`);
  }
  return { browser, context, page, username: user.username };
}

test.describe.serial('Screen sharing', () => {
  let sessionA: UserSession;
  let sessionB: UserSession;

  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sessionA = await createSession('a', true);
    sessionB = await createSession('b', false);
    await connectPair(sessionA, sessionB);

    // Into a call, the same way the 1:1 spec does it: video from A, accepted by
    // B. A screen share only exists inside a call, so this is setup rather than
    // anything under test here.
    await expect(sessionA.page.getByTestId('call-start-video')).toBeVisible({ timeout: 120_000 });
    await sessionA.page.getByTestId('call-start-video').click();
    await expect(sessionA.page.getByTestId('call-stage')).toBeVisible({ timeout: 30_000 });
    await sessionB.page.getByTestId('incoming-call-accept').click({ timeout: 60_000 });
    await expect(sessionB.page.getByTestId('call-stage')).toBeVisible({ timeout: 60_000 });
    // Both clocks running. A stage alone proves nothing — see expectCallLive.
    await expectCallLive(sessionA.page);
    await expectCallLive(sessionB.page);
  });

  test.afterAll(async () => {
    await sessionA?.browser.close();
    await sessionB?.browser.close();
  });

  test('a shared screen reaches the other side', async () => {
    test.setTimeout(120_000);

    await sessionA.page.getByTestId('call-toggle-screen').click();

    // The sharer sees their own share, so they know what the room is looking at.
    await expect(sessionA.page.getByTestId('call-screen-share')).toBeVisible({ timeout: 30_000 });
    // And the far side sees it, which is the only assertion that proves the
    // track crossed: B has no local screen to fall back on.
    await expect(sessionB.page.getByTestId('call-screen-share')).toBeVisible({ timeout: 60_000 });

    // Decoding, not merely present. A <video> with no frames reports zero
    // dimensions, so this distinguishes a stage that opened from a stage that
    // is showing something.
    await expect
      .poll(
        async () =>
          sessionB.page
            .locator('[data-testid="call-screen-share"] video')
            .evaluate((element: HTMLVideoElement) => element.videoWidth),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
  });

  test('a drawn stroke appears on the other side', async () => {
    test.setTimeout(120_000);

    const canvas = sessionB.page.getByTestId('call-annotations');
    await expect(canvas).toBeVisible();

    // Drawn on B, the viewer -- annotation is not a privilege of the sharer.
    const box = await canvas.boundingBox();
    expect(box, 'the annotation layer must have a size to draw on').not.toBeNull();
    if (!box) return;

    await sessionB.page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4);
    await sessionB.page.mouse.down();
    await sessionB.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.6, { steps: 8 });
    await sessionB.page.mouse.up();

    // Asserted by PIXELS on the sharer's canvas, not by any state the app
    // exposes: the question is whether the stroke was drawn where the other
    // person drew it, and only the canvas can answer that.
    await expect
      .poll(
        async () =>
          sessionA.page
            .locator('[data-testid="call-annotations"]')
            .evaluate((element: HTMLCanvasElement) => {
              const context = element.getContext('2d');
              if (!context) return 0;
              const { data } = context.getImageData(0, 0, element.width, element.height);
              let painted = 0;
              for (let index = 3; index < data.length; index += 4) {
                if (data[index] > 0) painted += 1;
              }
              return painted;
            }),
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
  });

  test('the stroke fades away on its own', async () => {
    test.setTimeout(120_000);

    // Five seconds plus the fade, and nothing left. A mark that stays is
    // clutter over the very thing it was pointing at.
    await expect
      .poll(
        async () =>
          sessionA.page
            .locator('[data-testid="call-annotations"]')
            .evaluate((element: HTMLCanvasElement) => {
              const context = element.getContext('2d');
              if (!context) return 0;
              const { data } = context.getImageData(0, 0, element.width, element.height);
              let painted = 0;
              for (let index = 3; index < data.length; index += 4) {
                if (data[index] > 0) painted += 1;
              }
              return painted;
            }),
        { timeout: 20_000, intervals: [500] },
      )
      .toBe(0);
  });

  test('stopping the share takes the stage down on both sides', async () => {
    test.setTimeout(120_000);

    await sessionA.page.getByTestId('call-toggle-screen').click();

    await expect(sessionA.page.getByTestId('call-screen-share')).toHaveCount(0, { timeout: 30_000 });
    // The far side too: a stage left open on a frozen last frame is worse than
    // no share at all, because it looks live.
    await expect(sessionB.page.getByTestId('call-screen-share')).toHaveCount(0, { timeout: 60_000 });
  });
});
