/**
 * A workspace must never be left without an administrator.
 *
 * The admin panel offers "remove member" and a role dropdown on every row,
 * including the acting user's own. With one administrator — which is every
 * workspace that has not deliberately appointed a second — either control put
 * the workspace one click away from having nobody able to manage it, and there
 * is no way back: promotion requires an admin. That is the same unrecoverable
 * state that made the product read-only for everyone before joining users were
 * promoted, except reached deliberately and permanently.
 *
 * The rule lives on the server, which is what actually decides. This spec
 * checks the affordance and, by promoting a second admin, checks that the rule
 * is about the NUMBER of administrators rather than about who is acting — a
 * guard that merely stopped you editing your own row would still allow two
 * admins to remove each other down to none.
 */
import { expect } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import { adminDialog, openAdminPanel, activateAdminTab } from '../lib/index.js';

adminMemberTest('the last administrator cannot be demoted or removed', async ({ admin, member }) => {
    adminMemberTest.setTimeout(300_000);

    expect(await openAdminPanel(admin.page), 'the admin should be able to open Admin Settings').toBe(true);
    expect(await activateAdminTab(admin.page, 'members'), 'the Members tab should render').toBe(true);

    const dialog = adminDialog(admin.page);
    const adminRemove = dialog.locator(`[data-testid="member-remove-${admin.username}"]`);
    const adminRoleSelect = dialog.locator(`[data-testid="member-role-select-${admin.username}"]`);

    await expect(adminRemove, 'the admin row should be listed').toBeVisible({ timeout: 30_000 });
    await expect(
        adminRemove,
        'the only administrator can be removed, which would leave the workspace unmanageable',
    ).toBeDisabled();

    // The demotion route to the same dead end.
    await adminRoleSelect.click();
    await expect(
        admin.page.getByRole('option', { name: 'Member', exact: true }),
        'the only administrator can be demoted to Member, reaching the same dead end by another route',
    ).toBeDisabled();
    await admin.page.keyboard.press('Escape');

    // With a second administrator the restriction lifts — proving it counts
    // admins rather than forbidding self-service.
    const memberRoleSelect = dialog.locator(`[data-testid="member-role-select-${member.username}"]`);
    await expect(memberRoleSelect, `no row for ${member.username}`).toBeVisible({ timeout: 30_000 });
    await memberRoleSelect.click();
    await admin.page.getByRole('option', { name: 'Admin', exact: true }).click();
    await expect(admin.page.getByText(/role updated to Admin/i).first()).toBeVisible({ timeout: 30_000 });

    await expect(
        adminRemove,
        'with two administrators the workspace can spare one, so the control should be available again',
    ).toBeEnabled({ timeout: 30_000 });
});
