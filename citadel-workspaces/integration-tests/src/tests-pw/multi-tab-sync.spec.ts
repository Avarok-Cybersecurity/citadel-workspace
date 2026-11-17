/**
 * Multi-Tab Synchronization — Playwright Test spec
 *
 * Tests the multi-tab leader/follower pattern (Section 6 in TESTING_CHECKLIST.md).
 * Previously marked "Not yet tested".
 *
 * Tests:
 * 1. Open app in two tabs within the same browser context
 * 2. Login in first tab → verify second tab syncs
 * 3. Test leader/follower tab behavior
 * 4. Close leader tab → verify follower takes over
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
    sleep, isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';

/* ── Shared state ── */

const timestamp = Date.now();
const USERNAME = `pw_multitab_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

let browser: Browser;
let context: BrowserContext;
let tab1: Page;
let tab2: Page;

/* ── Test Suite (serial) ── */

test.describe.serial('Multi-Tab Synchronization', () => {
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

        // SINGLE context — both tabs share storage and websocket
        context = await browser.newContext({ storageState: undefined });
        await context.clearCookies();
    });

    test.afterAll(async () => {
        await browser.close();
    });

    test('Register user in Tab 1', async () => {
        tab1 = await context.newPage();
        await tab1.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await clearBrowserStorage(tab1);
        await waitForAppReady(tab1, 60_000);

        const registered = await createAccount(tab1, USERNAME, {
            isFirstUser: true,
            password: PASSWORD,
            uxTracker: null,
        });
        expect(registered).toBe(true);

        // Checked, not fired and forgotten: this returns false rather than
        // throwing, so ignoring it let a workspace that never loaded run the
        // whole block and fail later somewhere unrelated.
        expect(
          await waitForWorkspaceLoaded(tab1, 30_000),
          'the workspace should finish loading',
        ).toBe(true);
        await closeAnyModals(tab1);
    });

    test('Open Tab 2 — should detect existing session', async () => {
        // KNOWN FAILING, deliberately not silenced.
        //
        // This assertion used to include `seesLandingButtons` in its
        // disjunction — which IS the not-detected state — so a test named
        // "should detect existing session" passed precisely when the session
        // was not detected. Strengthening it surfaced a real product bug:
        // a second tab in the same browser context, opened seconds after the
        // first registered and loaded a workspace, shows the logged-out landing
        // page with no "Active Sessions" strip. Verified by screenshot.
        //
        // test.fail() rather than skip: the assertion still runs, and Playwright
        // reports a FAILURE if it ever starts passing, so whoever fixes the bug
        // is told to remove this annotation. Skipping would lose the detection
        // again, and deleting the assertion would restore the false green.
        //
        // A bounded retry was added to OrphanSessionsNavbar (an empty result
        // during startup is not evidence of no sessions) and did NOT resolve it,
        // so the cause is not first-paint timing. Recorded in docs/ROBUSTNESS.md.
        // test.fail() removed to verify the fix

        tab2 = await context.newPage();
        await tab2.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(tab2, 60_000);

        // Tab 2 should see the existing session in the OrphanSessionsNavbar
        // or be redirected to the workspace since the context shares storage
        await sleep(3000);

        // Check if tab2 sees the session or is on workspace
        const url = tab2.url();
        const onWorkspace = url.includes('/workspace') || url.includes('/office');
        // By testid, not by the button's title. The title is
        // `${full_name || username} - ${workspaceName}`, and it contains the
        // username here only because `createAccount` happens to fill the full
        // name WITH the username. Any account named like a person -- which is
        // every real one -- would not match, and this test's entire conclusion
        // rests on this read. That is a coincidence to depend on, not a
        // locator.
        //
        // It does NOT explain the failure below: full name and username are
        // the same string for this account, so the old locator would have
        // matched. The known bug stands.
        const seesSession = await isVisibleWithin(
            tab2.getByTestId(`session-button-${USERNAME}`),
            5000,
        );
        // `seesLandingButtons` used to be part of this disjunction — and it IS
        // the not-detected state, so a test named "should detect existing
        // session" passed precisely when the session was NOT detected. It now
        // appears only as the thing that must not be the whole story.
        expect(
            onWorkspace || seesSession,
            'Tab 2 should reach the workspace or show the existing session, not the logged-out landing page'
        ).toBe(true);
    });

    test('Tab 2 can access workspace state from shared storage', async () => {
        // The shared browser context means Tab 2 has access to the same
        // localStorage, IndexedDB, and cookies as Tab 1
        await tab2.bringToFront();
        await sleep(1000);

        // `keys.length > 0` was satisfied by any boot-time key — theme, sidebar
        // state — so this asserted nothing about Tab 1's registration. Tie it
        // to a key this app actually writes for a session.
        const sessionKeys = await tab2.evaluate(() =>
            Object.keys(localStorage).filter((k) => k.startsWith('citadel'))
        );

        expect(
            sessionKeys,
            "Tab 2 should see Tab 1's citadel state through the shared context"
        ).not.toHaveLength(0);
    });

    test('Close Tab 1 (leader) — Tab 2 should remain functional', async () => {
        // KNOWN FAILING, downstream of the same root cause as the session-detection
        // test above: Tab 2 cannot see Tab 1's session, so it cannot reach the
        // workspace after taking over either.
        //
        // The previous assertion was `expect(document.readyState).toBeTruthy()`,
        // which is always one of three truthy strings — it asserted only that the
        // tab had not crashed, and said nothing about leader re-election, the
        // entire subject of the test. Reaching the workspace is the smallest
        // thing that actually requires the WebSocket this tab must now own.
        // test.fail() removed to verify the fix

        // Close Tab 1
        await tab1.close();
        await sleep(2000);

        // Tab 2 should still be responsive
        await tab2.bringToFront();
        await sleep(1000);

        // `document.readyState` is always one of three truthy strings, so this
        // asserted only that the tab had not crashed — saying nothing about
        // leader re-election, which is the entire subject of the test.
        //
        // A surviving tab must still be able to REACH the internal service —
        // that is what taking over the leadership means. Listing sessions is
        // exactly that round trip, and it is a request this tab previously
        // proxied through the tab that just closed.
        //
        // Deliberately NOT "tab 2 lands in a workspace": it never selected a
        // session, so navigating there would legitimately redirect to /connect.
        // Asserting that would be testing the wrong thing, and an earlier
        // version of this test did.
        await tab2.reload({ waitUntil: 'commit' });
        await waitForAppReady(tab2, 60_000);

        const stillSeesSession = await isVisibleWithin(
            tab2.locator('[data-testid="previous-sessions-navbar"]'),
            30000
        );

        expect(
            stillSeesSession,
            'after the leader closed, Tab 2 should take over the socket and still list the session'
        ).toBe(true);
    });

    test('Tab 2 can navigate independently after leader closes', async () => {
        // Navigate Tab 2 to the landing page
        await tab2.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 30_000 });
        await waitForAppReady(tab2, 30_000);

        // Should see either workspace loaded or landing page buttons
        // A web-first assertion, not isVisible: this is an ASSERTION, and
        // isVisible returns immediately (its timeout option is declared
        // deprecated and ignored), so on a loaded runner this failed whenever
        // the render had not landed yet. toBeVisible retries until the timeout.
        await expect(
            tab2.locator('button:has-text("Create Account"), button:has-text("Sign In"), [data-sidebar="sidebar"]').first()
        ).toBeVisible({ timeout: 10_000 });
    });
});
