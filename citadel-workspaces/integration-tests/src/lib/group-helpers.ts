/**
 * Group Chat Test Helpers
 *
 * Shared utilities for parameterized group chat tests.
 * Supports Office, Room, and Custom Peer Group testing with N users.
 */

import type { Page, BrowserContext } from 'playwright';
import {
  sleep,
  createAccount,
  waitForWorkspaceLoaded,
  navigateToOffice,
  navigateToRoom,
  switchToChatTab,
  sendGroupMessage,
  verifyGroupMessageReceived,
  wakeUpTab,
  setupConsoleCapture,
} from './index.js';
import { RUN_DIAGNOSTIC_KEYWORDS } from './composer-diagnostics.js';
import type { UxIssueTracker } from './ux-tracker.js';

// ============================================================================
// Types
// ============================================================================

export interface UserSession {
  page: Page;
  username: string;
  isFirstUser: boolean;
}

export interface GroupTestConfig {
  userCount: number;
  groupType: 'office' | 'room' | 'peer-group';
  officeName?: string;
  roomName?: string;
  uxTracker: UxIssueTracker;
}

export interface GroupTestResults {
  accountsCreated: Record<string, boolean>;
  navigationSuccess: Record<string, boolean>;
  chatEnabled: boolean;
  chatTabSwitch: Record<string, boolean>;
  messagingResults: MessageTestResult[];
  allPassed: boolean;
}

export interface MessageTestResult {
  sender: string;
  receiver: string;
  sent: boolean;
  received: boolean;
}

// ============================================================================
// User Creation
// ============================================================================

/**
 * Create N users in separate pages within the same browser context
 */
export async function createNUsers(
  context: BrowserContext,
  count: number,
  prefix: string,
  uxTracker: UxIssueTracker
): Promise<UserSession[]> {
  const timestamp = Date.now();
  const users: UserSession[] = [];

  for (let i = 0; i < count; i++) {
    const page = await context.newPage();
    const username = `${prefix}${i + 1}_${timestamp}`;
    const isFirstUser = i === 0;

    // Every group-chat spec gets its pages from here, and none of them
    // captured console output. So when the composer was replaced by a
    // restriction notice, the run reported "Message input not found" while the
    // app had already logged which permission state produced the refusal --
    // into a console nobody was reading. Attached at the point pages are born
    // rather than in each spec, so a new spec cannot forget.
    setupConsoleCapture(page, username, [...RUN_DIAGNOSTIC_KEYWORDS]);

    console.log(`\n  Creating user ${i + 1}/${count}: ${username}`);

    const created = await createAccount(page, username, {
      isFirstUser,
      uxTracker,
    });

    if (!created) {
      throw new Error(`Failed to create user: ${username}`);
    }

    // Logged rather than thrown: these helpers report failure through their
    // return value and the caller decides. Silently discarding it is what made
    // the group-call stall unreadable — the log ended at 'Waiting for workspace
    // to fully load...' and never said whether it arrived.
    if (!(await waitForWorkspaceLoaded(page, 30000))) {
      console.log(`    WARNING: ${username}'s workspace never finished loading; continuing anyway`);
    }

    users.push({ page, username, isFirstUser });
  }

  // Give extra time for all users to fully load
  await sleep(3000);

  return users;
}

// ============================================================================
// Navigation
// ============================================================================

/**
 * Navigate all users to the same office
 */
export async function navigateAllToOffice(
  users: UserSession[],
  officeName: string,
  uxTracker: UxIssueTracker
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  for (const user of users) {
    results[user.username] = await navigateToOffice(
      user.page,
      user.username,
      officeName,
      { uxTracker }
    );
    await sleep(1000);
  }

  return results;
}

/**
 * Navigate all users to the same room
 */
export async function navigateAllToRoom(
  users: UserSession[],
  roomName: string,
  uxTracker: UxIssueTracker
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  for (const user of users) {
    results[user.username] = await navigateToRoom(
      user.page,
      user.username,
      roomName,
      { uxTracker }
    );
    await sleep(1000);
  }

  return results;
}

/**
 * Switch all users to chat tab
 */
export async function switchAllToChatTab(
  users: UserSession[],
  uxTracker: UxIssueTracker
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  for (const user of users) {
    results[user.username] = await switchToChatTab(
      user.page,
      user.username,
      { uxTracker }
    );
    await sleep(500);
  }

  return results;
}

// ============================================================================
// Bidirectional Messaging Test
// ============================================================================

/**
 * Test bidirectional messaging between all pairs of users
 *
 * For N users, tests:
 * - User 1 -> User 2, User 2 receives
 * - User 2 -> User 1, User 1 receives
 * - User 1 -> User 3, User 3 receives
 * - User 3 -> User 1, User 1 receives
 * - User 2 -> User 3, User 3 receives
 * - User 3 -> User 2, User 2 receives
 * ... and so on for all pairs
 */
export async function testBidirectionalMessaging(
  users: UserSession[],
  groupType: string,
  uxTracker: UxIssueTracker
): Promise<MessageTestResult[]> {
  const results: MessageTestResult[] = [];

  // Test each ordered pair (sender, receiver)
  for (let i = 0; i < users.length; i++) {
    for (let j = 0; j < users.length; j++) {
      if (i === j) continue; // Skip self-messaging

      const sender = users[i];
      const receiver = users[j];
      const testResult = await testOneWayMessage(
        sender,
        receiver,
        groupType,
        uxTracker
      );
      results.push(testResult);
    }
  }

  return results;
}

/**
 * Test a single message from sender to receiver
 */
async function testOneWayMessage(
  sender: UserSession,
  receiver: UserSession,
  groupType: string,
  uxTracker: UxIssueTracker
): Promise<MessageTestResult> {
  const message = `${groupType} msg from ${sender.username} to ${receiver.username} @ ${Date.now()}`;

  console.log(`\n  Testing: ${sender.username} -> ${receiver.username}`);

  // Wake up sender tab before sending - with longer delay to ensure tab is active
  await wakeUpTab(sender.page, sender.username);
  await sleep(500); // Give sender tab time to fully wake up

  // Sender sends message
  const sent = await sendGroupMessage(
    sender.page,
    sender.username,
    message,
    { uxTracker }
  );

  await sleep(3000); // Increased delay for message propagation through WebSocket

  // Wake up receiver tab before verifying - this is critical for multi-tab tests
  // as Chrome throttles background tabs and WebSocket updates may not be processed
  await wakeUpTab(receiver.page, receiver.username);
  await sleep(2000); // Increased time for pending updates to process

  // Receiver verifies receipt
  let received = false;
  if (sent) {
    received = await verifyGroupMessageReceived(
      receiver.page,
      receiver.username,
      message,
      15000,
      { uxTracker }
    );
  }

  const result = {
    sender: sender.username,
    receiver: receiver.username,
    sent,
    received,
  };

  console.log(`    Sent: ${sent ? 'PASS' : 'FAIL'}, Received: ${received ? 'PASS' : 'FAIL'}`);

  return result;
}

// ============================================================================
// Results Summary
// ============================================================================

/**
 * Print test results summary
 */
export function printGroupTestResults(
  config: GroupTestConfig,
  results: GroupTestResults
): void {
  console.log('\n' + '='.repeat(60));
  console.log(`${config.groupType.toUpperCase()} GROUP CHAT TEST RESULTS (${config.userCount} users)`);
  console.log('='.repeat(60));

  console.log('\nAccount Creation:');
  for (const [username, created] of Object.entries(results.accountsCreated)) {
    console.log(`  ${username}: ${created ? 'PASS' : 'FAIL'}`);
  }

  console.log('\nNavigation:');
  for (const [username, success] of Object.entries(results.navigationSuccess)) {
    console.log(`  ${username}: ${success ? 'PASS' : 'FAIL'}`);
  }

  console.log(`\nChat Enabled: ${results.chatEnabled ? 'YES' : 'NO'}`);

  if (results.chatEnabled) {
    console.log('\nChat Tab Switch:');
    for (const [username, success] of Object.entries(results.chatTabSwitch)) {
      console.log(`  ${username}: ${success ? 'PASS' : 'FAIL'}`);
    }

    console.log('\nMessaging Tests:');
    for (const msg of results.messagingResults) {
      const status = msg.sent && msg.received ? 'PASS' : 'FAIL';
      console.log(`  ${msg.sender} -> ${msg.receiver}: ${status}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`OVERALL: ${results.allPassed ? 'TEST PASSED' : 'TEST FAILED'}`);
  console.log('='.repeat(60));
}

/**
 * Calculate if all tests passed
 */
export function calculateAllPassed(results: Omit<GroupTestResults, 'allPassed'>): boolean {
  // All accounts created
  const accountsOk = Object.values(results.accountsCreated).every(v => v);
  if (!accountsOk) return false;

  // All navigations successful
  const navOk = Object.values(results.navigationSuccess).every(v => v);
  if (!navOk) return false;

  // Chat MUST be enabled. This used to `return true` when it was not, and
  // `chatEnabled` is not configuration — it is measured by probing the UI under
  // test for a Chat tab. So the single most likely group-chat regression, the
  // Chat tab disappearing, silently skipped steps 4 and 5 and reported a pass.
  // A precondition that cannot be established has to fail the run, not excuse
  // the assertions that depend on it.
  if (!results.chatEnabled) return false;

  // All chat tabs switched
  const tabsOk = Object.values(results.chatTabSwitch).every(v => v);
  if (!tabsOk) return false;

  // `[].every()` is true, so an empty result set passed here as well — a run
  // that sent no messages at all read as full success.
  if (results.messagingResults.length === 0) return false;

  // All messages sent and received
  const msgOk = results.messagingResults.every(m => m.sent && m.received);
  return msgOk;
}
