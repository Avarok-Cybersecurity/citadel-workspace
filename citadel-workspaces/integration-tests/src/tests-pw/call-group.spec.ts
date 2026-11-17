/**
 * Proof that GROUP calling carries real media between THREE participants.
 *
 * The engine fans one encoded stream out to every participant (encode once,
 * send to many), so the thing worth proving is that a third participant
 * genuinely decodes frames — and, harder, that two INVITEES decode each
 * other, since neither of them dialled and the caller relays nothing.
 *
 * The load-bearing assertions are therefore: on an invitee's page, TWO
 * distinct REMOTE participant tiles each reporting a non-zero videoWidth.
 * The self tile is rendered with cid -1 and carries the local camera, so it
 * always has video and is excluded — matching every tile once made this
 * exact assertion pass while no frame crossed the network.
 *
 * The call happens in an ad-hoc peer group, not an office room. A room's
 * callable roster is its MEMBERS, membership is admin-granted (verified in
 * async_domain_server_ops.rs: only UpdateWorkspace with the master password
 * pushes onto workspace.members, and rooms gain members only via AddMember),
 * so a room of freshly registered accounts correctly refuses to call — the
 * state this spec used to stop at. A peer group's members are explicit: the
 * creator picks them in CreateGroupDialog, every invitee auto-joins, and
 * GroupChatPage hands exactly that roster to the call controls.
 *
 * Three separate browsers, one per participant, as in the 1:1 proof: each
 * gets its own WASM client, its own fake camera, and no tab throttling of
 * another participant's encoder.
 */

import { test, expect } from '@playwright/test';
import { formatConsoleLine } from '../lib/console-line.js';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import {
  clearBrowserStorage,
  waitForAppReady,
  createAccount,
  waitForWorkspaceLoaded,
  closeAnyModals, isHeaded,} from '../lib/index.js';
import { config } from '../lib/config.js';
import { connectPair, expectCallLive, CALL_LAUNCH_ARGS } from './call-helpers.js';
import { acceptGroupInvitation } from '../lib/group-invite.js';

interface UserSession {
  browser: Browser;
  context: BrowserContext;
  page: Page;
  username: string;
}

const stamp = Date.now();
const USERS = {
  a: { username: `pw_gcall_a_${stamp}`, password: 'test12345' },
  b: { username: `pw_gcall_b_${stamp}`, password: 'test12345' },
  c: { username: `pw_gcall_c_${stamp}`, password: 'test12345' },
};

const GROUP_NAME = `Call Group ${stamp}`;


let sessionA: UserSession;
let sessionB: UserSession;
let sessionC: UserSession;
/** The backend-derived group id, read from A's sidebar row and then required
 *  verbatim on B's and C's — same id on three browsers IS the shared group. */
let groupId: string;

async function createSession(label: 'a' | 'b' | 'c', isFirst: boolean): Promise<UserSession> {
  const browser = await chromium.launch({ headless: !isHeaded, slowMo: isHeaded ? 50 : 0, args: CALL_LAUNCH_ARGS });
  const context = await browser.newContext({
    storageState: undefined,
    permissions: ['camera', 'microphone'],
  });
  await context.clearCookies();
  const page = await context.newPage();

  // Call-path console lines surfaced into the test log, because a call that
  // never rings leaves no trace in the DOM: the evidence of where the signal
  // died lives only in the browser console.
  page.on('console', (msg) => {
    const text = msg.text();
    if (/\[Call\]|CallSignal|call:signal|CallInvite|sendP2PCommand|Failed to send|MediaSession/i.test(text)) {
      console.log(`  [${label}:console] ${formatConsoleLine(text)}`);
    }
  });

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
 * Wait until at least `want` DISTINCT remote tiles are painting real pixels.
 *
 * videoWidth stays 0 until a first frame has actually decoded — the difference
 * between "a tile rendered" and "media arrived". Requiring two proves the
 * mesh: on an invitee's page one of those senders is the OTHER invitee.
 */
async function waitForRemoteVideos(page: Page, want: number, timeoutMs = 90_000): Promise<number> {
  const handle = await page.waitForFunction(
    (needed) => {
      const tiles = Array.from(
        document.querySelectorAll('[data-testid^="participant-tile-"]'),
      ).filter((t) => t.getAttribute('data-testid') !== 'participant-tile-self');
      let decoding = 0;
      for (const tile of tiles) {
        const video = tile.querySelector('video') as HTMLVideoElement | null;
        if (video && video.videoWidth > 0) decoding += 1;
      }
      return decoding >= needed ? decoding : null;
    },
    want,
    { timeout: timeoutMs },
  );
  return (await handle.jsonValue()) as number;
}

test.describe.serial('Group calling with three participants', () => {
  test.beforeAll(async () => {
    test.setTimeout(420_000);
    sessionA = await createSession('a', true);
    sessionB = await createSession('b', false);
    sessionC = await createSession('c', false);
  });

  test.afterAll(async () => {
    await sessionA?.browser.close();
    await sessionB?.browser.close();
    await sessionC?.browser.close();
  });

  // Every pair, because a group call is a mesh: B and C exchange signals,
  // sessions and frames directly, without A in the middle.
  //
  // One test per pair rather than all three in one.
  //
  // The combined version exhausted its full 420s budget on CI twice, failing at
  // a different point each time — once on `page.screenshot`, once waiting for a
  // workspace to load after an accept. The first reading was "too slow for a
  // 2-core runner", and the split was made on that basis. THE NUMBERS SAY
  // OTHERWISE: split, each pair connects in ~46s on the same CI hardware, so
  // all three amount to ~140s against a 420s budget. The combined test was not
  // running out of time. One step was HANGING, and the budget was never the
  // constraint.
  //
  // So this split is isolation, not a cure. If the hang returns it now fails as
  // a named pair inside 240s instead of as a seven-minute test that says only
  // "pairwise", and the log points at which connectPair stalled. Both observed
  // stalls were in the conversation-open step after the peer request was
  // accepted, which is where to look first.
  //
  // `describe.serial` keeps them ordered on the shared sessions, so coverage is
  // identical.
  test('A and B connect', async () => {
    test.setTimeout(240_000);
    await connectPair(sessionA, sessionB);
  });

  test('A and C connect', async () => {
    test.setTimeout(240_000);
    await connectPair(sessionA, sessionC);
  });

  test('B and C connect, without A in the middle', async () => {
    test.setTimeout(240_000);
    await connectPair(sessionB, sessionC);
  });

  test('A creates the group with B and C as members', async () => {
    test.setTimeout(300_000);
    const page = sessionA.page;

    // The CONVERSATIONS sidebar section — which carries the New Group button —
    // renders only once a conversation with messages exists; the pairwise
    // warmup traffic already created one on A's page.

    // The dialog's peer list comes from the registration roster, which can lag
    // the accepted registration by several seconds — so retry the whole
    // open-and-pick sequence rather than sampling it once.
    await expect(async () => {
      await closeAnyModals(page);
      await page.getByTestId('new-group-chat-button').click();
      await page.getByTestId('create-group-name').fill(GROUP_NAME);
      for (const peer of [sessionB.username, sessionC.username]) {
        await page.getByTestId('create-group-add-member').click();
        await page.getByTestId(`create-group-peer-${peer}`).click({ timeout: 5_000 });
      }
    }).toPass({ timeout: 90_000 });

    await page.getByTestId('create-group-submit').click();

    // The row appears only when GroupCreateSuccess came back and was applied —
    // creation is proven by the response, not by the dialog closing.
    const row = page.locator('[data-testid^="group-row-"]');
    await expect(row).toBeVisible({ timeout: 30_000 });
    const testId = await row.getAttribute('data-testid');
    groupId = testId!.replace('group-row-', '');
    expect(groupId.length, 'the group id should be backend-derived, not empty').toBeGreaterThan(0);

    // Fully closed, not merely closing: the dialog's exit animation outlives
    // this test, and a Cancel button that is mid-animation is exactly the kind
    // of half-present element a later cleanup helper wedges on.
    await expect(page.locator('[role="dialog"]')).toHaveCount(0, { timeout: 15_000 });
  });

  test('B and C are asked to join, and accepting brings them the group', async () => {
    // The invite path: server-relayed GroupInviteNotification, shown as a
    // question (UI f40d9496) and joined on Accept. The row must carry the SAME
    // id as A's -- three browsers converging on one id is what makes it one group.
    test.setTimeout(180_000);
    for (const member of [sessionB, sessionC]) {
      const invite = member.page.locator(`[data-testid="group-invite-row"][data-group-id="${groupId}"]`);
      await expect(invite, `${member.username} should be asked to join`).toBeVisible({ timeout: 60_000 });
      // The wire carries no name; the question must not present a made-up one as the group's.
      await expect(invite).toContainText('invited you to a group');
      await acceptGroupInvitation(member.page, groupId, 60_000);
    }
  });

  test('every member reaches the group page and its call controls', async () => {
    test.setTimeout(180_000);
    for (const member of [sessionA, sessionB, sessionC]) {
      await member.page.bringToFront();
      await member.page.getByTestId(`group-row-${groupId}`).click();
      await expect(
        member.page.getByTestId('group-call-start-video'),
        `${member.username} should see group call controls`,
      ).toBeVisible({ timeout: 30_000 });
    }
  });

  test('calling becomes available to A once the members joined', async () => {
    // Disabled-with-reason is the product's honest state while the roster is
    // empty; it becomes enabled when the backend membership broadcasts land.
    // If this never enables, the invitees' backend acceptance never reached A.
    test.setTimeout(180_000);
    await expect(sessionA.page.getByTestId('group-call-start-video')).toBeEnabled({
      timeout: 120_000,
    });
  });

  test('starting the call rings both members', async () => {
    test.setTimeout(180_000);
    await sessionA.page.getByTestId('group-call-start-video').click();

    await expect(sessionA.page.getByTestId('call-stage')).toBeVisible({ timeout: 30_000 });
    await expect(sessionB.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });
    await expect(sessionC.page.getByTestId('incoming-call-card')).toBeVisible({ timeout: 60_000 });
  });

  test('both members join the call', async () => {
    test.setTimeout(180_000);
    await sessionB.page.getByTestId('incoming-call-accept').click();
    await expect(sessionB.page.getByTestId('call-stage')).toBeVisible({ timeout: 60_000 });

    await sessionC.page.getByTestId('incoming-call-accept').click();
    await expect(sessionC.page.getByTestId('call-stage')).toBeVisible({ timeout: 60_000 });

    // Joined is the clock running, not the stage rendering. See expectCallLive.
    await expectCallLive(sessionB.page);
    await expectCallLive(sessionC.page);
  });

  test('B decodes frames from TWO distinct peers — the caller and the other invitee', async () => {
    // The assertion this spec exists for. B dialled nobody; one of these two
    // streams comes from C, who B only knows about because the invite carried
    // the roster and their accepts crossed directly. Fewer than two here means
    // hub-and-spoke, not a mesh.
    test.setTimeout(180_000);
    const decoding = await waitForRemoteVideos(sessionB.page, 2, 120_000);
    expect(decoding, 'B should decode video from A and from C').toBeGreaterThanOrEqual(2);
  });

  test('C decodes frames from TWO distinct peers as well', async () => {
    test.setTimeout(180_000);
    const decoding = await waitForRemoteVideos(sessionC.page, 2, 120_000);
    expect(decoding, 'C should decode video from A and from B').toBeGreaterThanOrEqual(2);
  });

  test('A decodes frames from both invitees — the fan-in side of the mesh', async () => {
    test.setTimeout(180_000);
    const decoding = await waitForRemoteVideos(sessionA.page, 2, 120_000);
    expect(decoding, 'A should decode video from B and from C').toBeGreaterThanOrEqual(2);
  });

  test('one member leaving does not end the call for the rest', async () => {
    test.setTimeout(180_000);
    await sessionC.page.getByTestId('call-leave').click();
    await expect(sessionC.page.getByTestId('call-stage')).toHaveCount(0, { timeout: 30_000 });

    // A and B carry on — including live media, not merely surviving UI.
    await expect(sessionA.page.getByTestId('call-stage')).toBeVisible();
    await expect(sessionB.page.getByTestId('call-stage')).toBeVisible();
    const stillDecoding = await waitForRemoteVideos(sessionB.page, 1, 60_000);
    expect(stillDecoding, 'B should still decode video from A').toBeGreaterThanOrEqual(1);
  });
});
