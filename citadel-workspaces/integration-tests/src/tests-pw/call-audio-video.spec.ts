/**
 * Proof that audio and video actually work.
 *
 * The load-bearing assertion is the LAST one in each direction: that a remote
 * participant's <video> element reports a non-zero videoWidth. Nothing else in
 * this file would fail if media never left the machine — a call surface can
 * render, a timer can tick and both sides can agree they are "in a call" while
 * not one frame has crossed the network.
 *
 * A non-zero videoWidth means a frame was captured, encoded by WebCodecs,
 * fragmented, carried over the peer's UDP channel through the internal service,
 * reassembled, decoded and painted. That is the whole path.
 *
 * Chromium's fake capture device supplies a moving pattern, so no camera is
 * needed and no permission prompt appears — without both, this test would
 * require hardware CI does not have and would block on a dialog before
 * asserting anything.
 */

import { test, expect } from '@playwright/test';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import {
  clearBrowserStorage,
  waitForAppReady,
  createAccount,
  waitForWorkspaceLoaded,
  closeAnyModals, isHeaded,} from '../lib/index.js';
import { config } from '../lib/config.js';
import { connectPair, expectCallLive, CALL_LAUNCH_ARGS } from './call-helpers.js';

interface UserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  username: string;
}

const stamp = Date.now();
const USERS = {
  a: { username: `pw_call_a_${stamp}`, password: 'test12345' },
  b: { username: `pw_call_b_${stamp}`, password: 'test12345' },
};


let sessionA: UserSession;
let sessionB: UserSession;

async function createSession(label: 'a' | 'b', isFirst: boolean): Promise<UserSession> {
  const browser = await chromium.launch({ headless: !isHeaded, slowMo: isHeaded ? 50 : 0, args: CALL_LAUNCH_ARGS });
  const context = await browser.newContext({
    storageState: undefined,
    permissions: ['camera', 'microphone'],
  });
  await context.clearCookies();
  const page = await context.newPage();

  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await clearBrowserStorage(page);
  await waitForAppReady(page, 60_000);

  const user = USERS[label];
  const registered = await createAccount(page, user.username, {
    isFirstUser: isFirst,
    password: user.password,
    uxTracker: null,
  });
  if (!registered) {
    await browser.close();
    throw new Error(`Failed to register ${label}: ${user.username}`);
  }

  expect(await waitForWorkspaceLoaded(page, 30_000), 'the workspace should finish loading').toBe(true);
  await closeAnyModals(page);

  return { browser, context, page, username: user.username };
}

/**
 * Wait until a remote tile is painting real pixels.
 *
 * videoWidth stays 0 until the first frame has actually decoded, which is
 * precisely the difference between "the element exists" and "media is flowing".
 */
async function waitForRemoteVideo(page: Page, timeoutMs = 60_000): Promise<number> {
  const handle = await page.waitForFunction(
    () => {
      // The self tile is rendered with cid -1 and carries the LOCAL camera, so
      // it always has a non-zero videoWidth. Matching every participant tile
      // made this assertion pass without a single frame crossing the network —
      // a proof of nothing. Only a remote tile can demonstrate transport.
      const tiles = Array.from(
        document.querySelectorAll('[data-testid^="participant-tile-"]'),
      ).filter((t) => t.getAttribute('data-testid') !== 'participant-tile-self');
      for (const tile of tiles) {
        const video = tile.querySelector('video') as HTMLVideoElement | null;
        if (video && video.videoWidth > 0) return video.videoWidth;
      }
      return null;
    },
    undefined,
    { timeout: timeoutMs },
  );
  return (await handle.jsonValue()) as number;
}

test.describe.serial('Audio and video calling', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    sessionA = await createSession('a', true);
    sessionB = await createSession('b', false);
  });

  test.afterAll(async () => {
    await sessionA?.browser.close();
    await sessionB?.browser.close();
  });

  test('the two peers connect', async () => {
    test.setTimeout(300_000);
    // Shared with the group spec. This used to inline a different order —
    // wait for readiness, THEN open the conversations — and readiness is proven
    // by receipt, so B sat polling for a message that nothing would send. It
    // then passed anyway, because these four calls returned booleans nobody
    // checked, and the run failed in the NEXT test as "calling never became
    // available". Both halves of that are fixed in connectPair.
    await connectPair(sessionA, sessionB);
  });

  test('the call buttons are offered once a peer is connected', async () => {
    test.setTimeout(180_000);

    // Wait for the ENABLED state specifically, retrying, rather than for
    // "either state". The header legitimately flips between the two while the
    // peer connection settles, so a single sample of "either" can catch the
    // disabled render and then find neither by the time the next assertion
    // runs — which is a race in the test, not a fact about the product.
    const available = sessionA.page.getByTestId('call-start-audio');
    const unavailable = sessionA.page.getByTestId('call-unavailable');

    await expect(async () => {
      await expect(available).toBeVisible({ timeout: 5_000 });
    })
      .toPass({ timeout: 120_000 })
      .catch(async () => {
        // Never became available: report WHY, from the disabled control's own
        // tooltip, instead of a bare timeout.
        //
        // The tooltip is a Radix one, mounted only while hovered — it is NOT a
        // native `title`. Reading the attribute returned null every time, which
        // turned each of these failures into an unfalsifiable "something went
        // wrong" and is why they went undiagnosed for so long. Hover, then read
        // what the user would actually be shown.
        let reason = 'neither the enabled nor the disabled call buttons ever rendered';
        if (await unavailable.count()) {
          // Hover the WRAPPER, not the button inside it. DisabledWithTooltip
          // sets `[&_*]:pointer-events-none`, so every descendant swallows the
          // hover and the tooltip never opens — which is why this reported
          // "the tooltip never opened" instead of the reason it exists to fetch.
          await unavailable.locator('[aria-disabled="true"]').first().hover().catch(() => {});
          const tip = sessionA.page.getByRole('tooltip').first();
          reason =
            (await tip.textContent({ timeout: 5_000 }).catch(() => null)) ??
            'the disabled call buttons rendered, but their tooltip never opened';
        }
        // Best effort only. This ran unguarded once and threw "Target page has
        // been closed", replacing the diagnostic it exists to support with an
        // error about the diagnostic itself.
        await sessionA.page
          .screenshot({ path: 'test-results/call-unavailable-A.png' })
          .catch(() => {});
        throw new Error(`calling never became available to A: ${reason.trim()}`);
      });

    await expect(sessionA.page.getByTestId('call-start-video')).toBeVisible();
  });

  test('calling rings the other side', async () => {
    test.setTimeout(180_000);
    await sessionA.page.getByTestId('call-start-video').click();

    // The caller sees a ringing state rather than an empty call surface.
    await expect(sessionA.page.getByTestId('call-stage')).toBeVisible({ timeout: 30_000 });

    // And the callee is rung wherever they are in the app.
    await expect(sessionB.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });

    // By testid, not by text. The card renders these words twice on purpose --
    // once visibly and once in an assertive live region for a screen reader --
    // so `getByText(/incoming video call/i)` resolves to two elements and fails
    // strict mode. That is the assertion being ambiguous, not the UI.
    await expect(sessionB.page.getByTestId('incoming-call-kind')).toHaveText(/incoming video call/i);

    // The announcement is the accessibility affordance and is checked on its
    // own terms: it is populated in an effect, because a live region that
    // mounts with its text already present is frequently never announced.
    await expect(sessionB.page.getByTestId('incoming-call-announcement')).toHaveText(
      /incoming video call/i,
    );
  });

  test('accepting puts both sides in the call', async () => {
    test.setTimeout(180_000);
    await sessionB.page.getByTestId('incoming-call-accept').click();

    await expect(sessionB.page.getByTestId('call-stage')).toBeVisible({ timeout: 60_000 });
    await expect(sessionB.page.getByTestId('incoming-call-card')).toHaveCount(0);
    await expect(sessionA.page.getByTestId('call-controls')).toBeVisible({ timeout: 60_000 });

    // "In the call" is the clock running, not the stage rendering: a call that
    // could not get a UDP channel renders the same stage. See expectCallLive.
    await expectCallLive(sessionA.page);
    await expectCallLive(sessionB.page);
  });

  test('video actually flows from A to B', async () => {
    // The assertion this whole file exists for. See the header: a non-zero
    // videoWidth is the only thing here that could not pass if media never
    // left the machine.
    test.setTimeout(180_000);
    const width = await waitForRemoteVideo(sessionB.page);

    expect(width, 'B should be decoding real frames from A').toBeGreaterThan(0);
  });

  test('video actually flows from B to A', async () => {
    test.setTimeout(180_000);
    const width = await waitForRemoteVideo(sessionA.page);

    expect(width, 'A should be decoding real frames from B').toBeGreaterThan(0);
  });

  test('muting is announced to the other side, not merely local', async () => {
    // A mute that only stops the local track leaves the far side unable to tell
    // a muted peer from a crashed one.
    test.setTimeout(120_000);
    await sessionA.page.getByTestId('call-toggle-mic').click();

    // The STATE, on the control, by testid.
    //
    // This looked for a button named "unmute microphone", and no such name
    // exists: the label deliberately does not flip with the state. A label that
    // flipped alongside `aria-pressed` announced "Mute microphone, pressed" on a
    // live mic, which a listener reads as muted -- the worst direction to be
    // wrong in on a privacy control. So the name stays put and `aria-pressed`
    // carries the state, which is what this now reads.
    await expect(sessionA.page.getByTestId('call-toggle-mic')).toHaveAttribute('aria-pressed', 'false');
    await expect(sessionB.page.getByText('muted')).toBeVisible({ timeout: 30_000 });
  });

  test('leaving ends the call on both sides', async () => {
    test.setTimeout(120_000);
    await sessionA.page.getByTestId('call-leave').click();

    await expect(sessionA.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 30_000 });
    // The far side must not be left sitting in a call that is over.
    await expect(sessionB.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 60_000 });
  });
});
