/**
 * Base Playwright Test Fixture
 *
 * Provides reusable authenticated page setup that eliminates per-test boilerplate.
 * Wraps the existing lib/ helpers (createBrowser, createAccount, etc.) into
 * @playwright/test fixtures.
 */

import { test as base, type Page, type BrowserContext, type Browser } from '@playwright/test';
import { chromium } from 'playwright';
import {
    clearBrowserStorage,
    waitForAppReady,
    createAccount,
    waitForWorkspaceLoaded,
    closeAnyModals,
    startDiagnostics,
    UxIssueTracker, isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';
import type { DiagnosticsHandle } from '../lib/diagnostics.js';

/* ── Fixture types ── */

export interface AuthFixture {
    /** Authenticated page — registered user, workspace loaded */
    authenticatedPage: Page;
    /** The username that was registered */
    username: string;
    /** The password used */
    password: string;
    /** Browser context for this session */
    authContext: BrowserContext;
    /** Browser instance */
    authBrowser: Browser;
}

export interface DiagnosticsFixture extends AuthFixture {
    /** Diagnostics handle — auto-captures console errors and white-screen checks */
    diagnostics: DiagnosticsHandle;
    /** UX issue tracker */
    uxTracker: UxIssueTracker;
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

/* ── Helper: launch a fresh browser with proper args ── */

async function launchBrowser(): Promise<Browser> {
    return chromium.launch({
        headless: !isHeaded,
        slowMo: isHeaded ? 50 : 0,
        args: [...COMMON_ARGS, ...(isCI ? CI_ARGS : [])],
    });
}

/* ── Helper: create context + page, clear storage, navigate, wait for app ── */

async function setupAuthenticatedPage(browser: Browser): Promise<{
    context: BrowserContext;
    page: Page;
    username: string;
    password: string;
}> {
    const context = await browser.newContext({ storageState: undefined });
    await context.clearCookies();
    const page = await context.newPage();

    // Navigate and wait for React app
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
    await clearBrowserStorage(page);
    await waitForAppReady(page, 60_000);

    // Register a unique user
    const timestamp = Date.now();
    const username = `pw_test_${timestamp}_${Math.random().toString(36).slice(2, 6)}`;
    const password = config.DEFAULT_PASSWORD;

    const registered = await createAccount(page, username, {
        isFirstUser: true,
        password,
        uxTracker: null,
    });

    if (!registered) {
        throw new Error(`Failed to register user: ${username}`);
    }

    // Checked, not fired and forgotten. This returns false rather than throwing,
    // so discarding it let a workspace that never rendered carry on into the
    // test, where it surfaces much later as something unrelated — a peer
    // 'missing' from the sidebar, or a seven-minute group-call timeout whose
    // log says only that it was waiting.
    if (!(await waitForWorkspaceLoaded(page, 30_000))) {
        throw new Error(`Workspace never finished loading for ${username}`);
    }
    await closeAnyModals(page);

    return { context, page, username, password };
}

/* ── Exported fixtures ── */

/**
 * `authenticatedTest` — provides an authenticated page with a registered user.
 *
 * Usage:
 * ```ts
 * import { authenticatedTest as test } from '../fixtures/base.fixture.js';
 *
 * test('my test', async ({ authenticatedPage, username }) => {
 *   // authenticatedPage is logged in and workspace is loaded
 * });
 * ```
 */
export const authenticatedTest = base.extend<AuthFixture>({
    authBrowser: async ({ }, use) => {
        const browser = await launchBrowser();
        await use(browser);
        await browser.close();
    },

    authContext: async ({ authBrowser }, use) => {
        const context = await authBrowser.newContext({ storageState: undefined });
        await context.clearCookies();
        await use(context);
        await context.close();
    },

    authenticatedPage: async ({ authBrowser }, use) => {
        const { context, page, } = await setupAuthenticatedPage(authBrowser);
        await use(page);
        await context.close();
    },

    username: async ({ authenticatedPage: _page }, use) => {
        // Username is set during authenticatedPage setup — we need a different approach.
        // This is a placeholder; actual username comes from the setup flow.
        // Consumers should use the diagnosticsTest for full access.
        await use('');
    },

    password: async ({ }, use) => {
        await use(config.DEFAULT_PASSWORD);
    },
});

/**
 * `diagnosticsTest` — extends authenticatedTest with console capture + white-screen detection.
 *
 * Usage:
 * ```ts
 * import { diagnosticsTest as test } from '../fixtures/base.fixture.js';
 *
 * test('my test', async ({ authenticatedPage, diagnostics, uxTracker }) => {
 *   // diagnostics auto-captures console errors
 *   // uxTracker logs UX issues
 * });
 * ```
 */
export const diagnosticsTest = authenticatedTest.extend<DiagnosticsFixture>({
    diagnostics: async ({ authenticatedPage }, use) => {
        const handle = await startDiagnostics(authenticatedPage, {
            realTimePrint: true,
            realTimeOnlyErrors: true,
        });
        await use(handle);
        await handle.stop();
    },

    uxTracker: async ({ }, use) => {
        const tracker = new UxIssueTracker();
        await use(tracker);
        // Print issues at end
        const issues = tracker.getIssues();
        if (issues.length > 0) {
            console.log('\n── UX Issues Found ──');
            issues.forEach((issue, i) => {
                console.log(`  ${i + 1}. [${issue.severity.toUpperCase()}] ${issue.category}: ${issue.description}`);
            });
        }
    },
});

export { config };
