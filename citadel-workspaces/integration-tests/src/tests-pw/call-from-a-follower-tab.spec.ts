/**
 * Calling from a tab that does not hold the browser's WebSocket.
 *
 * One browser has one socket to the agent, owned by the elected leader tab.
 * The call lives in the tab whose session is in it; only the encoded frames
 * and the media-session requests cross to the leader (media-frame-relay.ts),
 * and inbound frames come back by cid. Unit tests pin each hop; only two live
 * tabs in one browser can prove the whole path, so this spec does.
 *
 * Layout: browser A holds alice. Browser B holds carol in its FIRST tab (the
 * leader) and bob in its SECOND tab (a follower). Every call below is bob's.
 *
 * Not run by the lane that wrote it: it needs the shared backend.
 */
import { test, expect } from '@playwright/test';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import { clearBrowserStorage, waitForAppReady, createAccount, waitForWorkspaceLoaded, closeAnyModals, isHeaded } from '../lib/index.js';
import { config } from '../lib/config.js';
import { connectPair, expectCallLive, CALL_LAUNCH_ARGS, type PeerSession } from './call-helpers.js';

const stamp: number = Date.now();
const PASSWORD: string = 'test12345';

let browserA: Browser;
let browserB: Browser;
let alice: PeerSession;
let carol: PeerSession;
let bob: PeerSession;

async function signUp(context: BrowserContext, username: string, isFirst: boolean, clear: boolean): Promise<PeerSession> {
  const page: Page = await context.newPage();
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  if (clear) await clearBrowserStorage(page);
  await waitForAppReady(page, 60_000);
  expect(await createAccount(page, username, { isFirstUser: isFirst, password: PASSWORD, uxTracker: null })).toBeTruthy();
  expect(await waitForWorkspaceLoaded(page, 30_000)).toBe(true);
  await closeAnyModals(page);
  return { page, username };
}

async function newBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const browser: Browser = await chromium.launch({ headless: !isHeaded, args: CALL_LAUNCH_ARGS });
  const context: BrowserContext = await browser.newContext({ permissions: ['camera', 'microphone'] });
  return { browser, context };
}

/** Whether the page's tab is the one holding the socket, read from the app itself. */
async function isLeader(page: Page): Promise<boolean> {
  // The dev server serves the app's modules by path, and this is the same
  // singleton the page runs on; held in a variable so tsc does not resolve it.
  return page.evaluate(async (path: string): Promise<boolean> => {
    const mod: { instanceManager: { isLeader: boolean } } = await import(/* @vite-ignore */ path);
    return mod.instanceManager.isLeader;
  }, '/src/lib/multi-instance/index.ts');
}

/** A remote tile's video clock, which only advances while frames arrive. */
async function remoteVideoTime(page: Page): Promise<number> {
  return page.evaluate((): number => {
    const tiles: Element[] = Array.from(document.querySelectorAll('[data-testid^="participant-tile-"]'))
      .filter((t: Element): boolean => t.getAttribute('data-testid') !== 'participant-tile-self');
    const video: HTMLVideoElement | null = (tiles[0]?.querySelector('video') ?? null) as HTMLVideoElement | null;
    return video ? video.currentTime : -1;
  });
}

async function expectFramesFlowing(page: Page): Promise<void> {
  const before: number = await remoteVideoTime(page);
  await expect.poll(() => remoteVideoTime(page), { timeout: 30_000 }).toBeGreaterThan(before);
}

test.describe.serial('a call from a follower tab', () => {
  test.beforeAll(async () => {
    test.setTimeout(300_000);
    const a: { browser: Browser; context: BrowserContext } = await newBrowser();
    const b: { browser: Browser; context: BrowserContext } = await newBrowser();
    browserA = a.browser;
    browserB = b.browser;
    alice = await signUp(a.context, `pw_fcall_alice_${stamp}`, true, true);
    carol = await signUp(b.context, `pw_fcall_carol_${stamp}`, false, true);
    // Same browser, second tab: it must NOT clear storage, or it would sign carol out.
    bob = await signUp(b.context, `pw_fcall_bob_${stamp}`, false, false);
    expect(await isLeader(carol.page), 'the first tab leads').toBe(true);
    expect(await isLeader(bob.page), 'bob is in a follower tab').toBe(false);
    await connectPair(alice, bob);
  });

  test.afterAll(async () => {
    await browserA?.close();
    await browserB?.close();
  });

  test('the follower offers calling', async () => {
    await expect(bob.page.getByTestId('call-start-video')).toBeVisible({ timeout: 120_000 });
  });

  test("an incoming call rings in bob's tab, and only there", async () => {
    await alice.page.getByTestId('call-start-video').click();
    await expect(bob.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });
    await expect(carol.page.getByTestId('incoming-call-card')).toHaveCount(0);
    await bob.page.getByTestId('incoming-call-accept').click();
    await expectCallLive(alice.page);
    await expectCallLive(bob.page);
    // Both directions: bob's frames leave through carol's socket, alice's arrive by cid.
    await expectFramesFlowing(alice.page);
    await expectFramesFlowing(bob.page);
    // The leader relays; it renders no call of its own.
    await expect(carol.page.getByTestId('call-stage')).toHaveCount(0);
    await bob.page.getByTestId('call-leave').click();
    await expect(alice.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 30_000 });
  });

  test('a call placed from the follower connects with media both ways', async () => {
    await bob.page.getByTestId('call-start-video').click();
    await expect(alice.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });
    await alice.page.getByTestId('incoming-call-accept').click();
    await expectCallLive(bob.page);
    await expectFramesFlowing(alice.page);
    await expectFramesFlowing(bob.page);
  });

  test('the call survives the leader tab closing', async () => {
    await carol.page.close();
    await expect.poll(() => isLeader(bob.page), { timeout: 30_000 }).toBe(true);
    // The media sessions are re-opened on bob's new socket once it claims the session.
    await expectFramesFlowing(alice.page);
    await expectFramesFlowing(bob.page);
  });

  test("closing the call's tab ends the call for the peer", async () => {
    test.setTimeout(300_000);
    await bob.page.getByTestId('call-leave').click();
    await expect(alice.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 30_000 });
    // bob leads now, so a fresh follower tab in his browser carries the next call.
    const dave: PeerSession = await signUp(bob.page.context(), `pw_fcall_dave_${stamp}`, false, false);
    expect(await isLeader(dave.page)).toBe(false);
    await connectPair(alice, dave);
    await dave.page.getByTestId('call-start-audio').click();
    await expect(alice.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });
    // Accept, not "Answer without video": that is offered only on a video call
    // (IncomingCallCard; call-ui.test.tsx pins its absence on an audio one), and
    // waiting for it on this audio call spent the whole test timeout.
    await alice.page.getByTestId('incoming-call-accept').click();
    await expectCallLive(alice.page);
    await dave.page.close();
    // Well inside the heartbeat timeout: the end is said by the leader, not inferred from silence.
    await expect(alice.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 10_000 });
  });
});
