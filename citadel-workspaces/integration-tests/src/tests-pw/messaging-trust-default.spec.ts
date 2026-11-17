/**
 * Under the default messaging trust policy (AllTrusted, which a workspace has until an admin
 * chooses otherwise) two colleagues connect by opening each other's chat: no connect request to
 * accept, no pending card, and the conversation works.
 *
 * Discriminating: "no pending card" alone passes for a request that never arrived, so the peer
 * must ALSO come to list the sender as a contact without doing anything. Under Strict that cannot
 * happen (messaging-trust-strict.spec.ts shows the card instead).
 */
import { expect } from '@playwright/test';
import { multiUserTest as test } from '../fixtures/multi-user.fixture.js';
import { openConversation, sendMessage, verifyMessageReceived } from '../lib/index.js';
import { openChatFromMemberList } from './messaging-trust-helpers.js';

test('two colleagues connect and chat with no request to accept', async ({ userA, userB }) => {
  test.setTimeout(420_000);

  await openChatFromMemberList(userA.page, userB.username);

  // The request goes out on open: the composer is held until the two are registered, and then
  // released, with no click on "Send connect request".
  const input = userA.page.getByTestId('p2p-message-input');
  await expect(input).toHaveAttribute('placeholder', 'Type a message...', { timeout: 120_000 });
  await expect(userA.page.getByTestId('p2p-connect-banner')).toHaveCount(0);

  // B was never asked, and is connected anyway.
  await expect(userB.page.getByTestId(`peer-row-${userA.username}`)).toHaveCount(1, { timeout: 60_000 });
  await expect(userB.page.getByTestId('pending-requests-badge')).toHaveCount(0);

  const text = `trusted hello ${Date.now()}`;
  expect(await sendMessage(userA.page, userA.username, text), 'A sends').toBe(true);
  expect(await openConversation(userB.page, userB.username, userA.username), 'B opens the chat').toBe(true);
  expect(await verifyMessageReceived(userB.page, userB.username, text, 60_000), 'B receives it').toBe(true);
});
