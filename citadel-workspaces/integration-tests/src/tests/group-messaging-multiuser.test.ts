/**
 * Multi-User Group Messaging Integration Test
 *
 * Tests group chat messaging with multiple users:
 * 1. Create two users in separate tabs
 * 2. Both navigate to the same office
 * 3. Both switch to Chat tab
 * 4. User1 sends a message, User2 receives it
 * 5. User2 sends a reply, User1 receives it
 * 6. Both navigate to the same room
 * 7. Test bidirectional messaging in room
 * 8. Document any UX issues
 */

import {
  sleep,
  createBrowser,
  createIsolatedContexts,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
  navigateToOffice,
  navigateToRoom,
  switchToChatTab,
  isChatEnabled,
  sendGroupMessage,
  verifyGroupMessageReceived,
  waitForWorkspaceLoaded,
  TestHarness,
  runTestMain,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: {
    user1: boolean;
    user2: boolean;
  };

  // Office Chat Tests
  officeNavigation: {
    user1: boolean;
    user2: boolean;
  };
  officeChatEnabled: boolean;
  officeChatTab: {
    user1: boolean;
    user2: boolean;
  };
  officeMessaging: {
    user1Sent: boolean;
    user2Received: boolean;
    user2Sent: boolean;
    user1Received: boolean;
  };

  // Room Chat Tests
  roomNavigation: {
    user1: boolean;
    user2: boolean;
  };
  roomChatEnabled: boolean;
  roomChatTab: {
    user1: boolean;
    user2: boolean;
  };
  roomMessaging: {
    user1Sent: boolean;
    user2Received: boolean;
    user2Sent: boolean;
    user1Received: boolean;
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `grp_alice_${timestamp}`;
const USER2 = `grp_bob_${timestamp}`;

// Default offices/rooms from workspaces.json config
const TEST_OFFICE = 'General';
const TEST_ROOM = 'Random';

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Multi-User Group Messaging Test',
    reportFileName: 'GROUP_MESSAGING_MULTIUSER_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2, office: TEST_OFFICE, room: TEST_ROOM },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`User 1: ${USER1}`);
  console.log(`User 2: ${USER2}`);
  console.log(`Test Office: ${TEST_OFFICE}`);
  console.log(`Test Room: ${TEST_ROOM}`);
  console.log('');

  // Setup browser with isolated contexts (separate storage per user to avoid IndexedDB conflicts)
  const { browser } = await createBrowser();
  const [context1, context2] = await createIsolatedContexts(browser, 2);

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    officeNavigation: { user1: false, user2: false },
    officeChatEnabled: false,
    officeChatTab: { user1: false, user2: false },
    officeMessaging: {
      user1Sent: false,
      user2Received: false,
      user2Sent: false,
      user1Received: false,
    },
    roomNavigation: { user1: false, user2: false },
    roomChatEnabled: false,
    roomChatTab: { user1: false, user2: false },
    roomMessaging: {
      user1Sent: false,
      user2Received: false,
      user2Sent: false,
      user1Received: false,
    },
  };

  try {
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();

    // Setup console capture
    setupConsoleCapture(page1, 'Alice', ['group', 'chat', 'message', 'error', 'ILM']);
    setupConsoleCapture(page2, 'Bob', ['group', 'chat', 'message', 'error', 'ILM']);

    // ========== STEP 1: Create Accounts ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Account Creation');
    console.log('─'.repeat(50));

    results.accountCreation.user1 = await createAccount(page1, USER1, {
      isFirstUser: true,
      uxTracker,
    });

    results.accountCreation.user2 = await createAccount(page2, USER2, {
      isFirstUser: false,
      uxTracker,
    });

    // Wait for workspaces to load
    console.log('\n  Waiting for workspaces to load...');
    await waitForWorkspaceLoaded(page1, 30000);
    await waitForWorkspaceLoaded(page2, 30000);
    await sleep(3000);

    // ========== STEP 2: Both Navigate to Office ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Navigate to Office');
    console.log('─'.repeat(50));

    results.officeNavigation.user1 = await navigateToOffice(page1, USER1, TEST_OFFICE, { uxTracker });
    results.officeNavigation.user2 = await navigateToOffice(page2, USER2, TEST_OFFICE, { uxTracker });
    await sleep(2000);

    // ========== STEP 3: Office Chat Test ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Office Group Chat Test');
    console.log('─'.repeat(50));

    results.officeChatEnabled = await isChatEnabled(page1, USER1);

    if (results.officeChatEnabled) {
      // Both switch to Chat tab
      results.officeChatTab.user1 = await switchToChatTab(page1, USER1, { uxTracker });
      results.officeChatTab.user2 = await switchToChatTab(page2, USER2, { uxTracker });
      await sleep(2000);

      if (results.officeChatTab.user1 && results.officeChatTab.user2) {
        // User1 sends a message
        const msg1 = `Hello from ${USER1}! Office chat test. Time: ${new Date().toISOString()}`;
        results.officeMessaging.user1Sent = await sendGroupMessage(page1, USER1, msg1, { uxTracker });
        await sleep(3000);

        // User2 should receive it
        if (results.officeMessaging.user1Sent) {
          results.officeMessaging.user2Received = await verifyGroupMessageReceived(page2, USER2, msg1, 15000, { uxTracker });
        }

        // User2 sends a reply
        const msg2 = `Reply from ${USER2}! Got your message. Time: ${new Date().toISOString()}`;
        results.officeMessaging.user2Sent = await sendGroupMessage(page2, USER2, msg2, { uxTracker });
        await sleep(3000);

        // User1 should receive it
        if (results.officeMessaging.user2Sent) {
          results.officeMessaging.user1Received = await verifyGroupMessageReceived(page1, USER1, msg2, 15000, { uxTracker });
        }
      }
    } else {
      console.log(`  Office "${TEST_OFFICE}" does not have chat enabled, skipping office chat test`);
    }

    // ========== STEP 4: Both Navigate to Room ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Navigate to Room');
    console.log('─'.repeat(50));

    results.roomNavigation.user1 = await navigateToRoom(page1, USER1, TEST_ROOM, { uxTracker });
    results.roomNavigation.user2 = await navigateToRoom(page2, USER2, TEST_ROOM, { uxTracker });
    await sleep(2000);

    // ========== STEP 5: Room Chat Test ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Room Group Chat Test');
    console.log('─'.repeat(50));

    results.roomChatEnabled = await isChatEnabled(page1, USER1);

    if (results.roomChatEnabled) {
      // Both switch to Chat tab
      results.roomChatTab.user1 = await switchToChatTab(page1, USER1, { uxTracker });
      results.roomChatTab.user2 = await switchToChatTab(page2, USER2, { uxTracker });
      await sleep(2000);

      if (results.roomChatTab.user1 && results.roomChatTab.user2) {
        // User1 sends a message
        const roomMsg1 = `Room message from ${USER1}! Testing ${TEST_ROOM}. Time: ${new Date().toISOString()}`;
        results.roomMessaging.user1Sent = await sendGroupMessage(page1, USER1, roomMsg1, { uxTracker });
        await sleep(3000);

        // User2 should receive it
        if (results.roomMessaging.user1Sent) {
          results.roomMessaging.user2Received = await verifyGroupMessageReceived(page2, USER2, roomMsg1, 15000, { uxTracker });
        }

        // User2 sends a reply
        const roomMsg2 = `Room reply from ${USER2}! I see your message! Time: ${new Date().toISOString()}`;
        results.roomMessaging.user2Sent = await sendGroupMessage(page2, USER2, roomMsg2, { uxTracker });
        await sleep(3000);

        // User1 should receive it
        if (results.roomMessaging.user2Sent) {
          results.roomMessaging.user1Received = await verifyGroupMessageReceived(page1, USER1, roomMsg2, 15000, { uxTracker });
        }
      }
    } else {
      console.log(`  Room "${TEST_ROOM}" does not have chat enabled, skipping room chat test`);
    }

    // Final screenshots
    await takeScreenshot(page1, 'FINAL_alice_group');
    await takeScreenshot(page2, 'FINAL_bob_group');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const accountsCreated = results.accountCreation.user1 && results.accountCreation.user2;

    // The seeded workspace declares its offices and rooms chat_enabled, so chat
    // MUST work. The old `!results.officeChatEnabled || ...` shape turned a
    // BROKEN Chat tab into a silent pass — `isChatEnabled()` returns false
    // whenever no tab is visible, including when a regression removed it. The
    // sibling spec (group-messaging.test.ts) was repaired for exactly this and
    // the fix was never propagated here.
    //
    // Navigation was printed PASS/FAIL and gated on nothing at all, so a spec
    // that could not even reach an office still reported success.
    const chatExpected = results.accountCreation.user1 && results.accountCreation.user2;

    const officeTestPassed = (chatExpected ? results.officeChatEnabled : true) && (
      results.officeNavigation.user1 &&
      results.officeNavigation.user2 &&
      results.officeChatTab.user1 &&
      results.officeChatTab.user2 &&
      results.officeMessaging.user1Sent &&
      results.officeMessaging.user2Received &&
      results.officeMessaging.user2Sent &&
      results.officeMessaging.user1Received
    );

    const roomTestPassed = (chatExpected ? results.roomChatEnabled : true) && (
      results.roomNavigation.user1 &&
      results.roomNavigation.user2 &&
      results.roomChatTab.user1 &&
      results.roomChatTab.user2 &&
      results.roomMessaging.user1Sent &&
      results.roomMessaging.user2Received &&
      results.roomMessaging.user2Sent &&
      results.roomMessaging.user1Received
    );

    const allPassed = accountsCreated && officeTestPassed && roomTestPassed;

    console.log('\nAccount Creation:');
    console.log(`  User 1 (${USER1}):           ${results.accountCreation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User 2 (${USER2}):           ${results.accountCreation.user2 ? 'PASS' : 'FAIL'}`);

    console.log('\nOffice Chat (${TEST_OFFICE}):');
    console.log(`  Chat Enabled:               ${results.officeChatEnabled ? 'YES' : 'NO'}`);
    console.log(`  User1 Navigate:             ${results.officeNavigation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User2 Navigate:             ${results.officeNavigation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  User1 Chat Tab:             ${results.officeChatTab.user1 ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 Chat Tab:             ${results.officeChatTab.user2 ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User1 -> User2 Msg:         ${results.officeMessaging.user1Sent ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 Received:             ${results.officeMessaging.user2Received ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 -> User1 Msg:         ${results.officeMessaging.user2Sent ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User1 Received:             ${results.officeMessaging.user1Received ? 'PASS' : results.officeChatEnabled ? 'FAIL' : 'SKIP'}`);

    console.log('\nRoom Chat (${TEST_ROOM}):');
    console.log(`  Chat Enabled:               ${results.roomChatEnabled ? 'YES' : 'NO'}`);
    console.log(`  User1 Navigate:             ${results.roomNavigation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User2 Navigate:             ${results.roomNavigation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  User1 Chat Tab:             ${results.roomChatTab.user1 ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 Chat Tab:             ${results.roomChatTab.user2 ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User1 -> User2 Msg:         ${results.roomMessaging.user1Sent ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 Received:             ${results.roomMessaging.user2Received ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User2 -> User1 Msg:         ${results.roomMessaging.user2Sent ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);
    console.log(`  User1 Received:             ${results.roomMessaging.user1Received ? 'PASS' : results.roomChatEnabled ? 'FAIL' : 'SKIP'}`);

    harness.finalize(allPassed, results);

    return allPassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
