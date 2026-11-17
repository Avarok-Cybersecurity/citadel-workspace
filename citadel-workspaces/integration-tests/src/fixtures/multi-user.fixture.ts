/**
 * Multi-User Playwright Test Fixture
 *
 * Provides two authenticated users with optional P2P connection setup.
 * Uses separate browser instances (like createSeparateBrowsers) to avoid
 * Chrome tab throttling issues.
 */

import { test as base, type Page, type Browser, type BrowserContext } from '@playwright/test';
import { chromium } from 'playwright';
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
    adminCredentials,
    loginAfterDisconnect, isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';
import { forwardConsole } from '../lib/forward-console.js';

/* ── Fixture types ── */

export interface UserSession {
    browser: Browser;
    context: BrowserContext;
    page: Page;
    username: string;
    password: string;
}

export interface MultiUserFixture {
    /** First user — fully authenticated */
    userA: UserSession;
    /** Second user — fully authenticated */
    userB: UserSession;
}

export interface AdminMemberFixture {
    /** The workspace admin global-setup registered — the only account that can edit. */
    admin: UserSession;
    /** A freshly registered account, which joins as an ordinary Member. */
    member: UserSession;
}

export interface P2PConnectedFixture extends MultiUserFixture {
    /** Both users are P2P-registered and have a conversation open */
    p2pReady: boolean;
}

/* ── CI-safe launch args (mirrors browser.ts) ── */

const CI_ARGS = [
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-software-rasterizer',
    '--js-flags=--max-old-space-size=512',
    '--renderer-process-limit=2',
    '--disable-features=TranslateUI',
    '--disable-component-update',
];

const COMMON_ARGS = [
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-ipc-flooding-protection',
];

/* ── Helper: create a fully authenticated user session ── */


export async function createUserSession(label: string): Promise<UserSession> {
    const browser = await chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 50 : 0,
        args: [...COMMON_ARGS, ...(isCI ? CI_ARGS : [])],
    });

    const context = await browser.newContext({ storageState: undefined });
    await context.clearCookies();
    const page = await context.newPage();
    forwardConsole(page, label);

    // Navigate and wait
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);

    // Register unique user
    const timestamp = Date.now();
    const username = `pw_${label}_${timestamp}_${Math.random().toString(36).slice(2, 6)}`;
    const password = config.DEFAULT_PASSWORD;

    const registered = await createAccount(page, username, {
        isFirstUser: label === 'a', // First user creates workspace
        password,
        uxTracker: null,
    });

    if (!registered) {
        await browser.close();
        throw new Error(`Failed to register user ${label}: ${username}`);
    }

    // Checked, not fired and forgotten. This returns false rather than throwing,
    // so discarding it let a workspace that never rendered carry on into the
    // test, where it surfaces much later as something unrelated — a peer
    // 'missing' from the sidebar, or a seven-minute group-call timeout whose
    // log says only that it was waiting.
    if (!(await waitForWorkspaceLoaded(page, 30_000))) {
        await browser.close();
        throw new Error(`Workspace never finished loading for ${label}: ${username}`);
    }
    await closeAnyModals(page);

    console.log(`  [${label.toUpperCase()}] Authenticated as: ${username}`);
    return { browser, context, page, username, password };
}

/**
 * Log a fresh browser into the admin account global-setup registered.
 *
 * Registering another account here would not do: only the first member of the
 * workspace is promoted to Admin, so a spec that needs edit rights has to use
 * that account rather than hope it ran first.
 */
async function loginAdminSession(): Promise<UserSession> {
    const { username, password } = adminCredentials();

    const browser = await chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 50 : 0,
        args: [...COMMON_ARGS, ...(isCI ? CI_ARGS : [])],
    });

    const context = await browser.newContext({ storageState: undefined });
    await context.clearCookies();
    const page = await context.newPage();
    forwardConsole(page, 'admin');

    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);

    const loggedIn = await loginAfterDisconnect(
        page,
        username,
        password,
        null,
        config.WORKSPACE_SERVER,
    );
    if (!loggedIn) {
        await browser.close();
        throw new Error(`Could not log in as the workspace admin (${username})`);
    }

    if (!(await waitForWorkspaceLoaded(page, 30_000))) {
        await browser.close();
        throw new Error(`Workspace never finished loading for admin ${username}`);
    }
    await closeAnyModals(page);

    console.log(`  [ADMIN] Authenticated as: ${username}`);
    return { browser, context, page, username, password };
}

/* ── Exported fixtures ── */

/**
 * `multiUserTest` — provides two authenticated users in separate browser instances.
 */
export const multiUserTest = base.extend<MultiUserFixture>({
    userA: async ({ }, use) => {
        const session = await createUserSession('a');
        await use(session);
        await session.browser.close();
    },

    userB: async ({ }, use) => {
        const session = await createUserSession('b');
        await use(session);
        await session.browser.close();
    },
});

/**
 * `p2pConnectedTest` — extends multiUserTest with P2P registration and conversation open.
 */
export const p2pConnectedTest = multiUserTest.extend<P2PConnectedFixture>({
    p2pReady: async ({ userA, userB }, use) => {
        console.log('\n── Setting up P2P connection ──');

        // User A discovers and registers with User B
        await p2pRegister(userA.page, userA.username, userB.username);

        // User B accepts the request
        await acceptP2PRequest(userB.page, userB.username, null, userA.username);

        // Wait for P2P channel to be fully ready
        await waitForP2PChannelReady(userA.page, userA.username, userB.username);
        await waitForP2PChannelReady(userB.page, userB.username, userA.username);

        // Open conversations on both sides
        await openConversation(userA.page, userA.username, userB.username);
        await openConversation(userB.page, userB.username, userA.username);

        console.log('  P2P connection established and conversations open');
        await use(true);
    },
});

/**
 * `adminMemberTest` — the workspace admin plus an ordinary member, in separate
 * browsers.
 *
 * Use this for anything that needs one side to actually be able to change the
 * workspace. `multiUserTest` gives two members, and a member holds ViewContent
 * but not EditContent or EditMdx by design.
 */
export const adminMemberTest = base.extend<AdminMemberFixture>({
    admin: async ({ }, use) => {
        const session = await loginAdminSession();
        await use(session);
        await session.browser.close();
    },

    member: async ({ }, use) => {
        const session = await createUserSession('member');
        await use(session);
        await session.browser.close();
    },
});
