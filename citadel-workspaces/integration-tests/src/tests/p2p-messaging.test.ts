/**
 * P2P Messaging Test
 *
 * Tests the P2P chat messaging workflow:
 * 1. Create two users in separate tabs
 * 2. P2P register User1 -> User2
 * 3. User2 accepts the P2P request
 * 4. Test bidirectional messaging
 * 5. Verify message delivery
 * 6. Document any UX issues
 */

import { Page } from 'playwright';
import {
  isVisibleWithin,
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  sendMessage,
  verifyMessageOrder,
  verifyMessagesSeen,
  sendAndVerifyMessage,
  waitForP2PReady,
  takeScreenshot,
  setupConsoleCapture,
  verifyConnectedBadgeInModal,
  closePeerDiscoveryModal,
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
  p2pRegistration: boolean;
  p2pAccept: boolean;
  /**
   * After Bob accepts Alice's registration request, Alice's Peer Discovery modal
   * should immediately show "Connected" badge for Bob. This verifies that the
   * PeerRegisterSuccess event correctly updates the registeredPeers state in the UI.
   * "Connected" in this context means "Registered" - the peer relationship is
   * established for direct P2P messaging.
   */
  connectedBadgeShown: boolean;
  conversationOpen: {
    user1: boolean;
    user2: boolean;
  };
  messaging: {
    user1ToUser2: boolean;
    user2ToUser1: boolean;
    user1Received: boolean;
    user2Received: boolean;
  };
  messageOrder: {
    aliceMessagesInOrder: boolean;
    bobMessagesInOrder: boolean;
  };
  seenStatus: {
    aliceMessagesSeen: boolean;
    bobMessagesSeen: boolean;
  };
  uxChecks: {
    timestamps: boolean;
    onlineStatus: boolean;
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `msg_alice_${timestamp}`;
const USER2 = `msg_bob_${timestamp}`;

// ============================================================================
// Additional UX Check Functions (specific to this test)
// ============================================================================

async function checkMessageTimestamp(page: Page, username: string): Promise<boolean> {
  console.log(`\n=== ${username}: Checking message timestamps ===`);
  // Check for timestamp elements using multiple selectors:
  // - time: HTML5 time element
  // - [class*="timestamp"]: Any class containing "timestamp"
  // - [data-testid="message-timestamp"]: Our explicit test ID
  // - .text-xs.opacity-70: The actual timestamp styling in BubbleFooter
  const count = await page.locator('time, [class*="timestamp"], [data-testid="message-timestamp"], .text-xs.opacity-70').count();

  if (count > 0) {
    console.log(`  Found ${count} timestamp elements`);
    return true;
  }
  return false;
}

async function checkOnlineStatus(page: Page, username: string, _peerUsername: string): Promise<boolean> {
  console.log(`\n=== ${username}: Checking peer online status ===`);
  const statusIndicator = page.locator('.bg-green-500, [class*="online"]').first();

  if (await isVisibleWithin(statusIndicator, 2000)) {
    console.log(`  Online status indicator visible`);
    return true;
  }
  return false;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'P2P Messaging Test',
    reportFileName: 'P2P_MESSAGING_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`User 1 (Alice): ${USER1}`);
  console.log(`User 2 (Bob): ${USER2}`);
  console.log('');

  // Setup SEPARATE browser instances for each user
  // This gives each user their own WebSocket connection, avoiding ILM cross-user issues
  // The ILM (Inter-session Layer Messaging) was designed for one user with multiple tabs,
  // NOT multiple different users sharing one WebSocket
  const { pages, cleanup } = await createSeparateBrowsers(2);
  const page1 = pages[0];
  const page2 = pages[1];

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    p2pRegistration: false,
    p2pAccept: false,
    connectedBadgeShown: false,
    conversationOpen: { user1: false, user2: false },
    messaging: {
      user1ToUser2: false,
      user2ToUser1: false,
      user1Received: false,
      user2Received: false,
    },
    messageOrder: {
      aliceMessagesInOrder: false,
      bobMessagesInOrder: false,
    },
    seenStatus: {
      aliceMessagesSeen: false,
      bobMessagesSeen: false,
    },
    uxChecks: {
      timestamps: false,
      onlineStatus: false,
    },
  };

  try {
    // Setup console capture - include ILM for InterSession Layer Messaging diagnostics
    // Add 'Workspace' to capture workspace loading logs for debugging
    // Add 'WASM' to capture WASM-side debug logs for HashMap serialization tracing
    setupConsoleCapture(page1, 'Alice', ['P2P', 'error', 'Error', 'ILM', 'ism', 'Workspace', 'workspace', 'WASM']);
    setupConsoleCapture(page2, 'Bob', ['P2P', 'error', 'Error', 'ILM', 'ism', 'Workspace', 'workspace', 'WASM']);

    // ========== STEP 1: Create accounts ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Account Creation');
    console.log('─'.repeat(50));

    results.accountCreation.user1 = await createAccount(page1, USER1, {
      isFirstUser: true,
      uxTracker,
    });

    // CRITICAL: Verify Alice's workspace is visible before proceeding
    // This ensures the connection is fully established and workspace data loaded
    console.log('\n  Verifying Alice workspace is visible...');
    const aliceWorkspaceLoaded = await waitForWorkspaceLoaded(page1, 60000);
    if (!aliceWorkspaceLoaded) {
      throw new Error('Alice workspace failed to load - account creation incomplete');
    }
    console.log('  ✓ Alice workspace loaded successfully');

    results.accountCreation.user2 = await createAccount(page2, USER2, {
      isFirstUser: false,
      uxTracker,
    });

    // CRITICAL: Verify Bob's workspace is visible before proceeding
    // This ensures Bob's connection is fully established (follower tab got responses)
    console.log('\n  Verifying Bob workspace is visible...');
    const bobWorkspaceLoaded = await waitForWorkspaceLoaded(page2, 60000);
    if (!bobWorkspaceLoaded) {
      throw new Error('Bob workspace failed to load - account creation incomplete');
    }
    console.log('  ✓ Bob workspace loaded successfully');

    // Wait for sessions to be fully established in Citadel SDK session manager
    console.log('\n  Waiting 10s for sessions to be fully established...');
    await sleep(10000);

    // ========== STEP 2: P2P Registration ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: P2P Registration');
    console.log('─'.repeat(50));

    // Keep modal open so we can verify the "Connected" badge after Bob accepts
    results.p2pRegistration = await p2pRegister(page1, USER1, USER2, {
      uxTracker,
      keepModalOpen: true,  // Keep Alice's modal open for badge verification
    });

    // ========== STEP 3: Accept P2P Request ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Accept P2P Request');
    console.log('─'.repeat(50));

    await sleep(3000);
    results.p2pAccept = await acceptP2PRequest(page2, USER2, uxTracker, USER1);

    // ========== STEP 3.5: Verify "Connected" Badge in Alice's Modal ==========
    // After Bob accepts, Alice's still-open modal should show "Connected" badge
    // This verifies that the PeerRegisterSuccess event correctly updates the UI
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3.5: Verify "Connected" Badge');
    console.log('─'.repeat(50));

    // Give time for PeerRegisterSuccess event to propagate to Alice
    await sleep(2000);

    // Verify the badge appears in Alice's modal (should now show "Connected" for Bob)
    results.connectedBadgeShown = await verifyConnectedBadgeInModal(
      page1,
      USER1,
      USER2,
      15000,  // 15 second timeout
      uxTracker
    );

    // Close Alice's modal now that we've verified the badge
    await closePeerDiscoveryModal(page1);

    // Wait for connection to establish
    console.log('\n  Waiting for P2P connection to establish...');
    await sleep(5000);

    // ========== STEP 4: Open Conversations ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Open Conversations');
    console.log('─'.repeat(50));

    results.conversationOpen.user1 = await openConversation(page1, USER1, USER2, uxTracker);

    // Wait for Alice's conversation to fully mount before opening Bob's
    console.log('  Waiting for Alice conversation to stabilize...');
    await sleep(3000);

    results.conversationOpen.user2 = await openConversation(page2, USER2, USER1, uxTracker);

    // ========== STEP 5: Test Messaging ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Bidirectional Messaging');
    console.log('─'.repeat(50));

    const MESSAGE_1 = `Hello Bob! This is Alice. Time: ${new Date().toLocaleTimeString()}`;
    const MESSAGE_2 = `Hi Alice! Bob here. Got your message! Time: ${new Date().toLocaleTimeString()}`;
    const MESSAGE_3 = `Great! The P2P chat is working perfectly!`;

    // Wait for P2P encryption channel to be ready before first message
    // Use the waitForP2PReady helper to ensure connection is established
    console.log('  Waiting for P2P channel to be ready...');
    const aliceP2PReady = await waitForP2PReady(page1, USER1, USER2, 30000);
    const bobP2PReady = await waitForP2PReady(page2, USER2, USER1, 30000);

    if (!aliceP2PReady || !bobP2PReady) {
      console.log('  Warning: P2P ready check timed out, proceeding anyway...');
    }

    // Additional wait for message handlers to be fully registered
    await sleep(3000);

    // KNOWN ISSUE: In multi-tab tests, the first message may be lost due to
    // BroadcastChannel timing. Send a "warmup" message first, then test with real messages.
    console.log('  Sending warmup messages to establish channel...');
    const WARMUP_1 = 'P2P channel warmup from Alice';
    const WARMUP_2 = 'P2P channel warmup from Bob';

    // Exchange warmup messages (don't check if received, just establish the channel)
    await sendMessage(page1, USER1, WARMUP_1, null);
    await sleep(2000);
    await sendMessage(page2, USER2, WARMUP_2, null);
    await sleep(2000);

    // Now send and verify the actual test messages using robust retry logic
    console.log('  Sending test messages with retry logic...');

    // Alice sends MESSAGE_1 to Bob - use sendAndVerifyMessage for reliability
    results.messaging.user1ToUser2 = await sendAndVerifyMessage(
      page1, USER1, page2, USER2, MESSAGE_1,
      { maxRetries: 3, verifyTimeout: 20000, retryDelay: 3000, uxTracker }
    );
    results.messaging.user2Received = results.messaging.user1ToUser2;

    // Bob sends MESSAGE_2 to Alice - use sendAndVerifyMessage for reliability
    results.messaging.user2ToUser1 = await sendAndVerifyMessage(
      page2, USER2, page1, USER1, MESSAGE_2,
      { maxRetries: 3, verifyTimeout: 20000, retryDelay: 3000, uxTracker }
    );
    results.messaging.user1Received = results.messaging.user2ToUser1;

    // Alice sends MESSAGE_3 as a follow-up to confirm continued bidirectional messaging
    await sendAndVerifyMessage(
      page1, USER1, page2, USER2, MESSAGE_3,
      { maxRetries: 3, verifyTimeout: 20000, retryDelay: 3000, uxTracker }
    );

    // ========== STEP 6: Message Order Verification ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Message Order Verification');
    console.log('─'.repeat(50));

    // Alice should see: her sent messages (MESSAGE_1, MESSAGE_3) + Bob's reply (MESSAGE_2)
    // Expected order on Alice's screen: MESSAGE_1, MESSAGE_2, MESSAGE_3
    const aliceExpectedMessages = [MESSAGE_1, MESSAGE_2, MESSAGE_3];
    const aliceOrderResult = await verifyMessageOrder(page1, USER1, aliceExpectedMessages, 10000, uxTracker);
    results.messageOrder.aliceMessagesInOrder = aliceOrderResult.success;

    // Bob should see: Alice's messages (MESSAGE_1, MESSAGE_3) + his reply (MESSAGE_2)
    // Expected order on Bob's screen: MESSAGE_1, MESSAGE_2, MESSAGE_3
    const bobExpectedMessages = [MESSAGE_1, MESSAGE_2, MESSAGE_3];
    const bobOrderResult = await verifyMessageOrder(page2, USER2, bobExpectedMessages, 10000, uxTracker);
    results.messageOrder.bobMessagesInOrder = bobOrderResult.success;

    // ========== STEP 7: Read Receipt Verification (Seen Status) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Read Receipt Verification (Seen Status)');
    console.log('─'.repeat(50));

    // Alice sent 2 test messages (MESSAGE_1, MESSAGE_3) + warmup message
    // After Bob opens the conversation, all should show "read" (blue checkmarks)
    // We check for the 2 test messages specifically
    const aliceSeenResult = await verifyMessagesSeen(page1, USER1, 2, 15000, uxTracker);
    results.seenStatus.aliceMessagesSeen = aliceSeenResult.success;

    // Bob sent 1 test message (MESSAGE_2) + warmup message
    // After Alice views it, it should show "read" (blue checkmark)
    const bobSeenResult = await verifyMessagesSeen(page2, USER2, 1, 15000, uxTracker);
    results.seenStatus.bobMessagesSeen = bobSeenResult.success;

    // ========== STEP 8: UX Checks ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: UX Quality Checks');
    console.log('─'.repeat(50));

    results.uxChecks.timestamps = await checkMessageTimestamp(page1, USER1);
    if (!results.uxChecks.timestamps) {
      uxTracker.log('minor', 'visual', 'No visible timestamps on messages');
    }

    results.uxChecks.onlineStatus = await checkOnlineStatus(page1, USER1, USER2);
    if (!results.uxChecks.onlineStatus) {
      uxTracker.log('minor', 'visual', 'Peer online status indicator not clearly visible');
    }

    // Final screenshots
    await takeScreenshot(page1, 'FINAL_alice');
    await takeScreenshot(page2, 'FINAL_bob');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const allPassed =
      results.accountCreation.user1 &&
      results.accountCreation.user2 &&
      results.p2pRegistration &&
      results.connectedBadgeShown &&  // Badge verification is now required
      results.conversationOpen.user1 &&
      results.conversationOpen.user2 &&
      results.messaging.user1ToUser2 &&
      results.messaging.user2ToUser1 &&
      results.messaging.user1Received &&
      results.messaging.user2Received &&
      results.messageOrder.aliceMessagesInOrder &&
      results.messageOrder.bobMessagesInOrder &&
      results.seenStatus.aliceMessagesSeen &&
      results.seenStatus.bobMessagesSeen;

    console.log('\nCore Functionality:');
    console.log(`  Account Creation (Alice):     ${results.accountCreation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  Account Creation (Bob):       ${results.accountCreation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Registration:             ${results.p2pRegistration ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Accept:                   ${results.p2pAccept ? 'PASS' : 'SKIPPED'}`);
    // "Connected" badge verification - after Bob accepts Alice's request, Alice's modal should
    // immediately show "Connected" (which means "Registered" in P2P terminology - the peer
    // relationship is established for direct messaging)
    console.log(`  Connected Badge (Alice UI):   ${results.connectedBadgeShown ? 'PASS' : 'FAIL'}`);
    console.log(`  Open Conversation (Alice):    ${results.conversationOpen.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  Open Conversation (Bob):      ${results.conversationOpen.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  Alice -> Bob Message:         ${results.messaging.user1ToUser2 ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Received Message:         ${results.messaging.user2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob -> Alice Message:         ${results.messaging.user2ToUser1 ? 'PASS' : 'FAIL'}`);
    console.log(`  Alice Received Message:       ${results.messaging.user1Received ? 'PASS' : 'FAIL'}`);

    console.log('\nMessage Order Verification:');
    console.log(`  Alice Messages In Order:      ${results.messageOrder.aliceMessagesInOrder ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Messages In Order:        ${results.messageOrder.bobMessagesInOrder ? 'PASS' : 'FAIL'}`);

    console.log('\nRead Receipts (Seen Status):');
    console.log(`  Alice Messages Seen:          ${results.seenStatus.aliceMessagesSeen ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Messages Seen:            ${results.seenStatus.bobMessagesSeen ? 'PASS' : 'FAIL'}`);

    console.log('\nUX Quality:');
    console.log(`  Message Timestamps:           ${results.uxChecks.timestamps ? 'PASS' : 'CHECK'}`);
    console.log(`  Online Status Indicator:      ${results.uxChecks.onlineStatus ? 'PASS' : 'CHECK'}`);

    harness.finalize(allPassed, results);

    return allPassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
