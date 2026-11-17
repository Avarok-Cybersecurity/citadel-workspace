/**
 * Peer Group Chat Integration Test
 *
 * Tests custom peer group chat messaging with parameterized user counts (2, 3).
 * Each test:
 * 1. Creates N users
 * 2. Establishes P2P connections between all pairs
 * 3. User 1 creates a custom group and invites all others
 * 4. Verifies bidirectional messaging between all members
 *
 * NOTE: This test requires the custom peer group UI to be implemented:
 * - CreateGroupDialog component
 * - GroupChatPage route (/groups/:groupId)
 * - WASM bindings for groupCreate, groupInvite, groupMessage
 */

import {
  sleep,
  createBrowser,
  createSeparateBrowsers,
  createAccount,
  waitForWorkspaceLoaded,
  takeScreenshot,
  UxIssueTracker,
  startDiagnostics,
  createNUsers,
  printGroupTestResults,
  calculateAllPassed,
  TestHarness,
  runTestMain,
  type GroupTestResults,
  type MessageTestResult,
  type DiagnosticsHandle,
  type UserSession,
  p2pRegister,
  acceptP2PRequest,
} from '../../lib/index.js';
import { isVisibleWithin } from '../../lib/index.js';
import { acceptGroupInvitation } from '../../lib/group-invite.js';

// ============================================================================
// Configuration
// ============================================================================

// User counts to test - run tests for 2 and 3 users
const USER_COUNTS = [2, 3];

// Group name prefix
const GROUP_NAME_PREFIX = 'TestGroup';

// ============================================================================
// P2P Connection Helpers
// ============================================================================

/**
 * Establish P2P connections between all pairs of users.
 * For N users, this creates N*(N-1)/2 bidirectional P2P links.
 */
async function establishAllP2PConnections(
  users: UserSession[],
  uxTracker: UxIssueTracker
): Promise<Record<string, boolean>> {
  const results: Record<string, boolean> = {};

  console.log(`\n  Establishing P2P connections between ${users.length} users...`);

  // For each pair (i, j) where i < j, user i registers with user j
  for (let i = 0; i < users.length; i++) {
    for (let j = i + 1; j < users.length; j++) {
      const user1 = users[i];
      const user2 = users[j];
      const pairKey = `${user1.username}<->${user2.username}`;

      console.log(`\n  P2P pair: ${pairKey}`);

      // User i initiates registration with User j
      const registered = await p2pRegister(
        user1.page,
        user1.username,
        user2.username,
        uxTracker
      );

      if (!registered) {
        console.log(`    P2P registration failed: ${user1.username} -> ${user2.username}`);
        results[pairKey] = false;
        continue;
      }

      // User j accepts the request
      await sleep(3000); // Wait for notification to arrive

      const accepted = await acceptP2PRequest(
        user2.page,
        user2.username,
        uxTracker,
        user1.username
      );

      if (!accepted) {
        console.log(`    P2P accept failed: ${user2.username}`);
        results[pairKey] = false;
        continue;
      }

      results[pairKey] = true;
      console.log(`    P2P connection established: ${pairKey}`);

      await sleep(2000);
    }
  }

  return results;
}

// ============================================================================
// Group Creation Helpers
// ============================================================================

/**
 * Create a custom peer group via UI.
 * User 1 creates the group and invites all other users.
 */
async function createPeerGroup(
  creator: UserSession,
  members: UserSession[],
  groupName: string,
  uxTracker: UxIssueTracker
): Promise<string | null> {
  console.log(`\n  ${creator.username}: Creating group "${groupName}" with ${members.length} members...`);

  const page = creator.page;

  // Click "+" button next to CONVERSATIONS header in sidebar
  // The button is a small icon-only button within the SidebarGroup containing "CONVERSATIONS"
  // By testid. Finding it by walking into the group labelled "CONVERSATIONS"
  // made the failure read as "the button is missing" when the truth was that
  // the whole section is conditional -- which is a fact worth reporting
  // plainly, not one to discover through a structural selector.
  const newGroupBtn = page.getByTestId('new-group-chat-button').first();

  if (!await isVisibleWithin(newGroupBtn, 5000)) {
    console.log('    New Group button not found in sidebar');
    uxTracker.log('critical', 'functional', 'New Group button not found in sidebar');
    await takeScreenshot(page, `${creator.username}_new_group_btn_not_found`);
    return null;
  }

  await newGroupBtn.click();
  await sleep(1000);

  await takeScreenshot(page, `${creator.username}_create_group_dialog`);

  // Fill in group name - input has id="groupName" and placeholder with "'s Group"
  const nameInput = page.getByTestId('create-group-name').first();
  if (await isVisibleWithin(nameInput, 3000)) {
    await nameInput.fill(groupName);
    console.log(`    Group name filled: ${groupName}`);
  } else {
    console.log('    Group name input not found');
    uxTracker.log('major', 'functional', 'Group name input not found in create dialog');
  }

  await sleep(500);

  // Add members - click "Add Member" button for each member
  for (const member of members) {
    console.log(`    Adding member: ${member.username}`);

    // Click "Add Member" button
    const addMemberBtn = page.getByTestId('create-group-add-member').first();
    if (!await isVisibleWithin(addMemberBtn, 2000)) {
      console.log(`    Add Member button not found for ${member.username}`);
      continue;
    }

    await addMemberBtn.click();
    await sleep(500);

    // Select the peer from the popover
    // The option INSIDE the dialog, by its own id.
    //
    // This matched `button:has-text("<username>")`, and the sidebar's peer row
    // is a button with the username in it -- so the click resolved to a control
    // behind the modal and Playwright reported, correctly and unhelpfully,
    // "<div class=...bg-black/80> intercepts pointer events" for thirty
    // seconds. The dialog has carried `create-group-peer-<username>` all along.
    const peerOption = page.getByTestId(`create-group-peer-${member.username}`).first();
    if (await isVisibleWithin(peerOption, 2000)) {
      await peerOption.click();
      console.log(`    Selected member: ${member.username}`);
      await sleep(500);
    } else {
      console.log(`    Peer ${member.username} not found in selector`);
      uxTracker.log('major', 'functional', `Peer ${member.username} not found in member selector`);
    }
  }

  await takeScreenshot(page, `${creator.username}_group_members_added`);

  // Click "Create Group" button
  // By testid. `button:has-text("Create Group")` also matches the dialog's own
  // heading region and whatever else carries those words, so this was
  // `.last()` -- picking by DOM order, which is how round 287's locator came to
  // resolve to the row behind a modal and report it as a product failure.
  const createBtn = page.getByTestId('create-group-submit');
  if (!await isVisibleWithin(createBtn, 3000)) {
    console.log('    Create Group button not found');
    uxTracker.log('critical', 'functional', 'Create Group button not found in dialog');
    await takeScreenshot(page, `${creator.username}_create_btn_not_found`);
    return null;
  }

  await createBtn.click();

  // WAIT for the navigation, do not sleep at it.
  //
  // This slept three seconds and then read the URL. Creating a group is a round
  // trip to the peer, and on a link that is retransmitting -- which CI's is --
  // three seconds is not enough: the URL had not changed yet, the fallback
  // looked for a sidebar row that was not there yet either, and the helper
  // reported "group creation produced no group id" for a group that arrived a
  // second later. A fixed sleep turns a slow success into a failure and names
  // the product for it.
  await page
    .waitForURL(/\/groups\/[^/]+/, { timeout: 30_000 })
    .catch(() => { /* fall through to the sidebar check below */ });

  await takeScreenshot(page, `${creator.username}_group_created`);

  // Get group ID from URL or state
  // After creation, should navigate to /groups/:groupId
  const url = page.url();
  const groupIdMatch = url.match(/\/groups\/([^/]+)/);

  if (groupIdMatch) {
    const groupId = groupIdMatch[1];
    console.log(`    Group created successfully: ${groupId}`);
    return groupId;
  }

  // Alternative: the row in the sidebar, which carries the real id.
  //
  // This returned `group-${Date.now()}` -- a fabricated id that no later step
  // can use, so a caller that "succeeded" here then failed on something that
  // read like a different defect. `group-row-<id>` is what the sidebar renders,
  // and the id in it is the group's own.
  const groupRow = page.locator(`[data-testid^="group-row-"]:has-text("${groupName}")`).first();
  if (await isVisibleWithin(groupRow, 10_000)) {
    const testId: string | null = await groupRow.getAttribute('data-testid');
    const fromRow: string | undefined = testId?.slice('group-row-'.length);
    if (fromRow) {
      console.log(`    Group "${groupName}" visible in sidebar as ${fromRow}`);
      return fromRow;
    }
  }

  console.log('    Could not confirm group creation');
  uxTracker.log('major', 'functional', 'Could not confirm group creation');
  return null;
}

/**
 * Navigate a user to the group chat.
 */
async function navigateToGroup(
  user: UserSession,
  groupName: string,
  groupId: string,
  uxTracker: UxIssueTracker
): Promise<boolean> {
  console.log(`\n  ${user.username}: Navigating to group ${groupId}...`);

  const page = user.page;

  // By ID, not by the creator's chosen name.
  //
  // `GroupCreate` carries `{cid, request_id, initial_users_to_invite}` and no
  // name field, so the name the creator typed never leaves their machine --
  // round 425 records that, and keeps it locally for the creator alone. An
  // invitee builds their copy with `buildGroupFromInvite`, which falls back to
  // "<inviter>'s Group". Looking for the creator's name on the INVITEE's screen
  // asks for something the protocol cannot deliver, and reported it as the
  // product failing.
  //
  // The id is shared: it is the group's own `<cid>:<mgid>`, which round 434
  // made the creator obtain correctly, and it is what `group-row-<id>` renders.
  const groupRow = page.locator(`[data-testid="group-row-${groupId}"]`).first();

  if (!await isVisibleWithin(groupRow, 10000)) {
    console.log(`    Group ${groupId} not visible in sidebar for ${user.username}`);
    uxTracker.log('major', 'functional', `Group ${groupId} not visible for ${user.username}`);
    await takeScreenshot(page, `${user.username}_group_not_visible`);
    return false;
  }

  await groupRow.click();
  await sleep(2000);

  await takeScreenshot(page, `${user.username}_in_group`);

  // Verify we're in the group chat
  // The header shows whatever THIS user's copy is called, which for an invitee
  // is the fallback name rather than the creator's. Being on the group's route
  // is what "in the group" means.
  await page.waitForURL(new RegExp(`/groups/${groupId.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}`), { timeout: 5_000 }).catch(() => {});
  const groupHeader = page.locator('[data-testid="group-chat-view"]').first();
  const inGroup = await isVisibleWithin(groupHeader, 5000);

  if (!inGroup) {
    console.log(`    Failed to navigate to group for ${user.username}`);
    return false;
  }

  console.log(`    ${user.username} now in group "${groupName}"`);
  return true;
}

/**
 * Send a message in the group chat.
 */
async function sendGroupChatMessage(
  sender: UserSession,
  message: string,
  uxTracker: UxIssueTracker
): Promise<boolean> {
  const page = sender.page;

  // Find message input
  const messageInput = page.getByTestId('group-message-input').first();

  if (!await isVisibleWithin(messageInput, 5000)) {
    console.log(`    Message input not found for ${sender.username}`);
    uxTracker.log('major', 'functional', `Message input not found for ${sender.username}`);
    return false;
  }

  await messageInput.fill(message);
  await messageInput.press('Enter');

  await sleep(1000);

  // Verify message appears in chat
  const sentMessage = page.locator(`.message:has-text("${message}"), div:has-text("${message}")`).first();
  const sent = await isVisibleWithin(sentMessage, 5000);

  return sent;
}

/**
 * Verify a message was received in the group chat.
 */
async function verifyGroupChatMessageReceived(
  receiver: UserSession,
  message: string,
  timeoutMs: number,
  uxTracker: UxIssueTracker
): Promise<boolean> {
  const page = receiver.page;

  // Wait for message to appear
  const messageLocator = page.locator(`text="${message}"`).first();

  const received = await isVisibleWithin(messageLocator, timeoutMs);

  if (!received) {
    console.log(`    Message not received by ${receiver.username}: "${message.substring(0, 30)}..."`);
    uxTracker.log('major', 'functional', `Message not received by ${receiver.username}`);
    await takeScreenshot(page, `${receiver.username}_message_not_received`);
  }

  return received;
}

/**
 * Test bidirectional messaging in peer group.
 */
async function testPeerGroupMessaging(
  users: UserSession[],
  uxTracker: UxIssueTracker
): Promise<MessageTestResult[]> {
  const results: MessageTestResult[] = [];

  // Test each ordered pair (sender, receiver)
  for (let i = 0; i < users.length; i++) {
    for (let j = 0; j < users.length; j++) {
      if (i === j) continue; // Skip self-messaging

      const sender = users[i];
      const receiver = users[j];
      const message = `peer-group msg from ${sender.username} to ${receiver.username} @ ${Date.now()}`;

      console.log(`\n  Testing: ${sender.username} -> ${receiver.username}`);

      // Sender sends message
      const sent = await sendGroupChatMessage(sender, message, uxTracker);

      await sleep(2000);

      // Receiver verifies receipt
      let received = false;
      if (sent) {
        received = await verifyGroupChatMessageReceived(receiver, message, 15000, uxTracker);
      }

      results.push({
        sender: sender.username,
        receiver: receiver.username,
        sent,
        received,
      });

      console.log(`    Sent: ${sent ? 'PASS' : 'FAIL'}, Received: ${received ? 'PASS' : 'FAIL'}`);
    }
  }

  return results;
}

// ============================================================================
// Test Runner
// ============================================================================

async function runPeerGroupTest(userCount: number): Promise<boolean> {
  console.log('\n' + '='.repeat(60));
  console.log(`PEER GROUP CHAT TEST - ${userCount} USERS`);
  console.log('='.repeat(60));
  console.log('');

  // Initialize
  const uxTracker = new UxIssueTracker();
  const groupName = `${GROUP_NAME_PREFIX}_${userCount}_${Date.now()}`;

  // Use separate browsers for 3+ users to avoid memory exhaustion
  // Single context works for 2 users but 3 WASM clients overwhelm one V8 heap
  const useSeparateBrowsers = userCount >= 3;

  let browserSetup: { browser: import('playwright').Browser; context: import('playwright').BrowserContext } | null = null;
  let multiBrowserSetup: Awaited<ReturnType<typeof createSeparateBrowsers>> | null = null;

  if (useSeparateBrowsers) {
    multiBrowserSetup = await createSeparateBrowsers(userCount);
  } else {
    browserSetup = await createBrowser();
  }

  let diagnostics: DiagnosticsHandle | null = null;

  const results: Omit<GroupTestResults, 'allPassed'> & {
    p2pConnections: Record<string, boolean>;
    groupCreated: boolean;
    groupNavigation: Record<string, boolean>;
  } = {
    accountsCreated: {},
    navigationSuccess: {},
    chatEnabled: true, // Peer groups always have chat
    chatTabSwitch: {},
    messagingResults: [],
    p2pConnections: {},
    groupCreated: false,
    groupNavigation: {},
  };

  try {
    // ========== STEP 1: Create Users ==========
    console.log('\n' + '─'.repeat(50));
    console.log(`STEP 1: Creating ${userCount} Users`);
    console.log('─'.repeat(50));

    let users: UserSession[];

    if (useSeparateBrowsers && multiBrowserSetup) {
      // Create users in separate browsers - create one at a time to reduce resource pressure
      const timestamp = Date.now();
      users = [];
      for (let i = 0; i < userCount; i++) {
        const page = multiBrowserSetup.pages[i];
        const username = `peergrp_${i + 1}_${timestamp}`;
        const isFirstUser = i === 0;

        console.log(`\n  Creating user ${i + 1}/${userCount}: ${username}`);

        try {
          // Verify page is still alive before attempting account creation
          await page.evaluate(() => document.readyState).catch(() => null);
        } catch {
          console.log(`  Browser ${i + 1} died before account creation (resource exhaustion)`);
          throw new Error(`Browser ${i + 1} not available - system resource limit reached`);
        }

        const created = await createAccount(page, username, {
          isFirstUser,
          uxTracker,
        });

        if (!created) {
          throw new Error(`Failed to create user: ${username}`);
        }

        await waitForWorkspaceLoaded(page, 30000);
        users.push({ page, username, isFirstUser });

        // Brief pause between user creations to let resources stabilize
        if (i < userCount - 1) await sleep(2000);
      }
      await sleep(3000);
    } else if (browserSetup) {
      users = await createNUsers(browserSetup.context, userCount, 'peergrp_', uxTracker);
    } else {
      throw new Error('No browser setup available');
    }

    for (const user of users) {
      results.accountsCreated[user.username] = true;
    }

    // Start diagnostics on first user's page
    diagnostics = await startDiagnostics(users[0].page, {
      whiteScreenCheckInterval: 3000,
      realTimePrint: true,
      realTimeOnlyErrors: true,
    });

    // ========== STEP 2: Establish P2P Connections ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Establish P2P Connections');
    console.log('─'.repeat(50));

    try {
      results.p2pConnections = await establishAllP2PConnections(users, uxTracker);
    } catch (p2pError) {
      console.log(`\n  P2P connection setup error (non-fatal): ${p2pError}`);
      uxTracker.log('major', 'functional', `P2P connection setup error: ${p2pError}`);
    }

    // Check if all P2P connections succeeded
    const allP2PConnected = Object.values(results.p2pConnections).every(v => v);
    if (!allP2PConnected) {
      console.log('\n  WARNING: Not all P2P connections established');
      uxTracker.log('major', 'functional', 'Not all P2P connections established');
    }

    // ========== STEP 3: Create Peer Group ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Create Peer Group');
    console.log('─'.repeat(50));

    // User 1 creates the group with all other users as members
    const creator = users[0];
    const members = users.slice(1);

    const groupId = await createPeerGroup(creator, members, groupName, uxTracker);
    results.groupCreated = groupId !== null;

    if (!results.groupCreated) {
      // This used to `return true` -- "Treating as PASS (feature not yet
      // available)". Deleting CreateGroupDialog.tsx made createPeerGroup return
      // null, which took that branch, and the leg went green in CI. A spec that
      // passes when the feature it tests is absent is not a test of anything.
      //
      // The dialog exists; it has since the note was written. If group creation
      // fails now, that is a defect, and a red leg is the correct report.
      console.error('\n  FAIL: group creation produced no group id.');
      console.error('  CreateGroupDialog exists, so this is a real failure, not an absent feature.\n');
      return false;
    }

    // ========== STEP 4: All Users Navigate to Group ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Navigate All to Group');
    console.log('─'.repeat(50));

    // Creator is already in the group, navigate others
    results.groupNavigation[creator.username] = true;

    for (const member of members) {
      // `groupId` is checked above -- `results.groupCreated` is `groupId !==
      // null` -- but narrow it here too rather than asserting non-null, so a
      // future reorder cannot turn a missing id into a lookup for "null".
      if (!groupId) break;

      // An invitation waits for an answer; nobody joins a group unasked.
      try {
        await acceptGroupInvitation(member.page, groupId, 60000);
      } catch (error) {
        console.log(`    ${member.username} could not accept the invitation: ${String(error)}`);
        uxTracker.log('major', 'functional', `${member.username} was never asked to join ${groupId}`);
        await takeScreenshot(member.page, `${member.username}_no_invitation`);
        results.groupNavigation[member.username] = false;
        continue;
      }

      results.groupNavigation[member.username] = await navigateToGroup(
        member,
        groupName,
        groupId,
        uxTracker
      );
    }

    // ========== STEP 5: Test Bidirectional Messaging ==========
    if (results.groupCreated) {
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 5: Bidirectional Messaging Test');
      console.log('─'.repeat(50));

      results.messagingResults = await testPeerGroupMessaging(users, uxTracker);
    }

    // Final screenshots
    for (const user of users) {
      await takeScreenshot(user.page, `FINAL_peergroup_${userCount}users_${user.username}`);
    }

    // Mark navigation as success for result calculation
    for (const user of users) {
      results.navigationSuccess[user.username] = results.groupNavigation[user.username] ?? false;
      results.chatTabSwitch[user.username] = true; // No tab switch needed for peer groups
    }

    // Calculate and print results
    const allPassed = calculateAllPassed(results) && results.groupCreated;
    const fullResults: GroupTestResults = { ...results, allPassed };

    printGroupTestResults(
      {
        userCount,
        groupType: 'peer-group',
        uxTracker,
      },
      fullResults
    );

    // Additional results for peer group specific data
    console.log('\nP2P Connections:');
    for (const [pair, success] of Object.entries(results.p2pConnections)) {
      console.log(`  ${pair}: ${success ? 'PASS' : 'FAIL'}`);
    }

    console.log(`\nGroup Created: ${results.groupCreated ? 'YES' : 'NO'}`);

    console.log('\nGroup Navigation:');
    for (const [username, success] of Object.entries(results.groupNavigation)) {
      console.log(`  ${username}: ${success ? 'PASS' : 'FAIL'}`);
    }

    return allPassed;

  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('\nTest error:', errorMsg);

    // If browser crashed during multi-browser setup, treat as graceful skip
    // since the peer group UI isn't implemented yet anyway
    const isBrowserCrash = errorMsg.includes('Target page, context or browser has been closed') ||
      errorMsg.includes('Browser') && errorMsg.includes('not available') ||
      errorMsg.includes('resource limit');

    if (isBrowserCrash && userCount >= 3) {
      // Also used to return true. A browser that dies mid-run has told us
      // nothing about the feature, and reporting that as a pass is worse than
      // reporting nothing: it is the only signal anybody reads.
      console.error('\n  FAIL: browser crashed or ran out of resources with 3+ users.');
      console.error('  This is a real result about running three sessions, not an absent feature.\n');
      return false;
    }

    return false;
  } finally {
    // Stop diagnostics
    if (diagnostics) {
      console.log('\n  Stopping diagnostics...');
      const report = await diagnostics.stop();
      if (report.hadWhiteScreen) {
        console.log('\n  WARNING: WHITE SCREEN DETECTED');
      }
      if (report.summary.pageErrorCount > 0) {
        console.log(`\n  WARNING: ${report.summary.pageErrorCount} page error(s) detected`);
      }
    }

    if (multiBrowserSetup) {
      await multiBrowserSetup.cleanup();
    } else if (browserSetup) {
      await browserSetup.browser.close();
    }
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Peer Group Chat Integration Test',
    reportFileName: 'PEER_GROUP_CHAT_REPORT.json',
    metadata: { userCounts: USER_COUNTS },
    restartBackend: true,
  });

  console.log(`User counts: ${USER_COUNTS.join(', ')}`);
  console.log('');

  let allPassed = true;

  for (const userCount of USER_COUNTS) {
    // NOTE: We don't restart services between iterations because:
    // 1. It causes "Address already in use" port conflicts
    // 2. Each test creates new users anyway
    // 3. The initial restart provides clean state

    const passed = await runPeerGroupTest(userCount);
    if (!passed) {
      allPassed = false;
    }

    // Brief pause between tests
    await sleep(3000);
  }

  harness.finalize(allPassed, { userCounts: USER_COUNTS });

  return allPassed;
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
