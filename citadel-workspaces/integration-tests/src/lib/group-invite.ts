/**
 * Joining a peer group as an invitee.
 *
 * An invitation waits in the sidebar for Accept or Decline (UI f40d9496); it
 * used to be accepted on arrival, and specs written then looked for the group
 * row straight away -- which, since that change, never appears unasked.
 *
 * Waits with `locator.waitFor`, never `isVisible({timeout})`, which returns at
 * once (see memory: playwright-isvisible-timeout-never-waits). Throws, so a
 * missing invitation fails the step that needed it rather than a later one.
 */
import type { Page } from 'playwright';

export async function acceptGroupInvitation(page: Page, groupId: string, timeoutMs: number): Promise<void> {
  const invite = page.locator(`[data-testid="group-invite-row"][data-group-id="${groupId}"]`);
  await invite.waitFor({ state: 'visible', timeout: timeoutMs });
  await invite.getByTestId('group-invite-accept').click();
  await page.getByTestId(`group-row-${groupId}`).waitFor({ state: 'visible', timeout: timeoutMs });
}
