/**
 * Shared setup for the call specs.
 *
 * Not a spec — Playwright collects only `*.spec.ts`, so this file is imported,
 * never run. It lives here rather than in `lib/` because it asserts, and the
 * helpers in `lib/` deliberately return booleans instead of importing `expect`.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import { isCI } from '../lib/config.js';
import {
  acceptP2PRequest,
  openConversation,
  p2pRegister,
  sendAndVerifyMessage,
  waitForP2PChannelReady,
} from '../lib/index.js';

/** Structurally satisfied by each call spec's own session object. */
export interface PeerSession {
  page: Page;
  username: string;
}

/**
 * Register two peers and leave both directions genuinely warm.
 *
 * Order matters, and getting it wrong is subtle. Channel readiness is proven by
 * message RECEIPT, so waiting for it before either side can send is waiting for
 * something nothing will cause: the initiator gets its proof from the accept
 * traffic, and the acceptor, with nothing inbound, polls until it times out.
 * That was the recurring failure in the 1:1 call spec, and it surfaced two
 * tests later as "calling never became available" rather than at its cause.
 *
 * So: open both conversations first, then send a verified message each way.
 * The warmup both establishes the channel and IS the readiness proof, which
 * makes the explicit checks afterwards immediate rather than hopeful.
 */
export async function connectPair(
  initiator: PeerSession,
  acceptor: PeerSession,
): Promise<void> {
  await p2pRegister(initiator.page, initiator.username, acceptor.username);
  await acceptP2PRequest(acceptor.page, acceptor.username, null, initiator.username);

  // Both sides into the conversation, so warmup messages can be typed and seen.
  expect(await openConversation(initiator.page, initiator.username, acceptor.username)).toBe(true);
  expect(await openConversation(acceptor.page, acceptor.username, initiator.username)).toBe(true);

  const nonce = Date.now();
  expect(
    await sendAndVerifyMessage(
      initiator.page, initiator.username, acceptor.page, acceptor.username,
      `warmup ${initiator.username} to ${acceptor.username} @ ${nonce}`,
    ),
    `warmup ${initiator.username} -> ${acceptor.username} should be delivered`,
  ).toBe(true);
  expect(
    await sendAndVerifyMessage(
      acceptor.page, acceptor.username, initiator.page, initiator.username,
      `warmup ${acceptor.username} to ${initiator.username} @ ${nonce}`,
    ),
    `warmup ${acceptor.username} -> ${initiator.username} should be delivered`,
  ).toBe(true);

  expect(
    await waitForP2PChannelReady(initiator.page, initiator.username, acceptor.username, 30_000),
    `${initiator.username} -> ${acceptor.username} channel should be ready`,
  ).toBe(true);
  expect(
    await waitForP2PChannelReady(acceptor.page, acceptor.username, initiator.username, 30_000),
    `${acceptor.username} -> ${initiator.username} channel should be ready`,
  ).toBe(true);
}

/**
 * Chrome flags every call spec needs.
 *
 * Three copies of this list existed, in the 1:1 spec, the group spec and the
 * config -- and the screen-share flag was added to one of them, which is how a
 * list drifts. A synthetic camera and microphone, the permission prompt
 * auto-accepted, and a synthetic SCREEN: `getDisplayMedia` otherwise opens a
 * picker no headless browser can answer, and the promise never settles.
 */
export const CALL_LAUNCH_ARGS: string[] = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-ipc-flooding-protection',
  ...(isCI
    ? ['--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-extensions']
    : []),
];

/**
 * A live call, not merely a stage.
 *
 * `call-stage` is visible for a call that could NOT start: the same panel
 * renders an error, a Leave button and a clock frozen at 00:00. Three specs
 * used stage visibility as their setup assertion, so a call that never got a
 * UDP channel was indistinguishable from one that worked -- and the first
 * assertion to notice was a screen-share element thirty seconds later, whose
 * failure said nothing about the call.
 *
 * The clock only runs while the call is 'active', so it is what tells the two
 * apart. The error text is folded into the polled value so a failure names the
 * cause rather than a missing element.
 */
export async function expectCallLive(page: Page, timeout: number = 60_000): Promise<void> {
  await expect
    .poll(
      async (): Promise<string> => {
        const failure: Locator = page.getByTestId('call-error');
        if ((await failure.count()) > 0) {
          // The RAW transport text, not what is on screen. What is on screen is
          // now written for a user — "try the call again in a moment" — and a
          // failure report needs the sentence the service actually produced.
          const raw: string | null = await failure.first().getAttribute('data-raw-reason');
          const shown: string = (await failure.innerText()).replace(/\s+/g, ' ').trim();
          return `call failed: ${raw && raw.length > 0 ? raw : shown}`;
        }
        const clock: string = ((await page.getByTestId('call-duration').textContent()) ?? '').trim();
        if (clock !== '' && clock !== '00:00') return 'running';

        // Name the STATE, not only the symptom.
        //
        // "clock at 00:00" is true of a call that is ringing, one that is
        // connecting, and one whose stage is not on screen at all — three
        // different failures that took a run each to tell apart. The stage's
        // own aria-label says which: "Outgoing call, ringing", "Call
        // connecting", "Call in progress".
        const stage: Locator = page.getByTestId('call-stage');
        if ((await stage.count()) === 0) return `clock at ${clock || '(absent)'}, no stage`;
        const state: string | null = await stage.first().getAttribute('aria-label');

        // And for how long. `Call connecting` is true of a call whose 30s
        // connect deadline never armed AND of one that keeps re-entering the
        // status, restarting it -- two different faults that cost a CI run
        // each to tell apart, because the label is the same either way.
        const since: string | null = await stage.first().getAttribute('data-status-since');
        const heldFor: string =
          since === null ? 'unknown' : `${Math.round((Date.now() - Number(since)) / 1000)}s`;
        return `clock at ${clock || '(absent)'}, stage says ${state ?? '(unlabelled)'} for ${heldFor}`;
      },
      { timeout, message: 'the call clock never started, so the call never became active' },
    )
    .toBe('running');
}
