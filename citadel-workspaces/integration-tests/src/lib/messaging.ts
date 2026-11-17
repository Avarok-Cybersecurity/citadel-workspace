/**
 * Messaging operations - send and verify messages
 */

import type { Page } from 'playwright';
import { reportTimeout } from './screen-state.js';
import { takeScreenshot } from './screenshots.js';
import { UxIssueTracker } from './ux-tracker.js';

/**
 * Send a message in the current chat
 */
export async function sendMessage(
  page: Page,
  username: string,
  messageText: string,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Sending message ===`);

  // Bring tab to front
  await page.bringToFront();

  console.log(`  [DEBUG] Waiting for message input to be visible (5s timeout)...`);

  // Use waitFor with timeout instead of isVisible which doesn't timeout properly
  // By testid, not by element type. This said `input[...]` and the composer
  // has been a <textarea> since pasted newlines stopped being flattened -- so
  // it matched nothing, and every warmup message the call and reconnection
  // suites send first went nowhere, reported as "not delivered".
  const messageInput = page.getByTestId('p2p-message-input').first();

  try {
    await messageInput.waitFor({ state: 'visible', timeout: 5000 });
    console.log(`  [DEBUG] Message input is now visible`);
  } catch (e) {
    await reportTimeout(page, `[DEBUG] Message input not found or timed out: ${e}`);

    // Debug: Take screenshot and check what's visible
    await takeScreenshot(page, `${username}_message_input_NOT_FOUND`);
    const currentUrl = page.url();
    console.log(`  [DEBUG] Current URL: ${currentUrl}`);

    // Check for common issues
    const p2pChatVisible = await page.locator('[data-testid="p2p-chat"]').first().isVisible().catch(() => false);
    console.log(`  [DEBUG] P2PChat visible: ${p2pChatVisible}`);

    const anyInput = await page.locator('input').count();
    console.log(`  [DEBUG] Total input elements on page: ${anyInput}`);

    const chatSection = await page.locator('[class*="chat"], [class*="message"], [class*="conversation"]').count();
    console.log(`  [DEBUG] Chat-related elements: ${chatSection}`);

    const modalVisible = await page.locator('[role="dialog"], .modal, [class*="modal"]').first().isVisible().catch(() => false);
    console.log(`  [DEBUG] Modal visible: ${modalVisible}`);

    if (uxTracker) {
      uxTracker.log('critical', 'functional', 'Message input not found');
    }
    return false;
  }

  console.log(`  [DEBUG] Checking if input is disabled...`);
  const isDisabled = await messageInput.isDisabled().catch(() => {
    console.log(`  [DEBUG] isDisabled check failed, assuming not disabled`);
    return false;
  });
  console.log(`  [DEBUG] isDisabled: ${isDisabled}`);

  if (isDisabled) {
    if (uxTracker) {
      uxTracker.log('major', 'functional', 'Message input is disabled');
    }
    await takeScreenshot(page, `${username}_input_disabled`);
    return false;
  }

  console.log(`  [DEBUG] Filling message text...`);
  await messageInput.fill(messageText);
  console.log(`  [DEBUG] Message text filled, waiting 500ms for UI to process...`);
  await new Promise(resolve => setTimeout(resolve, 500));

  console.log(`  [DEBUG] Looking for send button...`);
  // The composer's own send button, by name: positional picks ("the last submit", "the last
  // button with an icon") were stale once the chat pane gained the message-type bar (ba2e7886).
  const sendBtn = page.getByTestId('p2p-chat').getByTestId('chat-send');

  const sendBtnVisible = await sendBtn.isVisible().catch(() => false);
  console.log(`  [DEBUG] Send button visible: ${sendBtnVisible}`);

  if (sendBtnVisible) {
    console.log(`  [DEBUG] Clicking send button...`);
    await sendBtn.click();
  } else {
    console.log(`  [DEBUG] Pressing Enter to send...`);
    await messageInput.press('Enter');
  }

  await new Promise(resolve => setTimeout(resolve, 1500));
  console.log(`  Message sent: "${messageText}"`);
  await takeScreenshot(page, `${username}_message_sent`);
  return true;
}

/**
 * Verify a message was received in the chat
 * Uses proper Playwright waiting mechanisms for synchronization
 */
export async function verifyMessageReceived(
  page: Page,
  username: string,
  expectedText: string,
  timeout = 30000,
  uxTracker: UxIssueTracker | null = null
): Promise<boolean> {
  console.log(`\n=== ${username}: Verifying message received ===`);

  // Bring tab to front
  await page.bringToFront();

  console.log(`  Looking for: "${expectedText.substring(0, 50)}..."`);

  // A message row (`data-message-id`, the pane's jump anchor) with the text, and nothing broader:
  // every `div` and the page source contain the composer, whose textarea's text is its value, so a
  // typed and unsent message matched here and read as received.
  const row = page.locator('[data-message-id]').filter({ hasText: expectedText }).first();
  try {
    await row.waitFor({ state: 'visible', timeout });
    console.log(`  ✓ Message found: "${expectedText.substring(0, 50)}..."`);
    await takeScreenshot(page, `${username}_message_verified`);
    return true;
  } catch {
    await reportTimeout(page, `Message not in the transcript within ${timeout}ms`);
  }

  // Debug: Log what IS visible in the chat area
  console.log(`  ✗ Message not found. Debugging chat content...`);
  try {
    const chatMessages = await page.locator('[class*="message"], .prose, [class*="chat"] p').allTextContents();
    console.log(`  Visible messages (${chatMessages.length}):`);
    chatMessages.slice(0, 5).forEach((msg, i) => {
      console.log(`    ${i + 1}. "${msg.substring(0, 60)}..."`);
    });
  } catch {
    console.log(`  Could not enumerate chat messages`);
  }

  if (uxTracker) {
    uxTracker.log('critical', 'functional', `Message not received within ${timeout}ms: "${expectedText}"`);
  }
  await takeScreenshot(page, `${username}_message_not_received`);
  return false;
}

/**
 * Verify that messages appear in the expected order in the chat
 * Returns an object with success status and details about each message
 */
export async function verifyMessageOrder(
  page: Page,
  username: string,
  expectedMessages: string[],
  timeout = 30000,
  uxTracker: UxIssueTracker | null = null
): Promise<{ success: boolean; details: { message: string; found: boolean; index: number }[] }> {
  console.log(`\n=== ${username}: Verifying message order ===`);
  console.log(`  Expecting ${expectedMessages.length} messages in order:`);
  expectedMessages.forEach((msg, i) => {
    console.log(`    ${i + 1}. "${msg.substring(0, 40)}${msg.length > 40 ? '...' : ''}"`);
  });

  const details: { message: string; found: boolean; index: number }[] = [];

  // Wait for all messages to appear first
  for (const msg of expectedMessages) {
    try {
      await page.waitForFunction(
        (text: string) => {
          // Message rows only: a `div` holding the composer matched a typed, unsent message.
          const elements = document.querySelectorAll('[data-message-id]');
          for (let i = 0; i < elements.length; i++) {
            if (elements[i].textContent?.includes(text)) {
              return true;
            }
          }
          return false;
        },
        msg,
        { timeout, polling: 500 }
      );
    } catch {
      await reportTimeout(page, `✗ Message not found within timeout: "${msg.substring(0, 40)}..."`);
      if (uxTracker) {
        uxTracker.log('critical', 'functional', `Message not found: "${msg}"`);
      }
      details.push({ message: msg, found: false, index: -1 });
    }
  }

  // Now get all message elements and find their positions using Playwright locators
  // This is more reliable than page.evaluate() as it handles timing and context properly
  const allMessageTexts: string[] = [];
  const seen = new Set<string>();

  // Message rows, in document order: every 'p' on the page included the composer's helper text and
  // any other paragraph, so positions were not positions in the transcript.
  const locator = page.locator('[data-message-id]');
  const count = await locator.count();

  for (let i = 0; i < count; i++) {
    const text = await locator.nth(i).textContent();
    if (text) {
      const trimmed = text.trim();
      // Filter out empty strings, very short strings, and duplicates
      if (trimmed.length > 10 && !seen.has(trimmed)) {
        seen.add(trimmed);
        allMessageTexts.push(trimmed);
      }
    }
  }

  console.log(`  Found ${allMessageTexts.length} message elements on page`);

  // Find the index of each expected message
  let lastFoundIndex = -1;
  let allInOrder = true;

  for (const expectedMsg of expectedMessages) {
    // Find the first occurrence of this message at or after lastFoundIndex
    let foundIndex = -1;
    for (let i = lastFoundIndex + 1; i < allMessageTexts.length; i++) {
      if (allMessageTexts[i].includes(expectedMsg)) {
        foundIndex = i;
        break;
      }
    }

    if (foundIndex === -1) {
      // Message not found at all, or not found after the previous message
      // Check if it exists anywhere (out of order)
      const existsAnywhere = allMessageTexts.some(t => t.includes(expectedMsg));
      if (existsAnywhere) {
        console.log(`  ✗ Message found but OUT OF ORDER: "${expectedMsg.substring(0, 40)}..."`);
        if (uxTracker) {
          uxTracker.log('major', 'functional', `Message out of order: "${expectedMsg}"`);
        }
      } else {
        console.log(`  ✗ Message NOT FOUND: "${expectedMsg.substring(0, 40)}..."`);
      }
      details.push({ message: expectedMsg, found: existsAnywhere, index: -1 });
      allInOrder = false;
    } else {
      console.log(`  ✓ Message at index ${foundIndex}: "${expectedMsg.substring(0, 40)}..."`);
      details.push({ message: expectedMsg, found: true, index: foundIndex });
      lastFoundIndex = foundIndex;
    }
  }

  if (allInOrder) {
    console.log(`  ✓ All ${expectedMessages.length} messages found in correct order`);
  } else {
    console.log(`  ✗ Message order verification FAILED`);
    await takeScreenshot(page, `${username}_message_order_failed`);
  }

  return { success: allInOrder, details };
}

/**
 * Wait for multiple messages to appear in the chat (reactive polling).
 * More efficient than sequential verifyMessageReceived calls - polls for all at once.
 *
 * @param page - The page to check
 * @param username - Username for logging
 * @param expectedMessages - Array of message texts to find
 * @param timeout - Total timeout in ms for ALL messages to appear
 * @param pollInterval - How often to check (default 500ms)
 * @returns Object with results for each message
 */
export async function waitForAllMessages(
  page: Page,
  username: string,
  expectedMessages: string[],
  timeout = 30000,
  pollInterval = 500
): Promise<{ allReceived: boolean; results: Record<string, boolean> }> {
  console.log(`\n=== ${username}: Waiting for ${expectedMessages.length} messages ===`);
  expectedMessages.forEach((msg, i) => {
    console.log(`  ${i + 1}. "${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}"`);
  });

  await page.bringToFront();

  const results: Record<string, boolean> = {};
  expectedMessages.forEach(msg => results[msg] = false);

  const startTime = Date.now();
  let found = 0;

  // Use page.waitForFunction for lightweight in-browser checks instead of
  // serializing the entire DOM with page.content() on every poll cycle.
  // This dramatically reduces resource usage for long timeout periods.
  const remaining = [...expectedMessages];

  while (remaining.length > 0 && Date.now() - startTime < timeout) {
    try {
      // Wait for the next unfound message using in-browser JS (lightweight)
      await page.waitForFunction(
        (msgs: string[]) => {
          const body = Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).map((row) => row.innerText).join('\n');
          return msgs.some(m => body.includes(m));
        },
        remaining,
        { timeout: Math.min(pollInterval * 10, timeout - (Date.now() - startTime)), polling: pollInterval }
      );
    } catch {
      // Timeout on this batch - check what we found so far
    }

    // Check which remaining messages are now present (lightweight innerText check)
    const bodyText = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-message-id]')).map((row) => row.innerText).join('\n')).catch(() => '');
    const nowFound: string[] = [];
    for (const msg of remaining) {
      if (!results[msg] && bodyText.includes(msg)) {
        results[msg] = true;
        found++;
        nowFound.push(msg);
        console.log(`  ✓ Found (${found}/${expectedMessages.length}): "${msg.substring(0, 40)}..."`);
      }
    }
    // Remove found messages from remaining list
    for (const f of nowFound) {
      const idx = remaining.indexOf(f);
      if (idx >= 0) remaining.splice(idx, 1);
    }
  }

  const allReceived = found === expectedMessages.length;
  if (allReceived) {
    console.log(`  ✓ All ${expectedMessages.length} messages received in ${Date.now() - startTime}ms`);
  } else {
    await reportTimeout(page, `✗ Timeout after ${timeout}ms. Found ${found}/${expectedMessages.length} messages`);
    for (const msg of expectedMessages) {
      if (!results[msg]) {
        console.log(`    Missing: "${msg.substring(0, 50)}..."`);
      }
    }
    await takeScreenshot(page, `${username}_messages_timeout`);
  }

  return { allReceived, results };
}

/**
 * Verify that sent messages have been seen (read status - blue checkmarks).
 * This checks that the receiver has read the messages and sent back read receipts.
 *
 * @param page - The sender's page (the one who sent the messages)
 * @param username - Username for logging
 * @param expectedSeenCount - Number of messages expected to show "read" (blue checkmark) status
 * @param timeout - Timeout in ms to wait for status to update
 * @param uxTracker - Optional UX issue tracker
 * @returns Object with success status and count details
 */
export async function verifyMessagesSeen(
  page: Page,
  username: string,
  expectedSeenCount: number,
  timeout = 15000,
  uxTracker: UxIssueTracker | null = null
): Promise<{ success: boolean; seenCount: number; deliveredCount: number; sentCount: number }> {
  console.log(`\n=== ${username}: Verifying messages seen (read status) ===`);
  console.log(`  Expecting ${expectedSeenCount} messages with "read" status (blue checkmarks)`);

  const startTime = Date.now();
  let seenCount = 0;
  let deliveredCount = 0;
  let sentCount = 0;

  // Poll until we get the expected seen count or timeout
  while (Date.now() - startTime < timeout) {
    // Count status indicators using data-testid attributes
    seenCount = await page.locator('[data-testid="message-status-read"]').count();
    deliveredCount = await page.locator('[data-testid="message-status-delivered"]').count();
    sentCount = await page.locator('[data-testid="message-status-sent"]').count();

    console.log(`  Status counts: read=${seenCount}, delivered=${deliveredCount}, sent=${sentCount}`);

    if (seenCount >= expectedSeenCount) {
      console.log(`  ✓ Found ${seenCount} messages with "read" status (expected ${expectedSeenCount})`);
      await takeScreenshot(page, `${username}_messages_seen_verified`);
      return { success: true, seenCount, deliveredCount, sentCount };
    }

    // Wait a bit before checking again
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Timeout - didn't get expected seen count
  await reportTimeout(page, `✗ Timeout waiting for messages to be seen`);
  console.log(`  Final counts: read=${seenCount}, delivered=${deliveredCount}, sent=${sentCount}`);

  if (uxTracker) {
    uxTracker.log(
      'critical',
      'functional',
      `Messages not marked as seen within ${timeout}ms. Expected ${expectedSeenCount} read, got ${seenCount}. Delivered: ${deliveredCount}, Sent: ${sentCount}`
    );
  }

  await takeScreenshot(page, `${username}_messages_not_seen`);
  return { success: false, seenCount, deliveredCount, sentCount };
}

/**
 * Send a message and verify it was received by the recipient.
 * Implements retry logic for robustness against timing issues.
 *
 * @param senderPage - The sender's page
 * @param senderUsername - Sender's username for logging
 * @param receiverPage - The receiver's page
 * @param receiverUsername - Receiver's username for logging
 * @param messageText - Message text to send
 * @param options - Configuration options
 * @returns true if message was successfully sent and received
 */
export async function sendAndVerifyMessage(
  senderPage: Page,
  senderUsername: string,
  receiverPage: Page,
  receiverUsername: string,
  messageText: string,
  options: {
    maxRetries?: number;
    verifyTimeout?: number;
    retryDelay?: number;
    uxTracker?: UxIssueTracker | null;
  } = {}
): Promise<boolean> {
  const {
    maxRetries = 3,
    verifyTimeout = 15000,
    retryDelay = 2000,
    uxTracker = null,
  } = options;

  console.log(`\n=== Robust Send: ${senderUsername} -> ${receiverUsername} ===`);
  console.log(`  Message: "${messageText.substring(0, 50)}${messageText.length > 50 ? '...' : ''}"`);
  console.log(`  Config: maxRetries=${maxRetries}, verifyTimeout=${verifyTimeout}ms`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`  Attempt ${attempt}/${maxRetries}...`);

    // Send the message
    const sendSuccess = await sendMessage(senderPage, senderUsername, messageText, null);
    if (!sendSuccess) {
      console.log(`    Send failed on attempt ${attempt}`);
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      if (uxTracker) {
        uxTracker.log('critical', 'functional', `Failed to send message after ${maxRetries} attempts`);
      }
      return false;
    }

    // Verify message received
    const verified = await verifyMessageReceived(
      receiverPage,
      receiverUsername,
      messageText,
      verifyTimeout,
      null // Don't log UX issues on intermediate attempts
    );

    if (verified) {
      console.log(`  ✓ Message verified on attempt ${attempt}`);
      return true;
    }

    console.log(`    Verification failed on attempt ${attempt}`);
    if (attempt < maxRetries) {
      console.log(`    Waiting ${retryDelay}ms before retry...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  console.log(`  ✗ Message delivery failed after ${maxRetries} attempts`);
  if (uxTracker) {
    uxTracker.log('critical', 'functional', `Message not received after ${maxRetries} attempts: "${messageText}"`);
  }
  await takeScreenshot(receiverPage, `${receiverUsername}_message_not_received_final`);
  return false;
}

/**
 * Wait for P2P connection to be ready by checking actual service state.
 * More reliable than UI-based checks for timing-sensitive tests.
 *
 * @param page - The page to check connection state on
 * @param username - Username for logging
 * @param peerUsername - The peer to wait for connection to
 * @param timeoutMs - Maximum time to wait
 * @returns true if connection established within timeout
 */
export async function waitForP2PReady(
  page: Page,
  username: string,
  peerUsername: string,
  timeoutMs: number = 30000
): Promise<boolean> {
  console.log(`  ${username}: Waiting for P2P ready to ${peerUsername}...`);

  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const result = await page.evaluate(async (peerUser: string) => {
        try {
          // Access actual singleton instances exposed on window by main.tsx
          const p2pAutoConnectService = (window as any).__p2pAutoConnectService;
          const p2pRegistrationService = (window as any).__p2pRegistrationService;
          if (!p2pAutoConnectService || !p2pRegistrationService) {
            return { ready: false, reason: 'window services not available' };
          }

          const { registeredPeers } = p2pRegistrationService.getPeers();
          const peer = registeredPeers.find(
            (p: { username?: string }) => p.username?.toLowerCase() === peerUser.toLowerCase()
          );
          if (!peer?.cid) return { ready: false, reason: 'peer_not_found' };

          const peerCid = typeof peer.cid === 'bigint' ? peer.cid : BigInt(peer.cid);
          const connected = await p2pAutoConnectService.isPeerConnected(peerCid);
          if (!connected) return { ready: false, reason: 'not_connected' };

          const isOnline = p2pAutoConnectService.isPeerOnline(peerCid);
          return { ready: connected, reason: isOnline ? 'connected_and_online' : 'connected_but_offline' };
        } catch (e) {
          return { ready: false, reason: `error: ${e}` };
        }
      }, peerUsername);

      if (result.ready) {
        console.log(`  ${username}: P2P ready to ${peerUsername} (${result.reason}) in ${Date.now() - startTime}ms`);
        return true;
      }

      // Log progress every 5 seconds
      const elapsed = Date.now() - startTime;
      if (elapsed > 0 && elapsed % 5000 < pollInterval) {
        console.log(`  ${username}: Still waiting for P2P (${result.reason})... ${Math.round(elapsed / 1000)}s`);
      }
    } catch (error) {
      // Ignore errors and keep polling
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  await reportTimeout(page, `${username}: P2P ready timeout after ${timeoutMs}ms`);
  return false;
}

/**
 * Verify multiple offline messages with retry logic.
 * If messages aren't found, forces a UI refresh by navigating away and back.
 *
 * @param page - The page to check
 * @param username - Username for logging
 * @param peerUsername - Peer to open conversation with
 * @param messages - Array of message texts to verify
 * @param options - Configuration options
 * @returns Object with results for each message
 */
export async function verifyOfflineMessagesWithRetry(
  page: Page,
  username: string,
  _peerUsername: string, // Kept for API compatibility but no longer used (navigation removed)
  messages: string[],
  options: {
    maxRetries?: number;
    verifyTimeout?: number;
    retryDelay?: number;
    openConversationFn?: (page: Page, username: string, peerUsername: string, tracker: UxIssueTracker | null) => Promise<boolean>;
    uxTracker?: UxIssueTracker | null;
  } = {}
): Promise<{ allReceived: boolean; results: Record<string, boolean> }> {
  const {
    maxRetries = 3,
    verifyTimeout = 20000,
    retryDelay = 3000,
    // openConversationFn removed - navigation discards in-flight ILM messages
    uxTracker = null,
  } = options;

  console.log(`\n=== ${username}: Verifying ${messages.length} offline messages ===`);
  messages.forEach((msg, i) => {
    console.log(`  ${i + 1}. "${msg.substring(0, 50)}${msg.length > 50 ? '...' : ''}"`);
  });

  const results: Record<string, boolean> = {};
  messages.forEach(msg => results[msg] = false);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`  Attempt ${attempt}/${maxRetries}...`);

    // If this is a retry, wait for ILM to deliver messages (NO navigation - may discard in-flight messages)
    // Navigation during ILM message delivery can:
    // - Discard WebSocket messages in flight
    // - Reset React state before messages are rendered
    // - Miss messages that arrive during navigation
    if (attempt > 1) {
      console.log(`    Waiting ${retryDelay}ms for ILM to deliver messages...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));

      // Scroll to trigger UI refresh without losing WebSocket connection
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(resolve => setTimeout(resolve, 500));
      await page.evaluate(() => window.scrollTo(0, 0));
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Verify all messages
    for (const msg of messages) {
      if (!results[msg]) {
        const found = await verifyMessageReceived(page, username, msg, verifyTimeout, null);
        if (found) {
          results[msg] = true;
          console.log(`    ✓ Found: "${msg.substring(0, 40)}..."`);
        } else {
          console.log(`    ✗ Not found: "${msg.substring(0, 40)}..."`);
        }
      }
    }

    // Check if all messages found
    const receivedCount = Object.values(results).filter(v => v).length;
    if (receivedCount === messages.length) {
      console.log(`  ✓ All ${messages.length} offline messages verified on attempt ${attempt}`);
      return { allReceived: true, results };
    }

    if (attempt < maxRetries) {
      console.log(`    Found ${receivedCount}/${messages.length}, retrying...`);
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }

  console.log(`  ✗ Offline message verification failed after ${maxRetries} attempts`);
  if (uxTracker) {
    const missing = messages.filter(m => !results[m]);
    uxTracker.log('critical', 'functional', `Offline messages not received: ${missing.join(', ')}`);
  }
  await takeScreenshot(page, `${username}_offline_messages_not_received`);
  return { allReceived: false, results };
}
