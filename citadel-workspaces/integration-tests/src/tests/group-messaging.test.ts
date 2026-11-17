/**
 * Group Messaging Integration Test
 *
 * Tests the group chat messaging functionality for offices and rooms:
 * 1. Create a user account
 * 2. Navigate to an office with chat enabled
 * 3. Send and receive messages in office chat
 * 4. Navigate to a room with chat enabled
 * 5. Send and receive messages in room chat
 * 6. Verify ordering and message metadata
 * 7. Document any UX issues
 */

import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  navigateToOffice,
  navigateToRoom,
  switchToChatTab,
  switchToContentTab,
  isChatEnabled,
  sendGroupMessage,
  verifyGroupMessageReceived,
  verifyMessageOrder,
  waitForWorkspaceLoaded,
  isVisibleWithin,
  hasOffices,
  createOffice,
  createRoom,
  startDiagnostics,
  TestHarness,
  runTestMain,
  type DiagnosticsHandle,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: boolean;
  workspaceLoaded: boolean;

  /**
   * True when the offices came from docker/workspace-server/workspaces.json
   * rather than being created by this spec. Only seeded nodes get a
   * chat_channel_id (async_kernel.rs assigns one when chat_enabled is set in the
   * config); a node created through the UI is stored with chat_channel_id: None
   * and BaseOffice then renders no Chat tab at all. So this flag decides whether
   * "chat is enabled" is an assertion or a legitimate SKIP.
   */
  officesWereSeeded: boolean;

  // Office Chat Tests
  officeNavigation: boolean;
  officeChatEnabled: boolean;
  officeChatTabSwitch: boolean;
  officeMessageSent: boolean;
  officeMessageReceived: boolean;
  officeContentTabSwitch: boolean;

  // Room Chat Tests
  roomNavigation: boolean;
  roomChatEnabled: boolean;
  roomChatTabSwitch: boolean;
  roomMessageSent: boolean;
  roomMessageReceived: boolean;

  // Multi-message Tests
  multipleMessagesSent: boolean;
  messagesOrdered: boolean;

  // Message chrome
  timestampsRendered: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `groupchat_user_${timestamp}`;

// Default offices/rooms from docker/workspace-server/workspaces.json.
// Both are declared chat_enabled: true there.
const TEST_OFFICE = 'General';
const TEST_ROOM = 'Random';

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Group Messaging Integration Test',
    reportFileName: 'GROUP_MESSAGING_TEST_REPORT.json',
    metadata: { user: USER1, office: TEST_OFFICE, room: TEST_ROOM },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`User: ${USER1}`);
  console.log(`Test Office: ${TEST_OFFICE}`);
  console.log(`Test Room: ${TEST_ROOM}`);
  console.log('');

  // Setup browser
  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    officesWereSeeded: false,
    officeNavigation: false,
    officeChatEnabled: false,
    officeChatTabSwitch: false,
    officeMessageSent: false,
    officeMessageReceived: false,
    officeContentTabSwitch: false,
    roomNavigation: false,
    roomChatEnabled: false,
    roomChatTabSwitch: false,
    roomMessageSent: false,
    roomMessageReceived: false,
    multipleMessagesSent: false,
    messagesOrdered: false,
    timestampsRendered: false,
  };

  // Diagnostics handle (declared outside try block for finally access)
  let diagnostics: DiagnosticsHandle | null = null;

  try {
    const page = await context.newPage();

    // Start diagnostics - unified console error/warning collector and white-screen detector
    diagnostics = await startDiagnostics(page, {
      whiteScreenCheckInterval: 3000,
      realTimePrint: true,
      realTimeOnlyErrors: true,
    });

    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Account Creation');
    console.log('─'.repeat(50));

    results.accountCreation = await createAccount(page, USER1, {
      isFirstUser: true,  // First user initializes workspace
      uxTracker,
    });

    if (!results.accountCreation) {
      throw new Error('Account creation failed');
    }

    // Wait for workspace to fully load
    console.log('\n  Waiting for workspace to load...');
    results.workspaceLoaded = await waitForWorkspaceLoaded(page, 30000);
    await sleep(3000);

    // ========== STEP 1.5: Admin Status Observation ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1.5: Observe Admin Status After Initialization');
    console.log('─'.repeat(50));

    // AdminSettingsSection (src/components/layout/sidebar/AdminSettingsSection.tsx)
    // returns null unless state.currentUser.role is Admin, and its group label is
    // the literal "ADMIN SETTINGS". That makes it the one selector here that is
    // actually specific to being an admin. The list this replaced also probed
    // `[class*="admin"]` and `text="Admin"`, which match utility classes and any
    // stray occurrence of the word — a hit told you nothing.
    // Left as an observation rather than a gated assertion: this spec is about
    // messaging, and admin-role propagation is asserted by office-room-crud.
    const adminSection = page.getByText('ADMIN SETTINGS').first();
    const adminVisible = await isVisibleWithin(adminSection, 5000);
    if (adminVisible) {
      console.log('  Admin status confirmed via the ADMIN SETTINGS sidebar section');
    } else {
      uxTracker.log('suggestion', 'functional', 'ADMIN SETTINGS sidebar section not visible after workspace initialization');
      console.log('  Admin status not visually confirmed (UX observation, not a test failure)');
    }

    await takeScreenshot(page, `${USER1}_admin_status`);

    // ========== STEP 2: Check/Create Offices ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Check and Create Offices');
    console.log('─'.repeat(50));

    results.officesWereSeeded = await hasOffices(page, USER1);

    if (!results.officesWereSeeded) {
      console.log(`  No offices found. Attempting to create "${TEST_OFFICE}"...`);
      const officeCreated = await createOffice(page, USER1, TEST_OFFICE, 'General discussion and community', { uxTracker });

      if (!officeCreated) {
        console.log(`  WARNING: Could not create office. This may be a permissions issue.`);
        console.log(`  NOTE: The first user needs to initialize the workspace to gain admin permissions.`);
        uxTracker.log('major', 'functional', 'Cannot create office - may need workspace initialization or admin permissions');
      } else {
        // Create room under the office (new generic node system doesn't auto-create rooms)
        console.log(`  Creating room "${TEST_ROOM}" under "${TEST_OFFICE}"...`);
        const roomCreated = await createRoom(page, USER1, TEST_ROOM, TEST_OFFICE, 'Random discussions');
        if (!roomCreated) {
          console.log(`  WARNING: Could not create room "${TEST_ROOM}"`);
          uxTracker.log('major', 'functional', `Cannot create room "${TEST_ROOM}" under "${TEST_OFFICE}"`);
        }
      }
      uxTracker.log('major', 'functional',
        'Workspace initialization did not seed offices from workspaces.json; chat assertions were skipped because UI-created nodes have no chat channel');
    }

    // ========== STEP 3: Navigate to Office ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Navigate to Office');
    console.log('─'.repeat(50));

    results.officeNavigation = await navigateToOffice(page, USER1, TEST_OFFICE, { uxTracker });
    await sleep(2000);

    // ========== STEP 4: Check Office Chat ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Office Chat Test');
    console.log('─'.repeat(50));

    results.officeChatEnabled = await isChatEnabled(page, USER1);

    if (results.officeChatEnabled) {
      // Switch to Chat tab
      results.officeChatTabSwitch = await switchToChatTab(page, USER1, { uxTracker });

      if (results.officeChatTabSwitch) {
        // Send a message
        const officeMsg1 = `Hello from ${USER1} in ${TEST_OFFICE}! Time: ${new Date().toISOString()}`;
        results.officeMessageSent = await sendGroupMessage(page, USER1, officeMsg1, { uxTracker });

        // Verify the message appears (we sent it, so it should be visible)
        if (results.officeMessageSent) {
          await sleep(2000);
          results.officeMessageReceived = await verifyGroupMessageReceived(page, USER1, officeMsg1, 10000, { uxTracker });

          // GroupMessageFooter tags every rendered message with
          // data-testid="message-timestamp". The shared checkMessageTimestamps()
          // helper looks for `time`, `[class*="timestamp"]` or `.text-xs.text-gray`,
          // none of which this markup has, so it can only ever return false — see
          // the report note. Asserting the real testid is what makes this gateable.
          results.timestampsRendered = await isVisibleWithin(
            page.locator('[data-testid="message-timestamp"]').first(),
            10000
          );
          console.log(`  Message timestamps rendered: ${results.timestampsRendered}`);
        }
      }

      // Switch back to Content tab
      results.officeContentTabSwitch = await switchToContentTab(page, USER1, { uxTracker });
    } else {
      console.log(`  Office "${TEST_OFFICE}" does not have chat enabled`);
      uxTracker.log('suggestion', 'functional', `Office "${TEST_OFFICE}" chat is not enabled in config`);
    }

    // ========== STEP 5: Navigate to Room ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Navigate to Room');
    console.log('─'.repeat(50));

    results.roomNavigation = await navigateToRoom(page, USER1, TEST_ROOM, { uxTracker });
    await sleep(2000);

    // ========== STEP 6: Check Room Chat ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Room Chat Test');
    console.log('─'.repeat(50));

    results.roomChatEnabled = await isChatEnabled(page, USER1);

    if (results.roomChatEnabled) {
      // Switch to Chat tab
      results.roomChatTabSwitch = await switchToChatTab(page, USER1, { uxTracker });

      if (results.roomChatTabSwitch) {
        // Send a message
        const roomMsg1 = `Room message from ${USER1} in ${TEST_ROOM}! Time: ${new Date().toISOString()}`;
        results.roomMessageSent = await sendGroupMessage(page, USER1, roomMsg1, { uxTracker });

        // Verify the message appears
        if (results.roomMessageSent) {
          await sleep(2000);
          results.roomMessageReceived = await verifyGroupMessageReceived(page, USER1, roomMsg1, 10000, { uxTracker });
        }
      }
    } else {
      console.log(`  Room "${TEST_ROOM}" does not have chat enabled`);
      uxTracker.log('suggestion', 'functional', `Room "${TEST_ROOM}" chat is not enabled in config`);
    }

    // ========== STEP 7: Multiple Messages Test ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Multiple Messages Test');
    console.log('─'.repeat(50));

    if (results.roomChatEnabled && results.roomChatTabSwitch) {
      // Distinct suffixes: three Date.now() calls in one tick can return the same
      // millisecond, which used to make the three "unique" messages ambiguous.
      const batch = Date.now();
      const messages = [
        `Message 1 of 3: testing multiple messages ${batch}`,
        `Message 2 of 3: second message in sequence ${batch}`,
        `Message 3 of 3: third message to verify ordering ${batch}`,
      ];

      let allSent = true;
      for (const msg of messages) {
        const sent = await sendGroupMessage(page, USER1, msg, { uxTracker });
        if (!sent) allSent = false;
        await sleep(1000);
      }

      results.multipleMessagesSent = allSent;

      // The old version set `messagesOrdered` from three independent "did this
      // message appear" checks, which says nothing about order — it was true for
      // any arrangement, including reversed. verifyMessageOrder walks the rendered
      // message elements and requires each expected message to appear after the
      // previous one.
      await sleep(2000);
      const order = await verifyMessageOrder(page, USER1, messages, 30000, uxTracker);
      results.messagesOrdered = order.success;
    }

    // Final screenshot
    await takeScreenshot(page, 'FINAL_group_messaging');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const coreFunctionality =
      results.accountCreation &&
      results.workspaceLoaded;

    // When the workspace was seeded from workspaces.json, "General" and "Random"
    // are declared chat_enabled, so chat MUST work — the old `!results.chatEnabled
    // || ...` shape turned a missing Chat tab into a silent pass, which is exactly
    // the failure this spec exists to catch.
    const chatExpected = results.officesWereSeeded;

    const officeChatWorks = chatExpected
      ? (results.officeChatEnabled &&
         results.officeChatTabSwitch &&
         results.officeMessageSent &&
         results.officeMessageReceived &&
         results.officeContentTabSwitch &&
         results.timestampsRendered)
      : true;

    const roomChatWorks = chatExpected
      ? (results.roomChatEnabled &&
         results.roomChatTabSwitch &&
         results.roomMessageSent &&
         results.roomMessageReceived &&
         results.multipleMessagesSent &&
         results.messagesOrdered)
      : true;

    const navigationWorks = results.officeNavigation && results.roomNavigation;

    const allPassed = coreFunctionality && navigationWorks && officeChatWorks && roomChatWorks;

    const chatVerdict = (value: boolean) => (chatExpected ? (value ? 'PASS' : 'FAIL') : 'SKIP');

    console.log('\nCore Functionality:');
    console.log(`  Account Creation:           ${results.accountCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Loaded:           ${results.workspaceLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Offices Seeded From Config: ${results.officesWereSeeded ? 'YES' : 'NO'}`);

    console.log('\nOffice Chat:');
    console.log(`  Navigate to Office:         ${results.officeNavigation ? 'PASS' : 'FAIL'}`);
    console.log(`  Chat Enabled:               ${chatVerdict(results.officeChatEnabled)}`);
    console.log(`  Switch to Chat Tab:         ${chatVerdict(results.officeChatTabSwitch)}`);
    console.log(`  Send Message:               ${chatVerdict(results.officeMessageSent)}`);
    console.log(`  Message Received:           ${chatVerdict(results.officeMessageReceived)}`);
    console.log(`  Switch to Content Tab:      ${chatVerdict(results.officeContentTabSwitch)}`);
    console.log(`  Message Timestamps:         ${chatVerdict(results.timestampsRendered)}`);

    console.log('\nRoom Chat:');
    console.log(`  Navigate to Room:           ${results.roomNavigation ? 'PASS' : 'FAIL'}`);
    console.log(`  Chat Enabled:               ${chatVerdict(results.roomChatEnabled)}`);
    console.log(`  Switch to Chat Tab:         ${chatVerdict(results.roomChatTabSwitch)}`);
    console.log(`  Send Message:               ${chatVerdict(results.roomMessageSent)}`);
    console.log(`  Message Received:           ${chatVerdict(results.roomMessageReceived)}`);

    console.log('\nMultiple Messages:');
    console.log(`  Multiple Messages Sent:     ${chatVerdict(results.multipleMessagesSent)}`);
    console.log(`  Messages In Order:          ${chatVerdict(results.messagesOrdered)}`);

    if (!chatExpected) {
      console.log('\n  SKIP reason: this run had to create its own office/room through the UI.');
      console.log('  UI-created nodes are stored with chat_channel_id: None, so no Chat tab exists');
      console.log('  and none of the chat assertions above have their precondition.');
    }

    console.log('\nNot exercised by this spec:');
    // GroupChatView only renders the rules banner when the node carries a `rules`
    // string. Neither "General" nor "Random" declares one in workspaces.json
    // (only "Landing Page" and "Engineering" do), so there is nothing to assert
    // here. The banner also has no data-testid, so it cannot be selected
    // reliably even where it does render — see the report.
    console.log('  Rules Banner:               SKIP (neither "General" nor "Random" declares rules in workspaces.json)');

    harness.finalize(allPassed, results);

    return allPassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    // Stop diagnostics and print report
    if (diagnostics) {
      console.log('\n' + '─'.repeat(50));
      console.log('Stopping diagnostics and generating report...');
      console.log('─'.repeat(50));
      const report = await diagnostics.stop();

      // Check if we had critical issues
      if (report.hadWhiteScreen) {
        console.log('\n⚠️  WHITE SCREEN DETECTED DURING TEST');
      }
      if (report.summary.pageErrorCount > 0) {
        console.log(`\n⚠️  ${report.summary.pageErrorCount} PAGE ERROR(S) DETECTED`);
      }
    }

    await browser.close();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
