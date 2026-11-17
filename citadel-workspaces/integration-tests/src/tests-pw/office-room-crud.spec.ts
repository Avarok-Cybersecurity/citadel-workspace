/**
 * Office & Room CRUD — Playwright Test spec
 *
 * Tests workspace structure management: create, read, update, delete
 * for offices and rooms.
 */

import { test, expect } from '@playwright/test';
import { chromium, type Page, type Browser, type BrowserContext } from 'playwright';
import {
    clearBrowserStorage,
    waitForAppReady,
    waitForWorkspaceLoaded,
    closeAnyModals,
    createOfficeViaUI,
    createRoomViaUI,
    deleteNodeViaUI,
    nodeExistsInUI,
    nodeGoneFromUI,
    hasWorkspaceAdmin,
    adminCredentials,
    loginAfterDisconnect,
    navigateToOfficeViaUI,
    isHeaded,} from '../lib/index.js';
import { config, isCI } from '../lib/config.js';

/* ── Shared state ── */

const timestamp = Date.now();

let browser: Browser;
let context: BrowserContext;
let page: Page;

const OFFICE_NAME = `Test Office ${timestamp}`;
const ROOM_NAME = `Test Room ${timestamp}`;

/* ── Test Suite (serial) ── */

test.describe.serial('Office & Room CRUD', () => {
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

        // Log in as the admin global-setup registered, rather than registering a
        // fresh account here. Only the account that initialises the workspace gets
        // EditTreeStructure, so a spec that registers its own user is an admin only
        // if it happened to run first — which made this spec pass alone and fail in
        // the suite, purely on alphabetical filename order.
        const admin = adminCredentials();

        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await clearBrowserStorage(page);
        await waitForAppReady(page, 60_000);

        const loggedIn = await loginAfterDisconnect(
            page,
            admin.username,
            admin.password,
            null,
            config.WORKSPACE_SERVER
        );
        expect(loggedIn, `Could not log in as the workspace admin (${admin.username})`).toBe(true);

        // Checked, not fired and forgotten: this returns false rather than
        // throwing, so ignoring it let a workspace that never loaded run the
        // whole block and fail later somewhere unrelated.
        expect(
          await waitForWorkspaceLoaded(page, 30_000),
          'the workspace should finish loading',
        ).toBe(true);
        await closeAnyModals(page);

        // global-setup registered the workspace admin. Assert we actually have
        // one: when the server already held a workspace from an earlier run, its
        // account joined as an ordinary member and node creation would be denied.
        // Saying so here names the cause — test isolation — instead of surfacing
        // it later as a server permission error.
        expect(
            hasWorkspaceAdmin(),
            'No workspace admin for this run: the server already held a workspace, so ' +
            'global-setup registered an ordinary member and node creation will be ' +
            'denied with "Permission denied: EditTreeStructure required". Reset with ' +
            '`docker compose down && docker compose up -d`.'
        ).toBe(true);
    });

    test.afterAll(async () => {
        await browser.close();
    });

    test('Create an office', async () => {
        const created = await createOfficeViaUI(page, OFFICE_NAME);
        // .success, not the object: createOfficeViaUI returns { success, name },
        // and an object is always truthy — so `expect(created).toBeTruthy()`
        // passed even when creation had failed, which is why this spec's real
        // failure only surfaced one assertion later.
        expect(created.success).toBe(true);

        // Verify it appears in the sidebar
        const exists = await nodeExistsInUI(page, OFFICE_NAME);
        expect(exists).toBe(true);
    });

    test('Navigate to the office', async () => {
        // The helper's answer, and then the office itself.
        //
        // This discarded the boolean and asserted `url.includes('/workspace')`,
        // which was ALREADY TRUE before the click: login waits for `/workspace`,
        // and the office view lives under that same route. Deleting the sidebar
        // node's onClick left this green.
        const navigated = await navigateToOfficeViaUI(page, OFFICE_NAME);
        expect(navigated, `navigateToOfficeViaUI could not reach ${OFFICE_NAME}`).toBe(true);

        // What actually distinguishes "the office is open" from "we are still
        // wherever login left us": its name on the page.
        await expect(page.getByText(OFFICE_NAME, { exact: false }).first()).toBeVisible({
            timeout: 30_000,
        });
    });

    test('Create a room inside the office', async () => {
        // Signature is (page, name, description, parentName). Without parentName the
        // helper uses whichever node is selected, so the parent is named here
        // rather than left to whatever the previous test happened to select.
        const created = await createRoomViaUI(page, ROOM_NAME, '', OFFICE_NAME);
        // `.success`, not the object. `createRoomViaUI` returns
        // `{ success, name }`, and an object is always truthy -- so
        // `expect(created).toBeTruthy()` held even when the helper reported
        // failure. The comment twelve lines up documents this exact trap for the
        // sibling call; it had not been applied here.
        expect(created.success, `createRoomViaUI failed for ${ROOM_NAME}`).toBe(true);

        const exists = await nodeExistsInUI(page, ROOM_NAME);
        expect(exists).toBe(true);
    });

    test('Delete the room', async () => {
        // .success, not the object: deleteNodeViaUI returns { success, cascaded },
        // and comparing an object to `true` can never pass.
        const deleted = await deleteNodeViaUI(page, ROOM_NAME);
        expect(deleted.success).toBe(true);

        // Wait for it to be gone rather than polling "does it exist" and expecting
        // false, which spends the whole appearance timeout waiting for something
        // that will never appear.
        expect(await nodeGoneFromUI(page, ROOM_NAME)).toBe(true);
    });

    test('Delete the office', async () => {
        const deleted = await deleteNodeViaUI(page, OFFICE_NAME);
        expect(deleted.success).toBe(true);
        expect(await nodeGoneFromUI(page, OFFICE_NAME)).toBe(true);
    });
});
