/**
 * P2P Messaging — Playwright Test spec
 *
 * Tests bidirectional peer-to-peer messaging between two users.
 * Uses separate browser instances to avoid tab throttling.
 */

import { test, expect } from '@playwright/test';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import {
    clearBrowserStorage,
    waitForAppReady,
    createAccount,
    waitForWorkspaceLoaded,
    closeAnyModals,
    p2pRegister,
    acceptP2PRequest,
    openConversation,
    waitForP2PChannelReady,
    sendMessage,
    verifyMessageReceived,
    sleep, isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';

/* ── Shared state ── */

interface UserSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    username: string;
}

const timestamp = Date.now();
const USERS = {
    a: { username: `pw_p2p_a_${timestamp}`, password: config.DEFAULT_PASSWORD },
    b: { username: `pw_p2p_b_${timestamp}`, password: config.DEFAULT_PASSWORD },
};

let sessionA: UserSession;
let sessionB: UserSession;

/* ── Helpers ── */

const LAUNCH_ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
    ...(isCI ? [
        '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-gpu', '--disable-extensions', '--disable-software-rasterizer',
    ] : []),
];

async function createSession(label: 'a' | 'b', isFirst: boolean): Promise<UserSession> {
    const browser = await chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 50 : 0,
        args: LAUNCH_ARGS,
    });
    const context = await browser.newContext({ storageState: undefined });
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

    // Checked, not fired and forgotten: this returns false rather than
    // throwing, so ignoring it let a workspace that never loaded run the
    // whole block and fail later somewhere unrelated.
    expect(
      await waitForWorkspaceLoaded(page, 30_000),
      'the workspace should finish loading',
    ).toBe(true);
    await closeAnyModals(page);

    return { browser, context, page, username: user.username };
}

/* ── Test Suite (serial) ── */

test.describe.serial('P2P Messaging', () => {
    test.beforeAll(async () => {
        // Create two users in separate browsers
        sessionA = await createSession('a', true);
        sessionB = await createSession('b', false);
    });

    test.afterAll(async () => {
        await sessionA?.browser.close();
        await sessionB?.browser.close();
    });

    // Every helper below returns a boolean and is DESIGNED not to throw —
    // registration.ts says so outright: "these helpers report failure through
    // their return value and the caller decides. Silently discarding it is what
    // made the group-call stall unreadable."
    //
    // This test discarded all six. A total handshake failure surfaced in CI as
    // two green tests named "P2P registration and handshake" and "Open
    // conversations on both sides", on the suite's flagship leg.
    test('P2P registration and handshake', async () => {
        // User A discovers and registers with User B
        expect(
            await p2pRegister(sessionA.page, sessionA.username, sessionB.username),
            `${sessionA.username} should be able to register with ${sessionB.username}`
        ).toBe(true);

        // User B accepts the request
        expect(
            await acceptP2PRequest(sessionB.page, sessionB.username, null, sessionA.username),
            `${sessionB.username} should be able to accept the request`
        ).toBe(true);

        // Wait for P2P channel to be fully ready (bidirectional)
        expect(
            await waitForP2PChannelReady(sessionA.page, sessionA.username, sessionB.username),
            `the channel should be ready from ${sessionA.username} to ${sessionB.username}`
        ).toBe(true);
        expect(
            await waitForP2PChannelReady(sessionB.page, sessionB.username, sessionA.username),
            `the channel should be ready from ${sessionB.username} to ${sessionA.username}`
        ).toBe(true);
    });

    test('Open conversations on both sides', async () => {
        expect(
            await openConversation(sessionA.page, sessionA.username, sessionB.username),
            `${sessionA.username} should be able to open the conversation`
        ).toBe(true);
        expect(
            await openConversation(sessionB.page, sessionB.username, sessionA.username),
            `${sessionB.username} should be able to open the conversation`
        ).toBe(true);
    });

    // A chat transcript has to be a live region or an arriving message is
    // silent: a screen reader user only learns about it by going to look. axe
    // reports nothing — a live region is not required markup, it is a decision
    // that had not been made. Asserted where a conversation is actually open,
    // because that is the only place the transcript exists.
    test('the transcript is announced as it grows', async () => {
        const log = sessionA.page.getByRole('log', { name: /conversation/i });
        await expect(log).toBeAttached();

        // role="log" implies polite announcement of additions; an assertive
        // region here would interrupt the user mid-sentence on every message.
        const live = await log.first().getAttribute('aria-live');
        expect(live === null || live === 'polite', `aria-live was "${live}"`).toBe(true);
    });

    test('Send message A → B', async () => {
        const message = `Hello from A! [${Date.now()}]`;
        await sendMessage(sessionA.page, sessionA.username, message);
        await sleep(2000);

        const received = await verifyMessageReceived(sessionB.page, sessionB.username, message);
        expect(received).toBe(true);
    });

    test('Send message B → A', async () => {
        const message = `Hello from B! [${Date.now()}]`;
        await sendMessage(sessionB.page, sessionB.username, message);
        await sleep(2000);

        const received = await verifyMessageReceived(sessionA.page, sessionA.username, message);
        expect(received).toBe(true);
    });

    test('Rapid bidirectional exchange', async () => {
        const messagesA: string[] = [];
        const messagesB: string[] = [];

        // Send 3 messages from each side
        for (let i = 0; i < 3; i++) {
            const msgA = `Rapid A→B #${i} [${Date.now()}]`;
            const msgB = `Rapid B→A #${i} [${Date.now()}]`;
            messagesA.push(msgA);
            messagesB.push(msgB);

            await sendMessage(sessionA.page, sessionA.username, msgA);
            await sleep(500);
            await sendMessage(sessionB.page, sessionB.username, msgB);
            await sleep(500);
        }

        // Verify all messages were received
        await sleep(3000);

        for (const msg of messagesA) {
            const received = await verifyMessageReceived(sessionB.page, sessionB.username, msg);
            expect(received).toBe(true);
        }

        for (const msg of messagesB) {
            const received = await verifyMessageReceived(sessionA.page, sessionA.username, msg);
            expect(received).toBe(true);
        }
    });

    // The Stats tab read `p2p-messages:{cid}` and `file-transfers:{cid}` from
    // localStorage. Neither key is written anywhere in the app — each appeared
    // exactly once, in the read — so both tiles showed 0 for every conversation
    // no matter how long. Asserted AFTER the exchanges above, so a zero here
    // means the panel is not reading real data.
    //
    // Runs before the clear test, which empties the transcript on purpose.
    test('the stats tab counts real messages', async () => {
        const page = sessionA.page;
        await page.getByTestId('chat-settings-button').click({ force: true });
        const statsTab = page.getByTestId('tab-stats');
        await expect(statsTab).toBeEnabled({ timeout: 10_000 });
        await statsTab.click({ force: true });

        const count = page.getByText('Messages', { exact: true }).locator('..').locator('p').first();
        await expect(count).toBeVisible({ timeout: 30_000 });
        const text = (await count.textContent())?.trim() ?? '';
        expect(Number(text), `stats showed "${text}" after a conversation`).toBeGreaterThan(0);

        // Close the panel so the following test starts from the chat again.
        await page.keyboard.press('Escape');
    });

    // "Clear Chat History" ran localStorage.removeItem('chat-history:' + cid) —
    // a key nothing in the app has ever written — while its dialog said
    // "Messages stored on this device are removed. This cannot be undone."
    // Nothing was removed. In a product sold on privacy, being TOLD the data is
    // gone when it is not is worse than not offering the button.
    //
    // Runs last: it destroys the transcript the earlier tests built.
    test('clearing chat history actually removes the messages', async () => {
        const page = sessionA.page;
        const doomed = `Clear me [${Date.now()}]`;
        await sendMessage(page, sessionA.username, doomed);
        await expect(page.getByText(doomed, { exact: false }).first()).toBeVisible({ timeout: 30_000 });

        await page.getByTestId('chat-settings-button').click({ force: true });
        // The control lives in the Advanced tab, which is not the default one.
        await page.getByTestId('tab-advanced').click({ force: true });
        // `force` gets past the panel's own scrim; the wait is what stops the
        // click landing before the control it names has arrived.
        const clearButton = page.getByRole('button', { name: /clear chat history/i });
        await expect(clearButton).toBeEnabled({ timeout: 10_000 });
        await clearButton.click({ force: true });

        // NOT forced, and the wait is the point.
        //
        // The confirmation is a Radix AlertDialog that animates in. `force`
        // skips the actionability check, so this clicked the coordinates of a
        // button that had not finished arriving -- the click landed on nothing
        // and the dialog was still open thirty seconds later, with the message
        // it was supposed to delete behind it. It failed once and passed on
        // retry, which is what a race looks like from the outside.
        const confirmClear = page.getByRole('button', { name: /^clear history$/i });
        await expect(confirmClear).toBeEnabled({ timeout: 10_000 });
        await confirmClear.click();

        // The dialog closing is the app's own statement that it took the
        // answer. Asserting the messages are gone without it cannot tell "the
        // clear did nothing" from "the click did nothing".
        await expect(confirmClear).toHaveCount(0, { timeout: 10_000 });

        // Gone from the open conversation — the in-memory copy, which the old
        // implementation never touched either.
        await expect(page.getByText(doomed, { exact: false })).toHaveCount(0, { timeout: 30_000 });

        // And gone after a reload, which is the half that proves the PERSISTED
        // pages were deleted rather than the view merely re-rendered.
        await page.reload({ waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 60_000);

        // A live message BEFORE asserting the dead one is absent.
        //
        // `toHaveCount(0)` immediately after a reload is true before anything has
        // rendered, and this test clears the whole transcript, so there is no
        // surviving message to wait for either. The absence assertion below was
        // therefore satisfied by a conversation that had not loaded yet: delete
        // the on-disk removal in `lib/p2p/message-page-delete.ts` and keep only
        // the in-memory clear, and this still passed.
        //
        // Sending one and seeing it arrive proves the composer, the store and
        // the list are all working again -- so `doomed` being absent afterwards
        // is a statement about the data rather than about the timing.
        const canary = `Still here [${Date.now()}]`;
        await sendMessage(page, sessionA.username, canary);
        await expect(page.getByText(canary, { exact: false }).first()).toBeVisible({
            timeout: 30_000,
        });

        await expect(page.getByText(doomed, { exact: false })).toHaveCount(0, { timeout: 30_000 });
    });
});
