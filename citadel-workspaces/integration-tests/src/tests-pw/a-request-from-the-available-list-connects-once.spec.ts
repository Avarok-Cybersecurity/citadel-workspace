/**
 * A request sent by clicking someone in the Messages page's Available list is a
 * real request: it is recorded as ours, the peer's answer is recognised as the
 * answer to it, and the two end up connected -- dialled once from each side.
 *
 * The click used to build its own PeerRegister, which recorded nothing. With
 * "Requests From Strangers" off, the peer's answer then met
 * `weAskedThemFirst === false` and was declined as a stranger's, and the click
 * announced the peer as registered before they had answered.
 * (Unit-level: src/lib/p2p/__tests__/a-click-request-is-a-real-request.test.ts.)
 *
 * Strict trust, so the workspace policy does not accept the answer for us and
 * the stranger rule is what decides it. Both settings are restored in `finally`:
 * every spec in a shard shares one backend, and the rest assume the defaults.
 */
import { expect, type Page, type Locator } from '@playwright/test';
import { adminMemberTest as test } from '../fixtures/multi-user.fixture.js';
import { acceptP2PRequest, openConversation, sendMessage, verifyMessageReceived } from '../lib/index.js';
import { pressAccountMenuItem } from '../lib/account-menu.js';
import { setWorkspaceTrust } from './messaging-trust-helpers.js';

/** Turn "Requests From Strangers" on or off in this browser's Privacy settings, and close them. */
async function setStrangerRequests(page: Page, accept: boolean): Promise<void> {
  await pressAccountMenuItem(page, 'account-menu-settings');
  await page.getByTestId('settings-tab-privacy').click();
  const toggle: Locator = page.locator('#stranger-requests');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if ((await toggle.getAttribute('aria-checked')) !== String(accept)) await toggle.click();
  await expect(toggle).toHaveAttribute('aria-checked', String(accept));
  await page.keyboard.press('Escape');
}

/** Count the PeerConnect requests this page sends to its agent from now on. */
function countPeerConnects(page: Page): () => number {
  let sent: number = 0;
  page.on('websocket', (ws) => {
    ws.on('framesent', (frame) => {
      const text: string = typeof frame.payload === 'string' ? frame.payload : frame.payload.toString('utf8');
      if (/"PeerConnect"\s*:/.test(text)) sent += 1;
    });
  });
  return (): number => sent;
}

test('a click in the Available list is recorded, answered, and connects once', async ({ admin, member }) => {
  test.setTimeout(420_000);
  await setWorkspaceTrust(admin.page, 'Strict');
  await setStrangerRequests(admin.page, false);
  try {
    const adminDials: () => number = countPeerConnects(admin.page);
    const memberDials: () => number = countPeerConnects(member.page);

    await admin.page.getByTestId('office-messages').click();
    await admin.page.getByTestId('messages-available-toggle').click();
    const row: Locator = admin.page.locator(`[data-testid="messages-available-peer"][data-peer-username="${member.username}"]`);
    // The registry poll trails a new account by 15-20s.
    await expect(row).toBeVisible({ timeout: 90_000 });
    await row.click();
    await expect(admin.page.locator('#add-peer-error')).toHaveCount(0);

    // Recorded as ours: the discovery list shows it awaiting their answer, and
    // nothing claimed them as a contact before they answered.
    await admin.page.getByTestId('messages-find-people').click();
    const discoveryRow: Locator = admin.page.locator(`[data-testid="peer-row"][data-peer-username="${member.username}"]`);
    await expect(discoveryRow.getByTestId('peer-awaiting')).toBeVisible({ timeout: 30_000 });
    await expect(discoveryRow.getByTestId('peer-contact-badge')).toHaveCount(0);
    await admin.page.keyboard.press('Escape');

    // Under Strict the member is asked; their accept is the answer to our request.
    expect(await acceptP2PRequest(member.page, member.username), 'the member is shown the request').toBe(true);

    // Recognised as the answer, not declined as a stranger's: they become a contact.
    await admin.page.getByTestId('messages-find-people').click();
    await expect(discoveryRow.getByTestId('peer-contact-badge')).toBeVisible({ timeout: 90_000 });
    await admin.page.keyboard.press('Escape');

    // Connected: a message goes through.
    expect(await openConversation(admin.page, admin.username, member.username), 'the admin opens the chat').toBe(true);
    const text: string = `from the available list ${Date.now()}`;
    expect(await sendMessage(admin.page, admin.username, text), 'the composer takes the message').toBe(true);
    expect(await openConversation(member.page, member.username, admin.username), 'the member opens the chat').toBe(true);
    expect(await verifyMessageReceived(member.page, member.username, text, 90_000), 'the message arrives').toBe(true);

    // Once from each side: the accept's own dial and auto-connect's dial on
    // PeerRegisterSuccess collapse into one (connectToPeer's pending set).
    expect(adminDials(), 'PeerConnect requests sent by the admin').toBeLessThanOrEqual(1);
    expect(memberDials(), 'PeerConnect requests sent by the member').toBeLessThanOrEqual(1);
  } finally {
    await setStrangerRequests(admin.page, true);
    await setWorkspaceTrust(admin.page, 'AllTrusted');
  }
});
