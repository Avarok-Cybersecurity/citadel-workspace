/**
 * Multi-window sessions: one account in several windows (agent 0.8.6, mw5).
 *
 * A1 and A2 are two browser CONTEXTS signed in as A -- separate storage, so
 * separate WebSockets and two agent connections attached to one session. B is a
 * third context. A1b is a second TAB in A1's context: the same-browser case.
 *
 *   1. A and B are created and P2P-registered (existing helpers).
 *   2. A1 is signed in as A.
 *   3. A2 opens A with "Open here too" and A's password. Both show A; A1 is not displaced.
 *   4. B -> A: shown exactly once in A1 AND A2.
 *   5. A replies from A2: B receives it, and A1 shows it from the agent's store event.
 *   6. A2 closes. A1 still receives from B.
 *   7. A2 reopens and rejoins with its sealed token, without a prompt; A1b opens A
 *      as a second tab. B -> A reaches A1, A1b and A2, once each.
 *   8. A1 signs out. A2 is told, leaves for the landing page saying why, and A
 *      is gone from the agent for every window.
 *
 * NEGATIVE CONTROLS (by reasoning; this suite is run by CI, not here):
 *
 *  NC1 fan-out (steps 4, 6, 7). Delivery is a bubble counted inside A2's chat,
 *      after a presence wait. If the agent delivered session notifications to
 *      one connection only (mw1's fan-out absent), A2's count stays 0, the
 *      presence wait times out, and the step is red. The locator is the same
 *      one that finds the bubble in B's own window in the same call, so a
 *      selector that can never match would fail there too, not pass here.
 *  NC2 exactly once (steps 4, 5, 7). The count is sampled for six seconds after
 *      arrival and judged on its maximum. A window that rendered both its own
 *      optimistic bubble and the store's Appended event for the reply in step
 *      5, or a notification delivered twice, reaches 2 and is red.
 *  NC3 the silent rejoin (step 7). "No prompt" is not an absence sample: a
 *      MutationObserver reports every prompt the instant it enters the DOM,
 *      and step 3 asserts that the same observer, in the same context, on the
 *      same chip click, DID record both the question and the password form.
 *      Without a remembered token claim-session.ts answers
 *      held-by-another-connection and offers the same question, so the count
 *      would be 1 and the step red -- and the workspace would never open, so
 *      the positive check fails as well.
 *  NC4 A1 not displaced (steps 3-4). If "Open here too" moved the session
 *      instead of joining it, A1 would be Detached and stop receiving: step 4's
 *      A1 delivery fails. That delivery, not the absence of a notice, is the
 *      load-bearing check.
 *  NC5 logout ends it for all (step 8). A2 must receive a DisconnectNotification
 *      for A's cid with no request_id, captured from its WebSocket. If logout
 *      only detached A1, no frame arrives, and A stays listed by the agent, so
 *      the second check -- A's chip absent from a freshly loaded strip in which
 *      B's chip IS present -- is red too.
 *
 *      And the screen: A2 leaves for the landing page and says "<A> was signed
 *      out in another window." (SessionEndedWatcher). Without it A2 keeps the
 *      dead workspace, no sign-in button appears and no toast, and the step is
 *      red.
 */
import type { Page, WebSocket } from 'playwright';
import { TestHarness, runTestMain, config, sleep, pollUntil, isVisibleWithin, takeScreenshot, setupConsoleCapture, openConversation, sendMessage, disconnectViaTopBar } from '../lib/index.js';
import { openMultiWindowWorld, makePeers, MULTI_WINDOW_CAPTURE, type MultiWindowWorld, type PeersReady } from '../lib/multi-window-setup.js';
import { everyWindowShowsOnce, landingListsSession, openHereTooWithPassword, pressSessionChip, sealedJoinTokens, showsWorkspaceOf, type SessionPrompt } from '../lib/multi-window.js';

const stamp: number = Date.now();
const A: string = `mw_a_${stamp}`;
const B: string = `mw_b_${stamp}`;
// Created by this spec, with these credentials; nothing else knows them.
const PASSWORD: string = config.DEFAULT_PASSWORD;
const ARRIVE_MS: number = 45_000;
const SETTLE_MS: number = 6_000;
const say = (step: string): void => console.log(`\n${'─'.repeat(50)}\n${step}\n${'─'.repeat(50)}`);
const text = (what: string): string => `mw ${what} ${stamp}`;

interface Results {
  peers: PeersReady;
  joinedHereToo: boolean; joinWasAsked: boolean; tokenSealed: boolean; bothShowA: boolean; a1NotDisplaced: boolean;
  bToBothWindows: boolean; replyFromA2: boolean;
  a1AfterA2Closed: boolean;
  silentRejoin: boolean; sameBrowserTab: boolean; toThreeWindows: boolean;
  a2ToldOfLogout: boolean; a2LeftForLanding: boolean; sessionEndedForAll: boolean;
}

function noPrompts(seen: Readonly<Record<SessionPrompt, number>>): boolean {
  return seen['open-here-too'] === 0 && seen['takeover-question'] === 0 && seen['held-elsewhere'] === 0;
}

/** Session-ending notifications a window's socket receives: no request_id (nobody in this window asked) and no peer_cid (it is the session, not a peer). */
function recordSessionEnds(page: Page): string[] {
  const cids: string[] = [];
  page.on('websocket', (ws: WebSocket) => {
    ws.on('framereceived', ({ payload }: { payload: string | Buffer }) => {
      const raw: string = typeof payload === 'string' ? payload : payload.toString('utf8');
      const notice: RegExpExecArray | null = /"DisconnectNotification":\{([^}]*)\}/.exec(raw);
      if (!notice || !/"request_id":null/.test(notice[1]) || !/"peer_cid":null/.test(notice[1])) return;
      // The cid by regex: JSON.parse would round a u64 to the nearest double.
      const cid: string | undefined = /"cid":(\d+)/.exec(notice[1])?.[1];
      if (cid) { cids.push(cid); console.log(`  [A/window 2] told the session ${cid} ended`); }
    });
  });
  return cids;
}

async function openWindow(world: MultiWindowWorld, which: 'a1' | 'a2', label: string): Promise<Page> {
  const page: Page = await (which === 'a1' ? world.a1Context : world.a2Context).newPage();
  setupConsoleCapture(page, label, [...MULTI_WINDOW_CAPTURE]);
  return page;
}

async function runTest(): Promise<boolean> {
  const harness: TestHarness = await TestHarness.create({
    testName: 'Multi-Window Sessions Test', reportFileName: 'MULTI_WINDOW_TEST_REPORT.json',
    metadata: { a: A, b: B }, restartBackend: true,
  });
  const world: MultiWindowWorld = await openMultiWindowWorld();
  const { a1, b } = world;
  const r: Results = {
    peers: { accounts: false, registered: false, conversations: false, talking: false },
    joinedHereToo: false, joinWasAsked: false, tokenSealed: false, bothShowA: false, a1NotDisplaced: false,
    bToBothWindows: false, replyFromA2: false, a1AfterA2Closed: false,
    silentRejoin: false, sameBrowserTab: false, toThreeWindows: false,
    a2ToldOfLogout: false, a2LeftForLanding: false, sessionEndedForAll: false,
  };
  try {
    say('STEPS 1-2: A (window 1) and B, P2P-registered and talking');
    r.peers = await makePeers(world, A, B, harness.uxTracker);
    if (!Object.values(r.peers).every(Boolean)) throw new Error(`setup did not complete: ${JSON.stringify(r.peers)}`);

    say('STEP 3: window 2 opens A with "Open here too"');
    const a2: Page = await openWindow(world, 'a2', 'A/window 2');
    r.joinedHereToo = await openHereTooWithPassword(a2, A, PASSWORD);
    const asked: Readonly<Record<SessionPrompt, number>> = world.a2Prompts.seen();
    // Proves the observer sees both prompts (NC3), and that no token let this first join skip them.
    r.joinWasAsked = asked['takeover-question'] >= 1 && asked['open-here-too'] >= 1;
    const tokens: { count: number; allSealed: boolean; cids: string[] } = await sealedJoinTokens(a2);
    r.tokenSealed = tokens.count === 1 && tokens.allSealed;
    r.bothShowA = r.joinedHereToo && (await showsWorkspaceOf(a1, A, 15_000));
    r.a1NotDisplaced = r.bothShowA && noPrompts(world.a1Prompts.seen());
    if (!r.joinedHereToo) throw new Error('window 2 could not open A here too');
    const aCid: string = tokens.cids[0] ?? '';
    await openConversation(a2, A, B, harness.uxTracker);

    say('STEP 4: B -> A reaches both of A\'s windows, once each');
    const m4: string = text('from B to both windows');
    r.bToBothWindows = (await sendMessage(b, B, m4)) && (await everyWindowShowsOnce(
      [{ page: a1, label: 'A/window 1' }, { page: a2, label: 'A/window 2' }, { page: b, label: 'B (sender)' }], m4, ARRIVE_MS, SETTLE_MS));

    say('STEP 5: A replies from window 2; B and window 1 both show it');
    const m5: string = text('reply from A window 2');
    r.replyFromA2 = (await sendMessage(a2, A, m5)) && (await everyWindowShowsOnce(
      [{ page: b, label: 'B' }, { page: a1, label: 'A/window 1 (store event)' }, { page: a2, label: 'A/window 2 (sender)' }], m5, ARRIVE_MS, SETTLE_MS));

    say('STEP 6: window 2 closes; window 1 still receives');
    // Every page of the context closes, so its socket and agent connection go.
    // The context object is kept only as this browser's disk: its IndexedDB holds the sealed token.
    await a2.close();
    const m6: string = text('after window 2 closed');
    r.a1AfterA2Closed = (await sendMessage(b, B, m6)) && (await everyWindowShowsOnce([{ page: a1, label: 'A/window 1' }], m6, ARRIVE_MS, SETTLE_MS))
      && noPrompts(world.a1Prompts.seen());

    say('STEP 7: window 2 reopens and rejoins silently; a second tab opens A in window 1\'s browser');
    world.a2Prompts.reset();
    const a2again: Page = await openWindow(world, 'a2', 'A/window 2 reopened');
    const sessionEnds: string[] = recordSessionEnds(a2again);
    r.silentRejoin = (await pressSessionChip(a2again, A)) && (await showsWorkspaceOf(a2again, A, 60_000)) && noPrompts(world.a2Prompts.seen());
    const a1b: Page = await openWindow(world, 'a1', 'A/window 1 tab 2');
    r.sameBrowserTab = (await pressSessionChip(a1b, A)) && (await showsWorkspaceOf(a1b, A, 60_000)) && noPrompts(world.a1Prompts.seen());
    await openConversation(a2again, A, B, harness.uxTracker);
    await openConversation(a1b, A, B, harness.uxTracker);
    const m7: string = text('to three windows');
    r.toThreeWindows = (await sendMessage(b, B, m7)) && (await everyWindowShowsOnce(
      [{ page: a1, label: 'A/window 1' }, { page: a1b, label: 'A/window 1 tab 2' }, { page: a2again, label: 'A/window 2 reopened' }], m7, ARRIVE_MS, SETTLE_MS));

    say('STEP 8: window 1 signs out; the session ends for window 2 as well');
    const signedOut: boolean = await disconnectViaTopBar(a1, A, harness.uxTracker);
    r.a2ToldOfLogout = signedOut && aCid !== '' && (await pollUntil(async () => sessionEnds.includes(aCid), 30_000, 250));
    // What the user sees, before anything here navigates: window 2 has left the workspace for the
    // landing page (its sign-in button) and says why (the toast). Both are positive markers.
    r.a2LeftForLanding = signedOut
      && (await isVisibleWithin(a2again.getByTestId('sign-in-button'), 30_000))
      && (await isVisibleWithin(a2again.getByText(`${A} was signed out in another window.`), 10_000));
    // Presence first: B's chip proves the strip loaded the agent's live list; only then is A's absence evidence.
    r.sessionEndedForAll = signedOut && (await landingListsSession(a2again, B)) && (await a2again.getByTestId(`session-icon-${A}`).count()) === 0;
    await takeScreenshot(a2again, 'multi_window_after_logout');

    console.log(`\n${'='.repeat(60)}\nRESULTS\n${'='.repeat(60)}`);
    for (const [name, value] of Object.entries(r)) console.log(`  ${name.padEnd(20)} ${typeof value === 'boolean' ? (value ? 'PASS' : 'FAIL') : JSON.stringify(value)}`);
    const passed: boolean = Object.values(r).every((v: boolean | PeersReady) => (typeof v === 'boolean' ? v : Object.values(v).every(Boolean)));
    harness.finalize(passed, r as unknown as Record<string, unknown>);
    return passed;
  } finally {
    await sleep(500);
    await world.browser.close();
  }
}

runTestMain(runTest);
