/**
 * A file transfer finishes across a page reload on either side, with nobody asked to do
 * anything.
 *
 * Owner report (2026-11-15): the sender's own bubble for a 165 KB jpeg read "Transfer failed:
 * Interrupted when the page reloaded. Ask them to send it again." The agent is a separate
 * process and keeps the session across a reload, so the transfer it held was still running;
 * the page had restored it as failed (lib/file-transfer/reload-recovery.ts has the fix).
 *
 * Only the live stack can prove the agent half: that its ticks reach the reloaded page under
 * the request id the page kept, and that a reloaded recipient's Accept still finds the offer
 * in its agent. The unit tests prove each side against replayed agent frames.
 * Written, not run, by the lane that added it (no shared-backend suites from lanes).
 */
import { expect, type Page } from '@playwright/test';
import { multiUserTest as test } from '../fixtures/multi-user.fixture.js';
import { openConversation, waitForWorkspaceLoaded, closeAnyModals } from '../lib/index.js';
import { keepAskingEachTime } from '../lib/always-accept.js';
import { openChatFromMemberList } from './messaging-trust-helpers.js';

// Typed image/jpeg but not decodable: the send goes without a thumbnail (a-picture-the-browser-
// cannot-preview-is-still-sent). Before that fix the dialog stopped at "Could not load image".
const JPEG: Buffer = Buffer.alloc(165_000, 0xab);

async function send(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page.getByTestId('p2p-send-file').click();
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: 'image/jpeg', buffer: bytes });
  await page.getByTestId('file-send').click();
}

async function reloadInto(page: Page, peer: string): Promise<void> {
  await page.reload({ waitUntil: 'commit', timeout: 60_000 });
  expect(await waitForWorkspaceLoaded(page, 120_000), 'the workspace loads again after the reload').toBe(true);
  await closeAnyModals(page);
  await openChatFromMemberList(page, peer);
}

const bubble = (page: Page, name: string) => page.getByTestId('file-transfer-bubble').filter({ hasText: name });

/** Never on either side, at any point: the user is not asked to act. */
async function noOneIsAsked(page: Page): Promise<void> {
  await expect(page.getByTestId('file-transfer-bubble').filter({ hasText: /ask them|ask the sender/i })).toHaveCount(0);
}

test('a transfer finishes across a reload of the sender and of the recipient', async ({ userA, userB }) => {
  test.setTimeout(600_000);
  await openChatFromMemberList(userA.page, userB.username);
  await expect(userA.page.getByTestId('p2p-message-input')).toHaveAttribute('placeholder', 'Type a message...', { timeout: 120_000 });
  expect(await openConversation(userB.page, userB.username, userA.username), 'B opens the chat').toBe(true);

  // 1. The owner's case: the sender reloads while its offer waits for an answer.
  await send(userA.page, 'harbour.jpg', JPEG);
  expect(await keepAskingEachTime(userB.page, 120_000), 'B is asked once, and keeps answering by hand').toBe(true);
  await expect(bubble(userA.page, 'harbour.jpg')).toHaveAttribute('data-transfer-state', 'pending', { timeout: 120_000 });
  await reloadInto(userA.page, userB.username);
  await expect(bubble(userA.page, 'harbour.jpg'), 'still waiting for its answer, not failed').toHaveAttribute('data-transfer-state', 'pending', { timeout: 60_000 });
  await noOneIsAsked(userA.page);

  await bubble(userB.page, 'harbour.jpg').getByTestId('file-transfer-accept').click();
  await expect(bubble(userB.page, 'harbour.jpg')).toHaveAttribute('data-transfer-state', 'complete', { timeout: 120_000 });
  await expect(bubble(userA.page, 'harbour.jpg')).toHaveAttribute('data-transfer-state', 'complete', { timeout: 120_000 });

  // 2. The recipient reloads with an offer it has not answered: it can still accept it.
  await send(userA.page, 'quay.jpg', JPEG);
  await expect(bubble(userB.page, 'quay.jpg').getByTestId('file-transfer-accept')).toBeVisible({ timeout: 120_000 });
  await reloadInto(userB.page, userA.username);
  await bubble(userB.page, 'quay.jpg').getByTestId('file-transfer-accept').click({ timeout: 60_000 });
  await expect(bubble(userB.page, 'quay.jpg')).toHaveAttribute('data-transfer-state', 'complete', { timeout: 120_000 });
  await expect(bubble(userA.page, 'quay.jpg')).toHaveAttribute('data-transfer-state', 'complete', { timeout: 120_000 });

  // 3. The sender reloads while bytes are moving (large enough to still be moving).
  const big: Buffer = Buffer.alloc(12 * 1024 * 1024, 0xcd);
  await send(userA.page, 'lighthouse.jpg', big);
  await bubble(userB.page, 'lighthouse.jpg').getByTestId('file-transfer-accept').click({ timeout: 120_000 });
  await expect(bubble(userA.page, 'lighthouse.jpg')).toHaveAttribute('data-transfer-state', 'transferring', { timeout: 120_000 });
  await reloadInto(userA.page, userB.username);
  await expect(bubble(userA.page, 'lighthouse.jpg')).not.toHaveAttribute('data-transfer-state', 'error');
  await expect(bubble(userB.page, 'lighthouse.jpg')).toHaveAttribute('data-transfer-state', 'complete', { timeout: 300_000 });
  await expect(bubble(userA.page, 'lighthouse.jpg'), 'finished, on the agent\'s ticks or the recipient\'s word').toHaveAttribute('data-transfer-state', 'complete', { timeout: 120_000 });

  await noOneIsAsked(userA.page);
  await noOneIsAsked(userB.page);
  // One bubble per file on the recipient's side: nothing was offered twice.
  await expect(userB.page.getByTestId('file-transfer-bubble').filter({ hasText: 'lighthouse.jpg' })).toHaveCount(1);
});
