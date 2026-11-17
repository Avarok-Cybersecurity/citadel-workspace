/**
 * The permission matrix has to fit the phone it is shown on.
 *
 * It is the widest thing in the product — a label column plus one column per
 * role — and at 375px it rendered wider than the viewport and horizontally
 * centred, so it was clipped on BOTH sides: the entire PERMISSION column was off
 * screen to the left and Guest off screen to the right. What an administrator
 * saw was a grid of checkmarks with no way to tell which permission any row
 * belonged to, and no way to scroll to find out.
 *
 * The cause is the flex/grid `min-width: auto` default. `DialogContent` is a
 * grid whose width is `calc(100% - 2rem)`, but a grid item may not shrink below
 * its content's min-content width unless told to, so the table's ~620px forced
 * the panel past the screen edges instead of scrolling inside its own
 * `overflow-auto` container. The same default is called out in TopBar, where it
 * pushed the avatar off a 375px viewport.
 *
 * This measures geometry rather than photographing it: a screenshot shows the
 * problem to a human, a bounding box fails a build.
 *
 * The member row's Permissions button now opens the one-member editor rather
 * than the matrix, so that is what is measured here; the matrix keeps the same
 * guard in the polish harness (`roleMatrixFitsThePhone`).
 */
import { expect } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { adminDialog, openAdminPanel, activateAdminTab } from '../lib/index.js';

const PHONE = { width: 375, height: 667 };

adminMemberTest('one member’s permission editor stays inside a 375px viewport', async ({ admin }) => {
    adminMemberTest.setTimeout(300_000);
    const page = admin.page;

    await page.setViewportSize(PHONE);
    // Settle before touching the sidebar: useIsMobile reads window.innerWidth
    // from a media-query listener, so immediately after a resize it still
    // reports desktop and the toggle collapses the desktop sidebar instead of
    // opening the mobile sheet.
    await page.waitForTimeout(1000);

    const treeNode = page.locator('[data-testid^="tree-node-menu-"]').first();
    const sidebarToggle = page.getByTestId('sidebar-toggle');
    for (let attempt = 0; attempt < 3; attempt++) {
        if (await treeNode.isVisible().catch(() => false)) break;
        await sidebarToggle.click({ force: true });
        await page.waitForTimeout(1200);
    }

    expect(await openAdminPanel(page), 'Admin Settings should open at phone width').toBe(true);
    expect(await activateAdminTab(page, 'members'), 'the Members tab should render').toBe(true);

    const dialog = adminDialog(page);

    // The row's controls before the matrix: a member row is a long username on
    // the left and the controls on the right, and without truncation the name
    // pushed the role selector and remove button straight off the screen. They
    // are the reason the row exists, so they are what must survive.
    const roleSelect = dialog.locator('[data-testid^="member-role-select-"]').first();
    const removeButton = dialog.locator('[data-testid^="member-remove-"]').first();
    await expect(roleSelect, 'the role selector should be rendered').toBeVisible({ timeout: 30_000 });
    await expect(
        roleSelect,
        'the role selector is off screen at 375px — a long username pushed it out of the row',
    ).toBeInViewport();
    await expect(
        removeButton,
        'the remove control is off screen at 375px',
    ).toBeInViewport();

    // Reachable controls acting on an unidentifiable person is not a fix. With
    // the row side by side at 375px the controls took ~180px of ~295 and the
    // name rendered as a single character plus an ellipsis, so the row stacks
    // below `sm` instead.
    //
    // Measured as scrollWidth vs clientWidth, NOT by reading the text. An
    // earlier version of this asserted innerText contained the username and
    // passed against the squeezed row: `text-overflow: ellipsis` paints an
    // ellipsis without touching the DOM, so the full string is still there to
    // read. The assertion was true of a layout no one could use — which is the
    // failure it was written to catch.
    const nameEl = dialog.locator('[data-testid^="member-row-"]').first().locator('.font-medium').first();
    const nameFit = await nameEl.evaluate((el) => ({
        scroll: el.scrollWidth,
        client: el.clientWidth,
        text: el.textContent ?? '',
    }));
    expect(
        nameFit.scroll,
        `"${nameFit.text}" is clipped to ${nameFit.client}px of ${nameFit.scroll}px — ` +
        'the member name is truncated past the point of identifying anyone',
    ).toBeLessThanOrEqual(nameFit.client + 1);

    const advanced = dialog.getByTestId('members-advanced-toggle');
    await expect(advanced, 'the advanced permissions toggle should be present').toBeVisible({
        timeout: 30_000,
    });
    await advanced.click({ force: true });

    // The row's Permissions button opens the ONE-member editor now, not the role
    // matrix: the matrix answered a question about one person with four role
    // columns. The matrix's own 375px containment is measured in the polish
    // harness (checks-permissions.mjs, roleMatrixFitsThePhone), where it is
    // reached without a backend; this spec measures what this button opens.
    const openEditor = dialog.locator('[data-testid^="member-permissions-"]').first();
    await expect(openEditor, 'the Permissions button should appear').toBeVisible({ timeout: 30_000 });
    await openEditor.click({ force: true });

    const editor = page.getByTestId('member-permissions-dialog');
    await expect(editor, 'the member’s permission editor should open').toBeVisible({ timeout: 30_000 });

    // Nothing may sit outside the screen. One pixel of tolerance for subpixel
    // rounding on the centring transform.
    const box = await editor.boundingBox();
    expect(box, 'the editor should have a box to measure').not.toBeNull();
    expect(box!.x, 'the editor starts off the left edge of the screen').toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width, 'the editor extends past the right edge of the screen').toBeLessThanOrEqual(PHONE.width + 1);

    // By testid, not by words (see the history above): a label is copy and changes.
    // Horizontal bounds only; where a row falls vertically is ordinary scrolling.
    const permissionRow = page.getByTestId('member-permission-row-EditMdx');
    await expect(permissionRow, 'the permission row should render once every level answers').toBeAttached({ timeout: 30_000 });
    await permissionRow.scrollIntoViewIfNeeded();
    const row = await permissionRow.boundingBox();
    expect(row, 'the permission row should have a box').not.toBeNull();
    expect(row!.x, 'the permission row starts off the left edge').toBeGreaterThanOrEqual(-1);
    expect(row!.x + row!.width, 'the permission row runs past the right edge').toBeLessThanOrEqual(PHONE.width + 1);

    // The invariant, measured on the editor itself: it must not scroll sideways.
    const overflow = await editor.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    expect(
        overflow.scroll,
        `the editor scrolls horizontally (${overflow.scroll}px of content in ${overflow.client}px)`,
    ).toBeLessThanOrEqual(overflow.client + 1);
});
