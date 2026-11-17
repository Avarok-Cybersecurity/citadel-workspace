/**
 * Hard Disconnect Offline Messaging Test
 *
 * Tests offline messaging with EXPLICIT disconnect (Sign out) and re-login.
 * Unlike the standard offline test which uses TCP drop + ClaimSession,
 * this test uses the "Sign out" button and requires credential re-login.
 *
 * Test Flow:
 * 1. Create two users in separate browser processes
 * 2. P2P register User1 -> User2
 * 3. User2 accepts the P2P request
 * 4. Test bidirectional messaging (verify P2P works)
 * 5. User2 disconnects via TopBar "Sign out" (explicit disconnect)
 * 6. Assert User2 is NOT in OrphanSessionsNavbar (session removed, not orphaned)
 * 7. User1 sends messages while User2 is offline (ILM queues them)
 * 8. User2 logs back in with credentials (new session created)
 * 9. Wait for P2PAutoConnect to re-establish P2P connection
 * 10. Verify User2 received offline messages
 * 11. Exchange post-reconnect messages
 *
 * Key Differences from ClaimSession Test:
 * - Explicit disconnect destroys the session (not orphaned)
 * - Login preserves the SAME CID (only Register creates new CID)
 * - P2P registration persists (stored on server)
 * - P2PAutoConnect automatically reconnects to registered peers
 * - ILM delivers queued messages using the preserved CID
 *
 */

import {
  settleServerAutoConnect,
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  sendMessage,
  sendAndVerifyMessage,
  waitForAllMessages,
  waitForP2PReady,
  waitForP2PConnection,
  disconnectViaTopBar,
  assertSessionNotInOrphanNavbar,
  loginAfterDisconnect,
  takeScreenshot,
  setupConsoleCapture,
  config,
  connectP2P,
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
  conversationOpen: {
    user1: boolean;
    user2: boolean;
  };
  initialMessaging: {
    user1ToUser2: boolean;
    user2ToUser1: boolean;
    user1Received: boolean;
    user2Received: boolean;
  };
  disconnection: {
    user2Disconnected: boolean;
    sessionNotOrphaned: boolean;
  };
  offlineMessages: {
    message1Sent: boolean;
    message2Sent: boolean;
    message3Sent: boolean;
  };
  reconnection: {
    user2LoggedIn: boolean;
    p2pReEstablished: boolean;
  };
  offlineDelivery: {
    message1Received: boolean;
    message2Received: boolean;
    message3Received: boolean;
  };
  postReconnectMessaging: {
    user1ToUser2: boolean;
    user2ToUser1: boolean;
    user1Received: boolean;
    user2Received: boolean;
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `harddc_alice_${timestamp}`;
const USER2 = `harddc_bob_${timestamp}`;

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'Hard Disconnect Offline Messaging Test',
    reportFileName: 'HARD_DISCONNECT_OFFLINE_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
  });
  const uxTracker = harness.uxTracker;

  console.log(`User 1 (Alice): ${USER1}`);
  console.log(`User 2 (Bob): ${USER2}`);
  console.log('');

  // Use SEPARATE browser processes to eliminate Chrome tab throttling
  const { pages: [page1, page2], cleanup } = await createSeparateBrowsers(2);

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    p2pRegistration: false,
    p2pAccept: false,
    conversationOpen: { user1: false, user2: false },
    initialMessaging: {
      user1ToUser2: false,
      user2ToUser1: false,
      user1Received: false,
      user2Received: false,
    },
    disconnection: {
      user2Disconnected: false,
      sessionNotOrphaned: false,
    },
    offlineMessages: {
      message1Sent: false,
      message2Sent: false,
      message3Sent: false,
    },
    reconnection: {
      user2LoggedIn: false,
      p2pReEstablished: false,
    },
    offlineDelivery: {
      message1Received: false,
      message2Received: false,
      message3Received: false,
    },
    postReconnectMessaging: {
      user1ToUser2: false,
      user2ToUser1: false,
      user1Received: false,
      user2Received: false,
    },
  };

  try {
    // Setup console capture - include Connect logs for debugging login flow
    setupConsoleCapture(page1, 'Alice', ['P2P', 'error', 'Error', 'ILM', 'Connect', 'WS-MSG', 'websocket']);
    setupConsoleCapture(page2, 'Bob', ['P2P', 'error', 'Error', 'ILM', 'Connect', 'WS-MSG', 'websocket']);

    // ========== STEP 1: Create accounts ==========
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

    if (!results.accountCreation.user1 || !results.accountCreation.user2) {
      throw new Error('Account creation failed');
    }

    console.log('\n  Waiting 10s for sessions to be fully established...');
    await sleep(10000);

    // ========== STEP 2: P2P Registration ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: P2P Registration');
    console.log('─'.repeat(50));

    results.p2pRegistration = await p2pRegister(page1, USER1, USER2, uxTracker);

    if (!results.p2pRegistration) {
      throw new Error('P2P registration failed');
    }

    // ========== STEP 3: Accept P2P Request ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Accept P2P Request');
    console.log('─'.repeat(50));

    await sleep(3000);
    results.p2pAccept = await acceptP2PRequest(page2, USER2, uxTracker, USER1);

    // Wait for P2P connection to establish (same approach as passing offline-messaging test)
    // Use waitForP2PConnection which checks isPeerConnected + UI fallback,
    // NOT waitForP2PReady which requires registeredPeers state (can be lost during
    // ServerAutoConnect session recovery, causing permanent peer_not_found)
    console.log('\n  Waiting for P2P connection to establish...');
    const p2pConnected1 = await waitForP2PConnection(page1, USER1, USER2, 30000);
    const p2pConnected2 = await waitForP2PConnection(page2, USER2, USER1, 30000);
    console.log(`  P2P connection: Alice=${p2pConnected1}, Bob=${p2pConnected2}`);

    // ========== STEP 4: Open Conversations ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Open Conversations');
    console.log('─'.repeat(50));

    results.conversationOpen.user1 = await openConversation(page1, USER1, USER2, uxTracker);
    await sleep(3000);
    results.conversationOpen.user2 = await openConversation(page2, USER2, USER1, uxTracker);

    // If conversations couldn't be opened (peer not in sidebar), wait for P2P to settle
    // and retry. Avoid sending competing PeerConnect requests which can worsen the issue.
    if (!results.conversationOpen.user1 || !results.conversationOpen.user2) {
      console.log('  Conversations not opened, waiting for P2P to settle...');
      await sleep(10000);

      // Single retry attempt with explicit connectP2P only from the failing side
      if (!results.conversationOpen.user2) {
        await connectP2P(page2, USER2, USER1);
        await sleep(5000);
        results.conversationOpen.user2 = await openConversation(page2, USER2, USER1, uxTracker);
      }
      if (!results.conversationOpen.user1) {
        await connectP2P(page1, USER1, USER2);
        await sleep(5000);
        results.conversationOpen.user1 = await openConversation(page1, USER1, USER2, uxTracker);
      }

      if (!results.conversationOpen.user1 || !results.conversationOpen.user2) {
        throw new Error('Could not open conversations after P2P retry');
      }
    }

    // ========== STEP 5: Initial Bidirectional Messaging ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Initial Bidirectional Messaging');
    console.log('─'.repeat(50));

    // ServerAutoConnect polls every ~30s and a reconnect landing mid-test can
    // cause "Session Already Connected", which blocks ILM. This used to sleep 35s
    // — one full cycle — to be sure. Waiting for the reconnect queue to empty
    // asks the actual question and returns as soon as it is true.
    console.log('  Waiting for the ServerAutoConnect cycle to settle...');
    await settleServerAutoConnect(page1);
    await settleServerAutoConnect(page2);

    const INITIAL_MSG_1 = `Hello Bob! Time: ${new Date().toLocaleTimeString()}`;
    const INITIAL_MSG_2 = `Hi Alice! Got it! Time: ${new Date().toLocaleTimeString()}`;

    // Warmup with reduced retries (fail faster if ILM is blocked)
    console.log('  Sending verified warmup Alice→Bob (confirms ILM channel ready)...');
    const warmupDelivered = await sendAndVerifyMessage(
      page1, USER1, page2, USER2,
      `Warmup A→B ${Date.now()}`,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 3000 }
    );
    if (!warmupDelivered) {
      console.log('  Alice→Bob warmup failed — ILM channel may not be established');
    }

    console.log('  Sending verified warmup Bob→Alice (confirms reverse ILM channel)...');
    const reverseWarmupDelivered = await sendAndVerifyMessage(
      page2, USER2, page1, USER1,
      `Warmup B→A ${Date.now()}`,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 3000 }
    );
    if (!reverseWarmupDelivered) {
      console.log('  Bob→Alice warmup failed — reverse ILM channel may not be established');
    }

    if (!warmupDelivered && !reverseWarmupDelivered) {
      console.log('  FAIL: Both warmup messages failed — ILM channels not established');
      results.initialMessaging.user1Received = false;
      results.initialMessaging.user2Received = false;
      throw new Error('Both warmup messages failed — P2P channels not established');
    }

    // Test bidirectional messaging with retry logic
    results.initialMessaging.user2Received = await sendAndVerifyMessage(
      page1, USER1, page2, USER2, INITIAL_MSG_1,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
    );
    results.initialMessaging.user1ToUser2 = results.initialMessaging.user2Received;

    results.initialMessaging.user1Received = await sendAndVerifyMessage(
      page2, USER2, page1, USER1, INITIAL_MSG_2,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
    );
    results.initialMessaging.user2ToUser1 = results.initialMessaging.user1Received;

    console.log(`  Initial messaging: Alice->Bob=${results.initialMessaging.user2Received}, Bob->Alice=${results.initialMessaging.user1Received}`);

    if (!results.initialMessaging.user1Received || !results.initialMessaging.user2Received) {
      throw new Error('Initial bidirectional messaging failed — P2P channel not established');
    }

    await takeScreenshot(page1, `${USER1}_initial_messaging`);
    await takeScreenshot(page2, `${USER2}_initial_messaging`);

    // ========== STEP 6: Bob Hard Disconnect (Sign out) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Bob Hard Disconnect (Sign out via TopBar)');
    console.log('─'.repeat(50));

    results.disconnection.user2Disconnected = await disconnectViaTopBar(page2, USER2, uxTracker);
    console.log(`  Bob disconnected: ${results.disconnection.user2Disconnected}`);

    if (!results.disconnection.user2Disconnected) {
      // Fallback: navigate to landing page to force disconnect
      console.log('  TopBar sign-out timed out, forcing navigation to landing page...');
      await page2.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 15000 });
      await sleep(3000);
      // Check if we landed on the login/landing page (not workspace)
      const currentUrl = page2.url();
      results.disconnection.user2Disconnected = !currentUrl.includes('/workspace');
      console.log(`  Forced disconnect: ${results.disconnection.user2Disconnected} (URL: ${currentUrl})`);
    }

    if (!results.disconnection.user2Disconnected) {
      throw new Error('Hard disconnect failed');
    }

    // Wait for disconnect to propagate
    console.log('  Waiting 10s for disconnect to propagate...');
    await sleep(10000);

    // ========== STEP 7: Assert Bob is NOT in OrphanSessionsNavbar ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Assert Session NOT Orphaned (explicitly disconnected)');
    console.log('─'.repeat(50));

    // Use Bob's browser to check the landing page
    results.disconnection.sessionNotOrphaned = await assertSessionNotInOrphanNavbar(page2, USER2, uxTracker);
    console.log(`  Session not orphaned: ${results.disconnection.sessionNotOrphaned}`);

    // ========== STEP 8: Alice Sends Offline Messages ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: Alice Sends Offline Messages');
    console.log('─'.repeat(50));

    const OFFLINE_MSG_1 = 'Bob, this is offline message 1 (hard disconnect test)';
    const OFFLINE_MSG_2 = 'Bob, this is offline message 2 (hard disconnect test)';
    const OFFLINE_MSG_3 = 'Bob, this is offline message 3 - did you get all of them?';

    // Ensure Alice's conversation is still open
    await openConversation(page1, USER1, USER2, uxTracker);

    results.offlineMessages.message1Sent = await sendMessage(page1, USER1, OFFLINE_MSG_1);
    console.log(`  Offline message 1: ${results.offlineMessages.message1Sent ? 'SENT' : 'FAILED'}`);
    // Wait longer between offline messages to avoid UI input debouncing issues
    await sleep(2500);

    results.offlineMessages.message2Sent = await sendMessage(page1, USER1, OFFLINE_MSG_2);
    console.log(`  Offline message 2: ${results.offlineMessages.message2Sent ? 'SENT' : 'FAILED'}`);
    await sleep(2500);

    results.offlineMessages.message3Sent = await sendMessage(page1, USER1, OFFLINE_MSG_3);
    console.log(`  Offline message 3: ${results.offlineMessages.message3Sent ? 'SENT' : 'FAILED'}`);

    await takeScreenshot(page1, `${USER1}_offline_messages_sent`);

    // ========== STEP 9: Bob Logs Back In ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 9: Bob Logs Back In With Credentials');
    console.log('─'.repeat(50));

    results.reconnection.user2LoggedIn = await loginAfterDisconnect(
      page2,
      USER2,
      config.DEFAULT_PASSWORD,
      uxTracker
    );
    console.log(`  Login: ${results.reconnection.user2LoggedIn ? 'SUCCESS' : 'FAILED'}`);

    if (!results.reconnection.user2LoggedIn) {
      console.log('  WARNING: Login failed - offline messages may not be delivered');
      await takeScreenshot(page2, `${USER2}_login_failed`);
    }

    // Wait for P2PAutoConnect to re-establish connections
    console.log('  Waiting for P2PAutoConnect to re-establish P2P connection...');
    let bobP2PReady = await waitForP2PReady(page2, USER2, USER1, 60000);
    console.log(`  P2P auto-reconnect: ${bobP2PReady ? 'SUCCESS' : 'TIMEOUT'}`);

    if (!bobP2PReady) {
      console.log('  P2PAutoConnect timed out, attempting explicit connectP2P...');
      await connectP2P(page2, USER2, USER1);
      bobP2PReady = await waitForP2PReady(page2, USER2, USER1, 30000);
      if (!bobP2PReady) {
        console.log('  Trying connectP2P from Alice side...');
        await connectP2P(page1, USER1, USER2);
        bobP2PReady = await waitForP2PReady(page2, USER2, USER1, 30000);
      }
      console.log(`  P2P after explicit connect: ${bobP2PReady ? 'SUCCESS' : 'TIMEOUT (continuing anyway)'}`);
    }

    // ========== STEP 10: Verify Offline Messages Received ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 10: Verify Offline Messages Received');
    console.log('─'.repeat(50));

    // Check if P2P was re-established by trying to open conversation
    results.reconnection.p2pReEstablished = await openConversation(page2, USER2, USER1, uxTracker);
    console.log(`  P2P re-established: ${results.reconnection.p2pReEstablished}`);

    if (!results.reconnection.p2pReEstablished) {
      console.log('  P2P not re-established, attempting explicit connectP2P...');
      await connectP2P(page2, USER2, USER1);
      await sleep(5000);
      results.reconnection.p2pReEstablished = await openConversation(page2, USER2, USER1, uxTracker);

      if (!results.reconnection.p2pReEstablished) {
        // Try from Alice's side
        console.log('  Trying connectP2P from Alice side...');
        await connectP2P(page1, USER1, USER2);
        await sleep(5000);
        results.reconnection.p2pReEstablished = await openConversation(page2, USER2, USER1, uxTracker);
      }
    }

    // Use reactive polling to wait for all offline messages at once
    // ILM guarantees intersession persistence — queued messages are delivered
    // automatically when P2P re-establishes. No warmup needed.
    // This is more efficient than sequential checks with fixed timeouts
    // ILM has significant control traffic (GetSessions, Poll, ACK) interspersed with data messages,
    // so offline messages may take a while to be delivered after reconnection
    const offlineMessageResults = await waitForAllMessages(
      page2,
      USER2,
      [OFFLINE_MSG_1, OFFLINE_MSG_2, OFFLINE_MSG_3],
      180000, // 180s (3 min) timeout - ILM delivery can be slow due to control traffic
      500    // Poll every 500ms
    );

    results.offlineDelivery.message1Received = offlineMessageResults.results[OFFLINE_MSG_1];
    results.offlineDelivery.message2Received = offlineMessageResults.results[OFFLINE_MSG_2];
    results.offlineDelivery.message3Received = offlineMessageResults.results[OFFLINE_MSG_3];

    console.log(`  Offline message 1: ${results.offlineDelivery.message1Received ? 'RECEIVED' : 'NOT RECEIVED'}`);
    console.log(`  Offline message 2: ${results.offlineDelivery.message2Received ? 'RECEIVED' : 'NOT RECEIVED'}`);
    console.log(`  Offline message 3: ${results.offlineDelivery.message3Received ? 'RECEIVED' : 'NOT RECEIVED'}`);

    await takeScreenshot(page2, `${USER2}_offline_messages_verification`);

    // ========== STEP 11: Post-Reconnect Bidirectional Messaging ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 11: Post-Reconnect Bidirectional Messaging');
    console.log('─'.repeat(50));

    const POST_MSG_1 = 'Welcome back Bob! Did you get my offline messages?';
    const POST_MSG_2 = 'Thanks Alice! Yes I got all of them (hard disconnect test)!';

    results.postReconnectMessaging.user2Received = await sendAndVerifyMessage(
      page1, USER1, page2, USER2, POST_MSG_1,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
    );
    results.postReconnectMessaging.user1ToUser2 = results.postReconnectMessaging.user2Received;

    results.postReconnectMessaging.user1Received = await sendAndVerifyMessage(
      page2, USER2, page1, USER1, POST_MSG_2,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
    );
    results.postReconnectMessaging.user2ToUser1 = results.postReconnectMessaging.user1Received;

    console.log(`  Post-reconnect: Alice->Bob=${results.postReconnectMessaging.user2Received}, Bob->Alice=${results.postReconnectMessaging.user1Received}`);

    await takeScreenshot(page1, `${USER1}_final`);
    await takeScreenshot(page2, `${USER2}_final`);

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const offlineDeliverySuccess =
      results.offlineDelivery.message1Received &&
      results.offlineDelivery.message2Received &&
      results.offlineDelivery.message3Received;

    const corePassed =
      results.accountCreation.user1 &&
      results.accountCreation.user2 &&
      results.p2pRegistration &&
      results.conversationOpen.user1 &&
      results.conversationOpen.user2 &&
      results.initialMessaging.user1Received &&
      results.initialMessaging.user2Received &&
      results.disconnection.user2Disconnected &&
      results.disconnection.sessionNotOrphaned &&
      results.reconnection.user2LoggedIn &&
      results.reconnection.p2pReEstablished &&
      offlineDeliverySuccess &&
      // Printed PASS/FAIL and gated on nothing, so a run could print two FAILs
      // and still exit 0. Post-reconnect bidirectional messaging is the fragile
      // part this whole spec exists for — ILM channel asymmetry means Alice->Bob
      // can work while Bob->Alice does not. `offline-messaging.test.ts` already
      // carries this fix, with a comment describing the same bug; it was never
      // carried across to here.
      results.postReconnectMessaging.user1Received &&
      results.postReconnectMessaging.user2Received;

    console.log('\nPhase 1 - Account & Registration:');
    console.log(`  Account Creation:       ${results.accountCreation.user1 && results.accountCreation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Registration:       ${results.p2pRegistration ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Accept:             ${results.p2pAccept ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 2 - Initial Messaging:');
    console.log(`  Open Conversations:     ${results.conversationOpen.user1 && results.conversationOpen.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  Alice -> Bob:           ${results.initialMessaging.user2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob -> Alice:           ${results.initialMessaging.user1Received ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 3 - Hard Disconnect:');
    console.log(`  Bob Sign Out:           ${results.disconnection.user2Disconnected ? 'PASS' : 'FAIL'}`);
    console.log(`  Session NOT Orphaned:   ${results.disconnection.sessionNotOrphaned ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msgs Sent:      ${results.offlineMessages.message1Sent && results.offlineMessages.message2Sent && results.offlineMessages.message3Sent ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 4 - Re-Login & Delivery:');
    console.log(`  Bob Login:              ${results.reconnection.user2LoggedIn ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Re-established:     ${results.reconnection.p2pReEstablished ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 1 Received: ${results.offlineDelivery.message1Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 2 Received: ${results.offlineDelivery.message2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 3 Received: ${results.offlineDelivery.message3Received ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 5 - Post-Reconnect Messaging:');
    console.log(`  Alice -> Bob:           ${results.postReconnectMessaging.user2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob -> Alice:           ${results.postReconnectMessaging.user1Received ? 'PASS' : 'FAIL'}`);

    console.log(`\n  Result: ${corePassed ? 'PASS' : 'FAIL'}`);

    harness.finalize(corePassed, results);

    return corePassed;

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
