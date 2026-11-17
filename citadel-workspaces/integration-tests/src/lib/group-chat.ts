/**
 * Group Chat Operations for Integration Tests
 *
 * Provides utility functions for testing office and room group chat functionality.
 */

import type { Page } from 'playwright';
import { reportTimeout } from './screen-state.js';
import { sleep } from './utils.js';
import { takeScreenshot } from './screenshots.js';
import type { UxIssueTracker } from './ux-tracker.js';
import { waitForTreeDataLoaded } from './modals.js';
import { createNodeViaProtocol, listNodesViaProtocol, updateNodeViaProtocol } from './tree-helpers.js';
import { revealNode, rootRow, selectRoot, treeRow } from './focused-tree.js';
import { isVisibleWithin } from './utils.js';

export interface GroupChatOptions {
  uxTracker?: UxIssueTracker | null;
}

/**
 * Reveal a node in the focused sidebar -- which selects it -- and screenshot
 * where that left the page. Offices and rooms are reached the same way: by
 * clicking down their path from the workspace root.
 */
async function goToNode(page: Page, username: string, kind: 'office' | 'room', nodeName: string): Promise<boolean> {
  console.log(`\n=== ${username}: Navigating to ${kind} "${nodeName}" ===`);
  try {
    if ((await revealNode(page, nodeName)) === null) {
      console.log(`  WARNING: Could not find ${kind} "${nodeName}"`);
      return false;
    }
    console.log(`  Selected ${kind} "${nodeName}"`);
    await takeScreenshot(page, `${username}_${kind}_${nodeName}`);
    return true;
  } catch (error) {
    console.log(`  ERROR navigating to ${kind}: ${error}`);
    return false;
  }
}

/**
 * Navigate to an office by selecting it in the sidebar
 */
export async function navigateToOffice(
  page: Page,
  username: string,
  officeName: string,
  _options: GroupChatOptions = {}
): Promise<boolean> {
  return goToNode(page, username, 'office', officeName);
}

/**
 * Navigate to a room by selecting it in the sidebar
 */
export async function navigateToRoom(
  page: Page,
  username: string,
  roomName: string,
  _options: GroupChatOptions = {}
): Promise<boolean> {
  return goToNode(page, username, 'room', roomName);
}

/**
 * Switch to the Chat tab in an office or room
 */
export async function switchToChatTab(
  page: Page,
  username: string,
  options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Switching to Chat tab ===`);

  try {
    // Try multiple selectors for the Chat tab trigger
    // The TabsTrigger has value="chat" and data-state attribute
    const selectors = [
      '[role="tab"]:has-text("Chat")',
      'button[value="chat"]',
      '[data-state][value="chat"]',
      'button:has-text("Chat"):not([data-sidebar])', // Exclude sidebar buttons
    ];

    for (const selector of selectors) {
      const chatTab = page.locator(selector).first();
      if (!(await isVisibleWithin(chatTab, 2000))) continue;

      await chatTab.click();

      // The click is not the switch. This used to return true here, so
      // "should open the office Chat tab" passed on a click that landed and
      // did nothing -- and the failure surfaced later as "Message input not
      // found", which reads as a missing composer rather than a tab that never
      // opened. Radix marks the open trigger `data-state="active"`, so that is
      // the thing to wait for.
      const opened = await chatTab
        .evaluate(
          (el) =>
            new Promise<boolean>((resolve) => {
              const check = (): boolean => el.getAttribute('data-state') === 'active';
              if (check()) return resolve(true);
              const observer = new MutationObserver(() => {
                if (check()) {
                  observer.disconnect();
                  resolve(true);
                }
              });
              observer.observe(el, { attributes: true, attributeFilter: ['data-state'] });
              setTimeout(() => {
                observer.disconnect();
                resolve(check());
              }, 5000);
            }),
        )
        .catch(() => false);

      await takeScreenshot(page, `${username}_chat_tab`);
      if (!opened) {
        console.log(`  WARNING: clicked the Chat tab (${selector}) and it did not become active`);
        if (options.uxTracker) {
          options.uxTracker.log('critical', 'functional', 'Chat tab click did not open the chat panel');
        }
        return false;
      }

      console.log(`  Switched to Chat tab (${selector})`);
      return true;
    }

    // Check if chat tab content is already visible (might already be on chat tab)
    // The log region by name. `.group-chat-view` was the half that matched:
    // the testid never existed, so this union was one dead selector beside one
    // class nobody guaranteed.
    const chatView = page.locator('[data-testid="group-chat-view"]').first();
    if (await isVisibleWithin(chatView, 2000)) {
      console.log(`  Chat view already visible`);
      return true;
    }

    // Check if message input is visible (indicates we're on chat tab)
    const messageInput = page.getByTestId('group-message-input').first();
    if (await isVisibleWithin(messageInput, 2000)) {
      console.log(`  Chat input already visible`);
      return true;
    }

    console.log(`  WARNING: Could not find Chat tab (chat may not be enabled for this office/room)`);
    if (options.uxTracker) {
      options.uxTracker.log('minor', 'functional', 'Chat tab not visible - chat may not be enabled');
    }
    return false;
  } catch (error) {
    console.log(`  ERROR switching to chat tab: ${error}`);
    return false;
  }
}

/**
 * Check if chat is enabled for the current office/room
 */
export async function isChatEnabled(page: Page, username: string): Promise<boolean> {
  console.log(`\n=== ${username}: Checking if chat is enabled ===`);

  // Look for Chat tab (TabsTrigger with text "Chat")
  const selectors = [
    '[role="tab"]:has-text("Chat")',
    'button[value="chat"]',
    '[data-state][value="chat"]',
    'button:has-text("Chat"):not([data-sidebar])',
  ];

  for (const selector of selectors) {
    const chatTab = page.locator(selector).first();
    if (await isVisibleWithin(chatTab, 2000)) {
      console.log(`  Chat enabled: true (found ${selector})`);
      return true;
    }
  }

  // Also check if we're already on a chat view
  const chatInput = page.getByTestId('group-message-input').first();
  if (await isVisibleWithin(chatInput, 1000)) {
    console.log(`  Chat enabled: true (chat input visible)`);
    return true;
  }

  console.log(`  Chat enabled: false`);
  return false;
}

/**
 * Send a message in the group chat
 */
export async function sendGroupMessage(
  page: Page,
  username: string,
  message: string,
  options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Sending group message ===`);
  console.log(`  Message: "${message.substring(0, 50)}..."`);

  try {
    // Find the message input (textarea)
    const messageInput = page.getByTestId('group-message-input').first();

    if (!(await isVisibleWithin(messageInput, 5000))) {
      // "Not found" was the whole report for four separate causes, and it named
      // none of them. These three are distinguishable from the page, and which
      // one it is decides where to look next:
      //
      //   attached but not visible  -> a layout problem; the composer is there
      //   a restriction notice      -> a permission decision, with its wording
      //   neither                   -> the chat view did not render at all
      const attached: number = await messageInput.count().catch((): number => 0);
      const restricted = page.getByTestId('group-send-restricted').first();
      const restrictedText: string | null = await restricted
        .textContent({ timeout: 1000 })
        .catch((): null => null);

      const why: string = restrictedText
        ? `the composer was replaced by a restriction notice: "${restrictedText.trim()}"`
        : attached > 0
          ? 'the composer is in the DOM but not visible -- a layout problem, not a permission one'
          : 'no composer and no restriction notice: the chat view did not render';

      console.log(`  WARNING: Message input not found -- ${why}`);
      if (options.uxTracker) {
        options.uxTracker.log('major', 'functional', `Group chat message input not visible: ${why}`);
      }
      return false;
    }

    // Clear and type the message
    await messageInput.fill(message);
    await sleep(500);

    // The composer's own send button, by its name. The last button with an icon was the send
    // button until node channels moved onto the direct chat's pane (ba2e7886), whose message-type
    // bar sits below the composer: "the last button with an svg" became "Live Doc", which opened
    // the New document dialog over the page and left the message unsent.
    const sendButton = page.getByTestId('group-chat').getByTestId('chat-send');

    if (await isVisibleWithin(sendButton, 2000)) {
      await sendButton.click();
      await sleep(1000);
      console.log(`  Message sent via button`);
    } else {
      // Try pressing Enter instead
      await messageInput.press('Enter');
      await sleep(1000);
      console.log(`  Message sent via Enter key`);
    }

    await takeScreenshot(page, `${username}_sent_group_msg`);
    return true;
  } catch (error) {
    console.log(`  ERROR sending message: ${error}`);
    return false;
  }
}

/**
 * Verify a message appears in the group chat
 */
export async function verifyGroupMessageReceived(
  page: Page,
  username: string,
  expectedMessage: string,
  timeout: number = 15000,
  options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Verifying group message received ===`);
  console.log(`  Looking for: "${expectedMessage.substring(0, 50)}..."`);

  try {
    // Wait for the message text itself, and nothing broader.
    //
    // This assertion decides whether a group message arrived. It used to call
    // `isVisible({ timeout })`, which ignores the timeout and answers about the
    // current instant, so a 15-second budget was really "is it on screen this
    // millisecond" and delivery only looked to work because of a sleep upstream.
    //
    // The first repair raced the exact text against a 20-character prefix in one
    // locator: `exact.or(prefix)`. That is WRONG here, and subtly. Spec messages
    // are built as `${type} msg from ${sender} to ${receiver} @ ${ts}`, so every
    // message in a run shares its first 20 characters. As soon as a second
    // message is on screen the union matches two DIFFERENT elements, Playwright
    // raises a strict-mode violation, and isVisibleWithin's catch turns that into
    // a plain `false` — reported as "message not received" for a message sitting
    // visibly on the page. It made office-chat and room-chat fail on the second
    // direction of every exchange while the product was working correctly.
    //
    // A prefix fallback cannot be made safe: it is by construction ambiguous
    // between messages. It is also unnecessary — each message ends in a unique
    // timestamp, so the full string identifies exactly one bubble.
    //
    // Substring rather than exact match, so surrounding whitespace or wrapping in
    // the bubble does not matter. getByText rather than `text="..."` because the
    // message is interpolated and a quote in it would break a hand-built selector.
    //
    // Inside the transcript only: the composer is a textarea, whose text is its value, so a message
    // that was typed and never sent matched here and read as received.
    const message = page.getByTestId('group-chat-view').getByText(expectedMessage).first();

    if (await isVisibleWithin(message, timeout)) {
      console.log(`  Message found`);
      await takeScreenshot(page, `${username}_received_group_msg`);
      return true;
    }

    await reportTimeout(page, `WARNING: Message not found within ${timeout}ms`);
    if (options.uxTracker) {
      options.uxTracker.log('major', 'functional', `Group message not received: "${expectedMessage.substring(0, 30)}..."`);
    }
    return false;
  } catch (error) {
    console.log(`  ERROR verifying message: ${error}`);
    return false;
  }
}

/**
 * Get the count of messages in the current chat view
 */
export async function getMessageCount(page: Page, username: string): Promise<number> {
  console.log(`\n=== ${username}: Counting messages ===`);

  try {
    // Look for message bubbles/items
    // `[class*="message"]` matched any element whose class merely CONTAINS
    // "message" -- wrappers, the composer, anything -- so this returned a
    // number that was not the message count. Each message row carries its id
    // (the chat pane's jump anchor); scoped to the channel's transcript.
    const messages = page.locator('[data-testid="group-chat-view"] [data-message-id]');
    const count = await messages.count();
    console.log(`  Found ${count} messages`);
    return count;
  } catch (error) {
    console.log(`  ERROR counting messages: ${error}`);
    return 0;
  }
}

/**
 * Check for message timestamps
 */
export async function checkMessageTimestamps(page: Page, username: string): Promise<boolean> {
  console.log(`\n=== ${username}: Checking message timestamps ===`);

  const timestamps = page.locator('time, [class*="timestamp"], .text-xs.text-gray');
  const count = await timestamps.count();

  if (count > 0) {
    console.log(`  Found ${count} timestamp elements`);
    return true;
  }

  console.log(`  No timestamps found`);
  return false;
}

/**
 * Load older messages (pagination): scroll the transcript to its top, which is
 * how the chat pane asks for the page before the oldest message it holds (it
 * has no button). True when more messages are on screen afterwards.
 */
export async function loadOlderMessages(
  page: Page,
  username: string,
  _options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Loading older messages ===`);

  try {
    const rows = page.locator('[data-testid="group-chat-view"] [data-message-id]');
    const before: number = await rows.count();
    const viewport = page.locator('[data-testid="group-chat-view"] [data-radix-scroll-area-viewport]').first();
    await viewport.evaluate((el: Element): void => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
    const grew: boolean = await page
      .waitForFunction(
        (n: number): boolean => document.querySelectorAll('[data-testid="group-chat-view"] [data-message-id]').length > n,
        before,
        { timeout: 5000 },
      )
      .then((): boolean => true, (): boolean => false);
    console.log(grew ? '  Older messages loaded' : '  No older messages arrived (may not have more)');
    return grew;
  } catch (error) {
    console.log(`  ERROR loading older messages: ${error}`);
    return false;
  }
}

/**
 * Check for the chat rules banner
 */
export async function checkRulesBanner(page: Page, username: string): Promise<string | null> {
  console.log(`\n=== ${username}: Checking for rules banner ===`);

  try {
    const rulesBanner = page.getByTestId('channel-rules').first();

    if (await isVisibleWithin(rulesBanner, 3000)) {
      const rulesText = await rulesBanner.textContent();
      console.log(`  Rules found: "${rulesText?.substring(0, 50)}..."`);
      return rulesText;
    }

    console.log(`  No rules banner found`);
    return null;
  } catch (error) {
    console.log(`  ERROR checking rules: ${error}`);
    return null;
  }
}

/**
 * Check if any offices (child nodes) exist in the sidebar.
 * The workspace root node is always present, so we check for tree nodes
 * at depth > 0 by looking for nodes that are NOT the workspace root.
 */
export async function hasOffices(page: Page, username: string): Promise<boolean> {
  console.log(`\n=== ${username}: Checking if child nodes (offices) exist ===`);

  try {
    // The empty state, by testid: its copy changed and "No nodes yet" matched nothing.
    const noNodesMsg = page.getByTestId('tree-empty');
    if (await isVisibleWithin(noNodesMsg, 2000)) {
      console.log(`  No nodes found (empty state)`);
      return false;
    }

    // Count tree-node testid elements. The workspace root is always one,
    // so >1 means at least one child (office) exists.
    const treeNodes = page.locator('[data-testid^="tree-node-"]:not([data-testid^="tree-node-menu-"]):not([data-testid^="tree-node-toggle-"])');
    const count = await treeNodes.count();
    console.log(`  Found ${count} tree node(s) in sidebar`);

    // 0 = loading or error, 1 = only workspace root, >1 = has children
    if (count > 1) {
      console.log(`  Child nodes exist`);
      return true;
    }

    console.log(`  No child nodes (offices) found`);
    return false;
  } catch (error) {
    console.log(`  ERROR checking offices: ${error}`);
    return false;
  }
}

/**
 * Create a new top-level node (e.g. office) via the hierarchy sidebar UI.
 * Waits for tree data to load before clicking, with retry logic for the modal.
 */
export async function createOffice(
  page: Page,
  username: string,
  officeName: string,
  description: string = '',
  options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Creating node "${officeName}" ===`);

  try {
    // Wait for tree data to be loaded before attempting to click the add button.
    // This prevents the race condition where handleNodeCreate(null) runs before
    // state.treeSchema is populated, causing the modal to not open.
    console.log('  Waiting for tree data to load...');
    await waitForTreeDataLoaded(page, 15000);

    // The header's "+" adds inside the selected node: select the root so the new
    // node is top-level. An empty workspace has no root row, and its "+" is
    // add-root-node-button, which always adds at the top.
    if ((await rootRow(page).isVisible()) && (await selectRoot(page)) === null) {
      console.log('  Could not select the workspace root');
      return false;
    }

    const addBtnSelectors = [
      '[data-testid="add-node-button"]',
      '[data-testid="add-root-node-button"]',
    ];

    // Retry loop: click add button, wait for modal, retry if modal doesn't appear
    let modalVisible = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        console.log(`  Retry ${attempt}: Modal did not appear, retrying...`);
        await page.keyboard.press('Escape');
        await sleep(1000);
      }

      // Click add-node button
      let clicked = false;
      for (const selector of addBtnSelectors) {
        const btn = page.locator(selector).first();
        if (await isVisibleWithin(btn, 2000)) {
          await btn.click();
          await sleep(500);
          console.log(`  Clicked Add Node button (${selector})`);
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        console.log(`  WARNING: Could not find add node button`);
        return false;
      }

      // Wait for the NodeManagementModal name input to appear
      const nameInput = page.locator('input#name, input[id="name"]').first();
      if (await isVisibleWithin(nameInput, 5000)) {
        modalVisible = true;
        break;
      }
    }

    if (!modalVisible) {
      console.log(`  WARNING: Node name input not found after retries`);
      return false;
    }

    // Fill in node name
    const nameInput = page.locator('input#name, input[id="name"]').first();
    await nameInput.fill(officeName);
    await sleep(300);

    // Fill in description
    if (description) {
      const descInput = page.locator('textarea#description, textarea[id="description"]').first();
      if (await isVisibleWithin(descInput, 1000)) {
        await descInput.fill(description);
        await sleep(300);
      }
    }

    // The entity modal's submit, by testid; see tree-helpers.
    const createBtn = page.getByTestId('entity-modal-submit').first();
    if (await isVisibleWithin(createBtn, 2000)) {
      await createBtn.click();
      await sleep(3000);
    } else {
      console.log(`  WARNING: Create button not found`);
      return false;
    }

    // Check for permission error
    const errorAlert = page.locator('text="Permission denied"').first();
    if (await isVisibleWithin(errorAlert, 2000)) {
      console.log(`  ERROR: Permission denied when creating node`);
      if (options.uxTracker) {
        options.uxTracker.log('major', 'functional', 'Cannot create node: Permission denied');
      }
      await page.keyboard.press('Escape');
      return false;
    }

    // Verify node was created: its row among the root's children. A row is a
    // treeitem, not a button, so `button:has-text` no longer finds it.
    const nodeInList = treeRow(page, officeName).first();
    if (await isVisibleWithin(nodeInList, 5000)) {
      console.log(`  Node "${officeName}" created successfully`);

      // Enable chat on the newly created node so group messaging tests work.
      // CreateNode doesn't auto-enable chat; we need to find the node ID and update it.
      try {
        const nodes = await listNodesViaProtocol(page);
        const createdNode = nodes.find(n => n.name === officeName);
        if (createdNode) {
          console.log(`  Enabling chat on node "${officeName}" (${createdNode.id})...`);
          await updateNodeViaProtocol(page, createdNode.id, { chat_enabled: true });
          await sleep(1000);
          console.log(`  Chat enabled on "${officeName}"`);
        } else {
          console.log(`  WARNING: Could not find node "${officeName}" to enable chat`);
        }
      } catch (chatError) {
        console.log(`  WARNING: Failed to enable chat: ${chatError}`);
      }

      return true;
    }

    console.log(`  WARNING: Node creation status unclear`);
    return false;
  } catch (error) {
    console.log(`  ERROR creating node: ${error}`);
    return false;
  }
}

/**
 * Create a child node (room) under a parent node via protocol.
 * Finds the parent by name, creates the child with entity_type { Child: "Room" },
 * and enables chat on it.
 */
export async function createRoom(
  page: Page,
  username: string,
  roomName: string,
  parentNodeName: string,
  description: string = '',
  _options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Creating room "${roomName}" under "${parentNodeName}" ===`);

  try {
    // Find parent node by name
    const nodes = await listNodesViaProtocol(page);
    const parentNode = nodes.find(n => n.name === parentNodeName);
    if (!parentNode) {
      console.log(`  WARNING: Parent node "${parentNodeName}" not found`);
      return false;
    }

    // Create child node via protocol
    const result = await createNodeViaProtocol(
      page,
      parentNode.id,
      { Child: 'Room' },
      roomName,
      description
    );

    if (!result.success) {
      console.log(`  WARNING: Failed to create room: ${result.error}`);
      return false;
    }

    console.log(`  Room "${roomName}" created (ID: ${result.nodeId})`);

    // Enable chat on the room
    if (result.nodeId) {
      await updateNodeViaProtocol(page, result.nodeId, { chat_enabled: true });
      await sleep(1000);
      console.log(`  Chat enabled on room "${roomName}"`);
    }

    // Wait for UI to reflect the new node
    await sleep(1000);
    return true;
  } catch (error) {
    console.log(`  ERROR creating room: ${error}`);
    return false;
  }
}

/**
 * Switch to the Content tab in an office or room
 */
export async function switchToContentTab(
  page: Page,
  username: string,
  _options: GroupChatOptions = {}
): Promise<boolean> {
  console.log(`\n=== ${username}: Switching to Content tab ===`);

  try {
    // The node's page tab, named "Page" since app tabs joined the row (c1440cc9); its key is still `content`.
    const contentTab = page.getByTestId('node-tab-content');

    if (await isVisibleWithin(contentTab, 5000)) {
      await contentTab.click();
      await sleep(1500);
      console.log(`  Switched to Content tab`);
      return true;
    }

    console.log(`  WARNING: Could not find Content tab`);
    return false;
  } catch (error) {
    console.log(`  ERROR switching to content tab: ${error}`);
    return false;
  }
}
