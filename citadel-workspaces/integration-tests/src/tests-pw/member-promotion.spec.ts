/**
 * Promoting a member has to actually give them the rights of the new role.
 *
 * The role model is a hierarchy — Member reads, Owner and Admin edit — and the
 * admin panel is the only way to move someone up it. Nothing tested that the
 * move had any effect. `tests/member-management.test.ts` asserts the role
 * dropdown is *visible* and stops there, so `UpdateMemberRole` could have been
 * a no-op, or could have set the role without applying the role's permissions,
 * and the suite would have stayed green.
 *
 * It could not have been tested before, either: no account in a deployed
 * workspace was ever an administrator, so nobody could reach this panel. Two
 * defects fell out of fixing that, both of which this spec would have caught —
 * Owner did not carry EditMdx, so a promoted member still could not edit, and
 * Owner lacked ViewContent and SendMessages, so promotion actively took
 * capability away.
 *
 * The member reloads before the second assertion. That is deliberate and not a
 * hidden weakness: the claim under test is that the *server* grants the rights,
 * and there is no push of a role change to an open session. Live propagation of
 * a role change would be a separate feature and a separate spec.
 */
import { expect } from '@playwright/test';
import { adminMemberTest } from '../fixtures/multi-user.fixture.js';
import {
    adminDialog,
    openAdminPanel,
    activateAdminTab,
    waitForWorkspaceLoaded,
    closeAnyModals,
} from '../lib/index.js';
import type { Page } from '@playwright/test';

const editButton = (page: Page) => page.getByTestId('office-edit-content').first();

adminMemberTest('promoting a member to Owner gives them editing rights', async ({ admin, member }) => {
    adminMemberTest.setTimeout(300_000);

    // Baseline. If this ever fails the spec proves nothing afterwards, because
    // "the button is enabled" would have been true before the promotion too.
    await expect(
        editButton(member.page),
        'a plain member should not be able to edit — Member holds no EditContent or EditMdx by design',
    ).toBeDisabled({ timeout: 60_000 });

    expect(await openAdminPanel(admin.page), 'the admin should be able to open Admin Settings').toBe(true);
    expect(await activateAdminTab(admin.page, 'members'), 'the Members tab should render').toBe(true);

    // Keyed by username: user_id is the username throughout the backend, so this
    // targets one specific person rather than whichever row happens to be first.
    const roleSelect = adminDialog(admin.page).locator(
        `[data-testid="member-role-select-${member.username}"]`,
    );
    await expect(
        roleSelect,
        `no row for ${member.username} — the member list did not include the second account`,
    ).toBeVisible({ timeout: 30_000 });

    await roleSelect.click();
    await admin.page.getByRole('option', { name: 'Owner', exact: true }).click();

    // The panel confirms the write before we go looking for its effect.
    await expect(admin.page.getByText(/role updated to Owner/i).first()).toBeVisible({ timeout: 30_000 });

    await member.page.reload({ waitUntil: 'commit' });
    expect(await waitForWorkspaceLoaded(member.page, 60_000), 'the member workspace should reload').toBe(true);
    await closeAnyModals(member.page);

    await expect(
        editButton(member.page),
        'the promoted member still cannot edit — the new role granted no EditMdx',
    ).toBeEnabled({ timeout: 60_000 });
});
