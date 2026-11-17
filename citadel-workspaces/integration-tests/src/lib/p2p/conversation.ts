/**
 * P2P Conversation - opening and managing chat conversations
 */

import type { Page } from 'playwright';
import { sleep } from '../utils.js';
import { waitForWorkspaceLoaded, closeAnyModals } from '../modals.js';
import { takeScreenshot } from '../screenshots.js';
import { UxIssueTracker } from '../ux-tracker.js';
import { isVisibleWithin } from '../utils.js';

/**
 * Wait for P2PChat component to be fully ready (mounted with listener registered)
 */
async function waitForChatReady(page: Page, _peerUsername: string): Promise<void> {
  console.log(`  Waiting for P2PChat to be fully ready...`);

  // Wait for the message input to be visible and enabled
  const messageInput = page.getByTestId('p2p-message-input').first();

  for (let i = 0; i < 10; i++) {
    if (await isVisibleWithin(messageInput, 1000)) {
      // Also check if it's enabled (not disabled)
      const isDisabled = await messageInput.isDisabled().catch(() => true);
      if (!isDisabled) {
        console.log(`  P2PChat ready (message input enabled)`);
        // Extra wait to ensure React useEffect has run and listener is registered
        await sleep(2000);
        return;
      }
    }
    console.log(`  Waiting for chat input... (${i + 1}/10)`);
    await sleep(1000);
  }

  // Fallback: just wait extra time if input not found
  console.log(`  Chat input not found, waiting extra time...`);
  await sleep(5000);
}

/**
 * Open a conversation with a peer
 */
export async function openConversation(
  page: Page,
  username: string,
  peerUsername: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Opening conversation with ${peerUsername} ===`);

  // Bring tab to front
  await page.bringToFront();

  // Logged rather than thrown: these helpers report failure through their
  // return value and the caller decides. Silently discarding it is what made
  // the group-call stall unreadable — the log ended at 'Waiting for workspace
  // to fully load...' and never said whether it arrived.
  if (!(await waitForWorkspaceLoaded(page, 30000))) {
    console.log(`  WARNING: ${username}'s workspace never finished loading; continuing anyway`);
  }
  await closeAnyModals(page);
  await sleep(1000);

  // Wait for peer to appear in sidebar
  for (let attempt = 0; attempt < 15; attempt++) {
    // FIXED: Use SidebarGroup ancestor for section-relative search
    // The header and peer list are siblings within SidebarGroup, not parent-child
    // So we need to find the SidebarGroup containing the section header, then search within it

    // Strategy 2, tried first: the peer's own contact row, by its test id --
    // the one row that opens the conversation.
    //
    // This walked into a group headed "CONNECTED PEERS", a heading the app
    // deliberately stopped using when the members list was given one noun. The
    // strategy has therefore been dead, and every conversation opened through
    // one of the others -- silently, since a strategy that finds nothing just
    // falls through to the next.
    const peerInConnected = page.getByTestId(`peer-row-${peerUsername}`).first();
    if (await isVisibleWithin(peerInConnected, 500)) {
      console.log(`  Found ${peerUsername} in the sidebar peer list`);
      await peerInConnected.click();
      await sleep(2000);
      await waitForChatReady(page, peerUsername);
      await takeScreenshot(page, `${username}_conversation_opened`);
      return true;
    }

    // Strategy 1 (fallback): any sidebar button carrying the username.
    //
    // It was tried FIRST and was not reliable: a node's member list now shows
    // everyone who can use the node (UI #97), so the same person appears once as
    // a member -- a row that opens nothing -- and once as a contact below it.
    // `.first()` clicked the member row, the chat never opened, and eight e2e
    // specs reported undelivered messages that had in fact arrived (#182 CI).
    const sidebarPeer = page.locator(`[data-sidebar="menu-button"]:has-text("${peerUsername}")`).first();
    if (await isVisibleWithin(sidebarPeer, 1000)) {
      console.log(`  Found ${peerUsername} in sidebar via menu-button`);
      await sidebarPeer.click();
      await sleep(2000);
      await waitForChatReady(page, peerUsername);
      await takeScreenshot(page, `${username}_conversation_opened`);
      return true;
    }

    // A "WORKSPACE MEMBERS" strategy used to sit here. That heading does not
    // exist -- the members list was deliberately given one noun -- so it never
    // matched, and strategy 2 above already finds the peer's row wherever the
    // sidebar puts it.

    // Strategy 4: Try button match anywhere in the page
    const peerBtn = page.locator(`button:has-text("${peerUsername}")`).first();
    if (await isVisibleWithin(peerBtn, 500)) {
      console.log(`  Found ${peerUsername} via button`);
      await peerBtn.click();
      await sleep(2000);
      await waitForChatReady(page, peerUsername);
      await takeScreenshot(page, `${username}_conversation_opened`);
      return true;
    }

    // Strategy 5: Just look for any element with the peer's username text
    const peerText = page.locator(`text="${peerUsername}"`).first();
    if (await isVisibleWithin(peerText, 500)) {
      console.log(`  Found ${peerUsername} via text match`);
      await peerText.click();
      await sleep(2000);
      await waitForChatReady(page, peerUsername);
      await takeScreenshot(page, `${username}_conversation_opened`);
      return true;
    }

    console.log(`  Waiting for peer in sidebar... (${attempt + 1}/15)`);
    await sleep(2000);
  }

  if (uxTracker) {
    uxTracker.log('critical', 'functional', `Could not find ${peerUsername} in sidebar after 15 attempts`);
  }
  await takeScreenshot(page, `${username}_peer_not_in_sidebar`);
  return false;
}
