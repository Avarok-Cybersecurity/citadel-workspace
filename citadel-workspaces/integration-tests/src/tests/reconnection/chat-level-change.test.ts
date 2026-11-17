/**
 * Raising one chat's encryption level, live, between two users (owner report 2026-11-15).
 *
 * "When changing from Standard to e.g., Extreme security for a chat, the UI gets stuck
 * saying 'Reconnecting...'", and "older messages were no longer viewable even with
 * scrolling". Proven without a stack by:
 *   - citadel-internal-service/tests/a_chat_level_change_reconnects_at_the_new_level.rs
 *     (the agent redials at the chat's level and answers its "Reconnecting…");
 *   - src/components/p2p/hooks/__tests__/older-messages-load-without-scrolling.test.tsx.
 * What only a live pair shows: the header, the Advanced tab's status line, delivery both
 * ways afterwards, and the older page reachable after a reload.
 *
 * 1. Two accounts, registered to each other, conversation open on both sides.
 * 2. user1 sends more than one stored page (50) of messages.
 * 3. user1 sets Chat settings -> Advanced -> Encryption Level to Extreme. user2 does not.
 * 4. The tab says "Reconnected at Extreme"; neither header says "Reconnecting…".
 * 5. Messages cross both ways.
 * 6. user1 reloads, reopens the chat and reaches the first message through
 *    "Load older messages".
 */
import type { Page, Browser } from 'playwright';
import {
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  sendMessage,
  verifyMessageReceived,
  takeScreenshot,
  setupConsoleCapture,
  config,
  TestHarness,
  runTestMain,
  waitForWorkspaceLoaded,
  pollUntil,
} from '../../lib/index.js';

const timestamp: number = Date.now();
const USER1: string = `level_1_${timestamp}`;
const USER2: string = `level_2_${timestamp}`;
const PASSWORD: string = config.DEFAULT_PASSWORD;
/** One more than a stored page (MESSAGES_PER_PAGE, agent conversations/store.rs). */
const HISTORY: number = 51;
/** The Advanced tab's own bound on saying the chat is back (LEVEL_RECONNECT_WAIT_MS) plus margin. */
const RECONNECT_BUDGET_MS: number = 30_000;

interface Step { step: string; ok: boolean; notes: string }

const pill = (page: Page) => page.locator('[data-testid="chat-connection-path"]');

/** The header no longer says "Reconnecting…", and the peer reads Online: absence alone proves nothing. */
async function settled(page: Page): Promise<boolean> {
  return pollUntil(async (): Promise<boolean> => {
    const reconnecting: boolean = (await pill(page).count()) > 0 && /Reconnecting/.test(await pill(page).innerText());
    const online: boolean = (await page.getByText('Online', { exact: true }).count()) > 0;
    return !reconnecting && online;
  }, RECONNECT_BUDGET_MS, 500);
}

async function raiseToExtreme(page: Page): Promise<string> {
  await page.locator('[data-testid="chat-settings-button"]').click();
  await page.getByRole('heading', { name: 'Chat Settings' }).waitFor({ timeout: 5_000 });
  await page.locator('[data-testid="tab-advanced"]').click();
  await page.locator('#encryption-level').selectOption('Extreme');
  const status = page.getByRole('status').filter({ hasText: /^Saved\./ });
  await status.waitFor({ timeout: RECONNECT_BUDGET_MS });
  const said: string = await status.innerText();
  await page.keyboard.press('Escape');
  return said;
}

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'Chat level change reconnects',
    reportFileName: 'chat-level-change-test.json',
    metadata: { user1: USER1, user2: USER2 },
  });
  const ux = harness.uxTracker;
  const steps: Step[] = [];
  const record = (step: string, ok: boolean, notes: string): boolean => {
    steps.push({ step, ok, notes });
    console.log(`${ok ? 'PASS' : 'FAIL'} ${step}: ${notes}`);
    return ok;
  };
  let browsers: Browser[] = [];
  try {
    const setup = await createSeparateBrowsers(2);
    browsers = setup.browsers;
    const [page1, page2] = setup.pages;
    setupConsoleCapture(page1, USER1, ['Ratchet does not exist', 'ratchet v']);
    setupConsoleCapture(page2, USER2, ['Ratchet does not exist', 'ratchet v']);

    if (!record('create user1', await createAccount(page1, USER1, { isFirstUser: true, password: PASSWORD, uxTracker: ux }), USER1)) return false;
    if (!record('create user2', await createAccount(page2, USER2, { isFirstUser: false, password: PASSWORD, uxTracker: ux }), USER2)) return false;
    if (!record('both ready', (await waitForWorkspaceLoaded(page1, 45_000)) && (await waitForWorkspaceLoaded(page2, 45_000)), '')) return false;
    if (!record('register', await p2pRegister(page1, USER1, USER2, ux), 'user1 -> user2')) return false;
    if (!record('accept', await acceptP2PRequest(page2, USER2, ux, USER1), 'user2')) return false;
    if (!record('open both', (await openConversation(page1, USER1, USER2, ux)) && (await openConversation(page2, USER2, USER1, ux)), '')) return false;

    const first: string = `first of ${HISTORY} ${timestamp}`;
    for (let n = 0; n < HISTORY; n++) {
      const text: string = n === 0 ? first : `history ${n} ${timestamp}`;
      if (!(await sendMessage(page1, USER1, text, ux))) return record('history', false, `message ${n} not sent`);
    }
    if (!record('history arrived', await verifyMessageReceived(page2, USER2, `history ${HISTORY - 1} ${timestamp}`, 30_000, ux), `${HISTORY} messages`)) return false;

    const said: string = await raiseToExtreme(page1);
    record('the tab says the chat is back', /Reconnected at Extreme/.test(said), said);
    await takeScreenshot(page1, `${USER1}_after_extreme`);
    record('user1 header settles', await settled(page1), 'no "Reconnecting…", peer Online');
    record('user2 header settles', await settled(page2), 'user2 did not change its level');

    const after1: string = `after extreme from user1 ${timestamp}`;
    const after2: string = `after extreme from user2 ${timestamp}`;
    record('user1 -> user2 after', (await sendMessage(page1, USER1, after1, ux)) && (await verifyMessageReceived(page2, USER2, after1, 30_000, ux)), '');
    record('user2 -> user1 after', (await sendMessage(page2, USER2, after2, ux)) && (await verifyMessageReceived(page1, USER1, after2, 30_000, ux)), '');

    await page1.reload();
    await waitForWorkspaceLoaded(page1, 45_000);
    await openConversation(page1, USER1, USER2, ux);
    const older = page1.getByRole('button', { name: /load older messages/i });
    const reached: boolean = await pollUntil(async (): Promise<boolean> => {
      if ((await page1.getByText(first, { exact: true }).count()) > 0) return true;
      if ((await older.count()) > 0) await older.first().click();
      return false;
    }, 30_000, 1_000);
    record('older messages reachable after reload', reached, first);
    await takeScreenshot(page1, `${USER1}_history_after_reload`);

    const passed: boolean = steps.every((s: Step): boolean => s.ok);
    harness.finalize(passed, { steps } as Record<string, unknown>);
    return passed;
  } catch (error) {
    record('run', false, error instanceof Error ? error.message : String(error));
    return false;
  } finally {
    for (const browser of browsers) await browser.close();
  }
}

runTestMain(runTest);
