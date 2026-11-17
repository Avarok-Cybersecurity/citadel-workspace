/**
 * Shared steps for the messaging trust specs. Not a spec: Playwright collects only `*.spec.ts`.
 * It lives beside them rather than in `lib/` because it asserts, as call-helpers.ts does.
 */
import { expect, type Page } from '@playwright/test';

export type WorkspaceTrust = 'Strict' | 'AllTrusted';

/**
 * Click `peerUsername` in the sidebar's member list until their chat opens.
 *
 * The sidebar shows the first few members, then "View all N members": on the shared CI backend a
 * new account is rarely among the first few, so it is clicked in the full list when not listed.
 * Retried, not slept: a member only opens a chat once the agent has listed them (the registry
 * poll trails a new account by 15-20s); before that the click says the member is unreachable.
 */
export async function openChatFromMemberList(page: Page, peerUsername: string): Promise<void> {
  const row = page.getByTestId(`member-row-${peerUsername}`);
  const viewAll = page.getByTestId('members-view-all');
  await expect(row.or(viewAll), `${peerUsername} should be listed, or the list should offer all members`).toBeVisible({ timeout: 60_000 });
  const fullList: boolean = !(await row.isVisible());
  await expect(async (): Promise<void> => {
    if (fullList) {
      if (!(await page.getByTestId(`all-members-open-${peerUsername}`).isVisible())) await viewAll.click();
      await page.getByTestId(`all-members-open-${peerUsername}`).click({ timeout: 5_000 });
    } else {
      await row.click();
    }
    await expect(page.getByTestId('p2p-chat')).toBeVisible({ timeout: 5_000 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 5_000] });
}

/** Set the workspace's messaging trust from Workspace settings, as an admin, and close it. */
export async function setWorkspaceTrust(page: Page, trust: WorkspaceTrust): Promise<void> {
  await page.getByTestId('open-workspace-settings').click();
  const dialog = page.getByTestId('workspace-settings-dialog');
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  const option = dialog.getByTestId(`trust-choice-workspace-${trust}`);
  // Enabled once the server has said what it holds.
  await expect(option).toBeEnabled({ timeout: 30_000 });
  if ((await option.getAttribute('aria-checked')) !== 'true') await option.click();
  // The radio follows the server's answer, so checked means stored.
  await expect(option).toHaveAttribute('aria-checked', 'true', { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 10_000 });
}
