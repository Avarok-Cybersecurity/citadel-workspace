/**
 * Login Flow — Playwright Test spec
 *
 * Migrated from login-flow.test.ts to @playwright/test format.
 * Tests the full authentication lifecycle:
 *   Register → Disconnect → Login → Disconnect → Login → Verify workspace
 */

import { test, expect } from '@playwright/test';
import { isVisibleWithin } from '../lib/utils.js';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import {
    clearBrowserStorage,
    waitForAppReady,
    createAccount,
    waitForWorkspaceLoaded,
    closeAnyModals,
    checkForErrors,
    disconnectViaTopBar,
    UxIssueTracker,
    sleep, isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';

/* ── Shared state across serial steps ── */

const timestamp = Date.now();
const USERNAME = `pw_login_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

let browser: Browser;
let context: BrowserContext;
let page: Page;
let uxTracker: UxIssueTracker;

/* ── Helpers ── */

async function loginWithCredentials(
    page: Page,
    username: string,
    password: string,
): Promise<boolean> {
    // Check for existing session to claim
    await sleep(1000);
    // The session chip's title is `${full_name || username} - ${workspace}`,
    // which omits the username for anybody named like a person. It matches here
    // only because the suite fills the full name with the username.
    const existingSession = page.getByTestId(`session-button-${username}`).first();
    if (await isVisibleWithin(existingSession, 3000)) {
        await existingSession.click();
        await sleep(3000);
        const loaded = await waitForWorkspaceLoaded(page, 30_000);
        if (loaded) return true;
    }

    // Navigate to landing if needed
    const loginBtn = page.getByTestId('sign-in-button');
    if (!(await isVisibleWithin(loginBtn, 2000))) {
        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 30_000);
    }

    // Click Sign In
    const loginBtnVisible = page.getByTestId('sign-in-button');
    await expect(loginBtnVisible).toBeVisible({ timeout: 5000 });
    await loginBtnVisible.click();
    await sleep(1000);

    // Fill login form
    await expect(page.locator('text="Login to Workspace"')).toBeVisible({ timeout: 5000 });
    await page.locator('input#username').fill(username);
    await sleep(300);
    await page.locator('input#password').fill(password);
    await sleep(300);

    // Advanced options: set server address
    const advancedBtn = page.locator('button:has-text("Advanced Options")');
    if (await isVisibleWithin(advancedBtn, 2000)) {
        await advancedBtn.click();
        await sleep(300);
        const serverInput = page.locator('input#server');
        if (await isVisibleWithin(serverInput, 2000)) {
            await serverInput.fill(config.WORKSPACE_SERVER);
            await sleep(300);
        }
    }

    // Submit
    await page.getByTestId('login-submit').click();
    await sleep(3000);

    // Check for errors.
    //
    // By ID, not by colour class. This was `.text-red-400`, which appears NOWHERE
    // in the app: `components/Login.tsx:176-183` renders the inline error as
    // `id="login-error"` with `role="alert"` and `text-destructive-emphasis`. So
    // the locator matched nothing, the whole branch below was unreachable, and
    // the `return true` at the end of this function was unconditional -- a failed
    // login reported success, and the session-claim recovery inside the branch
    // never ran either.
    //
    // A colour class is the worst thing to pin a test to: it changes for visual
    // reasons, with no behaviour change to notice, and the failure is silent.
    const errorEl = page.locator('#login-error');
    if (await isVisibleWithin(errorEl, 2000)) {
        const errorText = await errorEl.textContent();
        if (errorText?.includes('already exists') || errorText?.includes('Session')) {
            await page.keyboard.press('Escape');
            await sleep(500);
            const sessionIcon = page.getByTestId(`session-button-${username}`).first();
            if (await isVisibleWithin(sessionIcon, 3000)) {
                await sessionIcon.click();
                await sleep(3000);
                return true;
            }
        }
        return false;
    }

    await sleep(3000);
    return true;
}

/* ── Test Suite (serial) ── */

test.describe.serial('Login Flow', () => {
    test.beforeAll(async () => {
        browser = await chromium.launch({
            headless: !isHeaded,
            slowMo: isHeaded ? 50 : 0,
            args: [
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding',
                '--disable-ipc-flooding-protection',
                ...(isCI ? [
                    '--disable-dev-shm-usage', '--no-sandbox', '--disable-setuid-sandbox',
                    '--disable-gpu', '--disable-extensions', '--disable-software-rasterizer',
                ] : []),
            ],
        });
        context = await browser.newContext({ storageState: undefined });
        await context.clearCookies();
        page = await context.newPage();
        uxTracker = new UxIssueTracker();
    });

    test.afterAll(async () => {
        await browser.close();
    });

    test('Step 1: Register new account', async () => {
        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await clearBrowserStorage(page);
        await waitForAppReady(page, 60_000);

        const registered = await createAccount(page, USERNAME, {
            isFirstUser: true,
            password: PASSWORD,
            uxTracker,
        });

        expect(registered).toBe(true);
        await sleep(3000);
    });

    test('Step 2: Disconnect session (1st time)', async () => {
        await closeAnyModals(page);
        const disconnected = await disconnectViaTopBar(page, USERNAME, uxTracker);
        expect(disconnected).toBe(true);

        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 30_000);
    });

    test('Step 3: Login with credentials (1st time)', async () => {
        const loggedIn = await loginWithCredentials(page, USERNAME, PASSWORD);
        expect(loggedIn).toBe(true);
        await sleep(3000);

        await closeAnyModals(page);
        await checkForErrors(page, 'login 1', uxTracker);

        const loaded = await waitForWorkspaceLoaded(page, 30_000);
        expect(loaded).toBe(true);
    });

    test('Step 4: Disconnect session (2nd time)', async () => {
        await closeAnyModals(page);
        const disconnected = await disconnectViaTopBar(page, USERNAME, uxTracker);
        expect(disconnected).toBe(true);

        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 30_000);
    });

    test('Step 5: Login with credentials (2nd time)', async () => {
        const loggedIn = await loginWithCredentials(page, USERNAME, PASSWORD);
        expect(loggedIn).toBe(true);
        await sleep(3000);

        await closeAnyModals(page);
        await checkForErrors(page, 'login 2', uxTracker);

        const loaded = await waitForWorkspaceLoaded(page, 30_000);
        expect(loaded).toBe(true);
    });
});
