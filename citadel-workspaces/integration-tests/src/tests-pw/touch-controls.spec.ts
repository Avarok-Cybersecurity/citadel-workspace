/**
 * Row actions have to be operable on a touch device.
 *
 * Eight controls were written as `opacity-0 group-hover:opacity-100`. On a
 * phone there is no hover, so the reveal never fires and the control is not
 * hard to find but unreachable — that took Edit, Admin Settings and Delete off
 * the node tree, and reply/edit/delete off every message, for anyone using the
 * installed PWA.
 *
 * Nothing caught it because every check ran a desktop browser with a mouse.
 * axe saw an element that was present and labelled; the tap-target and overflow
 * scans measured geometry, and the geometry was fine — the element was laid
 * out, merely transparent. Even the 375px screenshots were captured by a
 * browser reporting `hover: hover`, so they showed desktop behaviour at phone
 * width. Resizing a window does not make a phone.
 *
 * So this emulates touch properly and asserts the control can actually be
 * operated, rather than photographing it.
 */
import { test, expect } from '@playwright/test';
import {
    clearBrowserStorage,
    waitForAppReady,
    createAccount,
    waitForWorkspaceLoaded,
    closeAnyModals,
    config,
    navigateToOffice,
    switchToChatTab,
    sendGroupMessage,
    setupConsoleCapture,
} from '../lib/index.js';
import { RUN_DIAGNOSTIC_KEYWORDS } from '../lib/composer-diagnostics.js';

test('node actions are reachable on a touch device', async ({ browser }) => {
    test.setTimeout(300_000);

    const context = await browser.newContext({
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
    });
    const page = await context.newPage();
    // Without this the app's own account of a failure goes nowhere: when this
    // test's send failed in CI, `OfficeChatTabs` had logged exactly which
    // permission state removed the composer, and the run showed only
    // "Message input not found".
    setupConsoleCapture(page, 'touch', [...RUN_DIAGNOSTIC_KEYWORDS]);

    try {
        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await clearBrowserStorage(page);
        await page.reload({ waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 60_000);

        // The premise, asserted rather than assumed. Without touch emulation
        // Chromium reports `hover: hover` even in a 375px window, the fade-out
        // applies exactly as it does on a desktop, and this spec would pass
        // while proving nothing about a phone.
        const pointer = await page.evaluate(() => ({
            hover: window.matchMedia('(hover: hover)').matches,
            fine: window.matchMedia('(pointer: fine)').matches,
        }));
        expect(
            pointer,
            'the context is not emulating touch, so this spec cannot test what it claims to',
        ).toEqual({ hover: false, fine: false });

        const user = `touch_${Date.now()}`;
        expect(
            await createAccount(page, user, { isFirstUser: true, password: config.DEFAULT_PASSWORD }),
            'account creation should succeed',
        ).toBe(true);
        expect(await waitForWorkspaceLoaded(page, 90_000), 'the workspace should load').toBe(true);
        await closeAnyModals(page);

        // At phone width the sidebar is collapsed behind the hamburger, which is
        // correct: the tree is not on screen until it is opened. Tapping it is
        // part of the journey being tested, not a workaround for it.
        const sidebarToggle = page.getByTestId('sidebar-toggle');
        await expect(sidebarToggle, 'the sidebar toggle should be present at phone width').toBeVisible({
            timeout: 30_000,
        });
        await sidebarToggle.tap();

        const trigger = page.locator('[data-testid^="tree-node-menu-"]').first();
        await expect(trigger, 'the node tree should render once the sidebar is open').toBeAttached({
            timeout: 60_000,
        });

        // checkVisibility({opacityProperty}), not toBeVisible() and not the
        // element's own computed opacity.
        //
        // Playwright reports a fully transparent element as visible, so
        // toBeVisible() passed against the broken code. Reading the element's
        // OWN opacity is wrong too: opacity is not inherited as a computed
        // value, so a button inside a transparent wrapper still reports 1. That
        // mistake made the message-actions test below pass against the very CSS
        // it was written to reject — the class sits on the wrapper there, not
        // the button. checkVisibility walks the ancestors, which is what
        // "can a person see this" actually depends on.
        const seen = await trigger.evaluate((el) =>
            el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        expect(
            seen,
            'the node actions button is invisible on a touch device — it is revealed by hover, which a phone does not have',
        ).toBe(true);

        // And it works when tapped, without the force: true that would paper
        // over an element nothing can reach.
        await trigger.tap();
        await expect(
            page.locator('[role="menu"]'),
            'tapping the node actions button should open its menu',
        ).toBeVisible({ timeout: 10_000 });
    } finally {
        await context.close();
    }
});

/**
 * Message actions are the most-used of the eight controls that were revealed by
 * hover alone, and were the least verified: reply, edit and delete sit on EVERY
 * message and were unreachable on a phone entirely.
 *
 * Covered through the office chat rather than a P2P conversation because it
 * needs one account instead of two peers and a negotiated channel — the control
 * under test is the same either way. `TextBubble` (P2P) and `GroupMessageItem`
 * (group/office) both label the trigger "Message actions", so this selector
 * exercises the shared affordance.
 */
test('message actions are reachable on a touch device', async ({ browser }) => {
    test.setTimeout(300_000);

    const context = await browser.newContext({
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
    });
    const page = await context.newPage();

    try {
        await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
        await clearBrowserStorage(page);
        await page.reload({ waitUntil: 'commit', timeout: 60_000 });
        await waitForAppReady(page, 60_000);

        const pointer = await page.evaluate(() => ({
            hover: window.matchMedia('(hover: hover)').matches,
            fine: window.matchMedia('(pointer: fine)').matches,
        }));
        expect(pointer, 'the context is not emulating touch').toEqual({ hover: false, fine: false });

        const user = `tmsg_${Date.now()}`;
        expect(
            await createAccount(page, user, { isFirstUser: true, password: config.DEFAULT_PASSWORD }),
            'account creation should succeed',
        ).toBe(true);
        expect(await waitForWorkspaceLoaded(page, 90_000), 'the workspace should load').toBe(true);
        await closeAnyModals(page);

        // The sidebar is collapsed at this width; opening it is part of the
        // journey, as it is for the node tree.
        // Waited for, not sampled: a one-shot isVisible() ran before the toggle
        // mounted, never tapped it, and the tree stayed in the closed drawer.
        const sidebarToggle = page.getByTestId('sidebar-toggle');
        await expect(sidebarToggle, 'the sidebar toggle should be present at phone width').toBeVisible({
            timeout: 30_000,
        });
        await sidebarToggle.tap();
        await expect(
            page.getByTestId('tree-search-toggle').or(page.getByTestId('tree-empty')).first(),
            'the tree should be on screen once the sidebar is open',
        ).toBeVisible({ timeout: 30_000 });

        expect(await navigateToOffice(page, user, 'General'), 'should reach the General office').toBe(true);
        expect(await switchToChatTab(page, user), 'should open the office Chat tab').toBe(true);

        const text = `touch reachability ${Date.now()}`;
        expect(await sendGroupMessage(page, user, text), 'the message should send').toBe(true);
        // In the transcript: the composer's textarea holds the same text until it is sent.
        await expect(page.getByTestId('group-chat-view').getByText(text).first(), 'the message should render').toBeVisible({
            timeout: 60_000,
        });

        const actions = page.getByRole('button', { name: 'Message actions' }).first();
        await expect(actions, 'every message should carry an actions control').toBeAttached({
            timeout: 30_000,
        });

        // checkVisibility, for the reason spelled out in the node test above:
        // the transparency lives on this control's WRAPPER, so reading the
        // button's own opacity reports 1 no matter how hidden it is.
        const seen = await actions.evaluate((el) =>
            el.checkVisibility({ opacityProperty: true, visibilityProperty: true }));
        expect(
            seen,
            'the message actions control is invisible on a touch device — reply, edit and delete are unreachable on a phone',
        ).toBe(true);

        await actions.tap();
        await expect(
            page.getByRole('menuitem', { name: /Reply/i }),
            'tapping message actions should open the menu',
        ).toBeVisible({ timeout: 10_000 });
    } finally {
        await context.close();
    }
});
