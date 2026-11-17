/**
 * Offline Messaging Test
 *
 * Tests the P2P messaging + ILM (Intersession Layer Messaging) system.
 * Based on the working P2P messaging test, extended with offline scenarios.
 *
 * Test Flow:
 * 1. Create two users in separate browser processes
 * 2. P2P register User1 -> User2
 * 3. User2 accepts the P2P request
 * 4. Test bidirectional messaging (verify P2P works)
 * 5. User2 disconnects via TCP drop (page close - session orphaned)
 * 6. Assert User2 IS in OrphanSessionsNavbar
 * 7. User1 sends messages while User2 is offline (ILM queues them)
 * 8. User2 reconnects via ClaimSession
 * 9. Verify User2 received all offline messages
 * 10. Exchange post-reconnect messages
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
  waitForP2PReady,
  waitForP2PConnection,
  waitForP2PChannelReady,
  disconnectViaTcpDrop,
  assertSessionInOrphanNavbar,
  waitForWorkspaceLoaded,
  takeScreenshot,
  setupConsoleCapture,
  verifyOfflineMessagesWithRetry,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { isVisibleWithin } from '../lib/index.js';

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
    sessionOrphaned: boolean;
  };
  offlineMessages: {
    message1Sent: boolean;
    message2Sent: boolean;
    message3Sent: boolean;
  };
  reconnection: {
    user2Reconnected: boolean;
    claimSessionSuccess: boolean;
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
const USER1 = `offline_alice_${timestamp}`;
const USER2 = `offline_bob_${timestamp}`;

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'Offline Messaging Test',
    reportFileName: 'OFFLINE_MESSAGING_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
  });
  const uxTracker = harness.uxTracker;

  console.log(`User 1 (Alice): ${USER1}`);
  console.log(`User 2 (Bob): ${USER2}`);
  console.log('');

  // Use SEPARATE browser processes to eliminate Chrome tab throttling
  const { browsers, pages: [page1, page2], cleanup } = await createSeparateBrowsers(2);

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
      sessionOrphaned: false,
    },
    offlineMessages: {
      message1Sent: false,
      message2Sent: false,
      message3Sent: false,
    },
    reconnection: {
      user2Reconnected: false,
      claimSessionSuccess: false,
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
    // Setup console capture
    setupConsoleCapture(page1, 'Alice', ['P2P', 'error', 'Error', 'ILM']);
    setupConsoleCapture(page2, 'Bob', ['P2P', 'error', 'Error', 'ILM']);

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

    if (!results.p2pAccept) {
      throw new Error('P2P accept failed — cannot proceed with messaging tests');
    }

    // Wait for ACTUAL P2P connection instead of fixed sleep
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

    if (!results.conversationOpen.user1 || !results.conversationOpen.user2) {
      throw new Error('Could not open conversations');
    }

    // ========== STEP 5: Initial Bidirectional Messaging ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Initial Bidirectional Messaging');
    console.log('─'.repeat(50));

    // ServerAutoConnect polls every ~30s and a reconnect landing mid-test can
    // cause "Session Already Connected", which blocks ILM delivery. This used to
    // sleep 35s — one full cycle — to be sure. Waiting for the reconnect queue to
    // empty asks the actual question and returns as soon as it is true.
    console.log('  Waiting for the ServerAutoConnect cycle to settle...');
    await settleServerAutoConnect(page1);
    await settleServerAutoConnect(page2);

    const INITIAL_MSG_1 = `Hello Bob! Time: ${new Date().toLocaleTimeString()}`;
    const INITIAL_MSG_2 = `Hi Alice! Got it! Time: ${new Date().toLocaleTimeString()}`;

    // Verified warmup: confirm ILM channel is ready in both directions before testing
    console.log('  Sending verified warmup Alice→Bob...');
    const warmupAB = await sendAndVerifyMessage(
      page1, USER1, page2, USER2,
      `Warmup A→B ${Date.now()}`,
      { maxRetries: 5, verifyTimeout: 15000, retryDelay: 5000 }
    );
    if (!warmupAB) console.log('  WARNING: Alice→Bob warmup failed');

    console.log('  Sending verified warmup Bob→Alice...');
    const warmupBA = await sendAndVerifyMessage(
      page2, USER2, page1, USER1,
      `Warmup B→A ${Date.now()}`,
      { maxRetries: 5, verifyTimeout: 15000, retryDelay: 5000 }
    );
    if (!warmupBA) console.log('  WARNING: Bob→Alice warmup failed');

    // Test bidirectional messaging with retry logic for robustness
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
      console.log('  WARNING: Initial messaging failed - P2P channel may not be fully established');
    }

    await takeScreenshot(page1, `${USER1}_initial_messaging`);
    await takeScreenshot(page2, `${USER2}_initial_messaging`);

    // ========== STEP 6: Bob TCP Drop (Disconnect) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Bob TCP Drop (Disconnect)');
    console.log('─'.repeat(50));

    results.disconnection.user2Disconnected = await disconnectViaTcpDrop(page2, USER2, uxTracker);
    console.log(`  Bob disconnected: ${results.disconnection.user2Disconnected}`);

    // Wait for disconnect to propagate
    console.log('  Waiting 10s for ILM to detect peer offline...');
    await sleep(10000);

    // ========== STEP 7: Assert Bob IS in OrphanSessionsNavbar ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Assert Session Orphaned');
    console.log('─'.repeat(50));

    // Use a temp page in Bob's browser to check OrphanNavbar
    // Each browser has its own IndexedDB, so Bob's session is only in Bob's browser
    const bobBrowserContext = browsers[1].contexts()[0];
    const tempCheckPage = await bobBrowserContext.newPage();
    const config = await import('../lib/config.js');
    await tempCheckPage.goto(config.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
    await sleep(3000);

    results.disconnection.sessionOrphaned = await assertSessionInOrphanNavbar(tempCheckPage, USER2, uxTracker);
    console.log(`  Session orphaned: ${results.disconnection.sessionOrphaned}`);

    // DO NOT close tempCheckPage — closing triggers beforeunload → ReleaseSession,
    // which destroys Bob's orphaned session on the internal service. The page is
    // cleaned up when the browser closes at end of test.
    // See: instance-channel.ts beforeunload handler + session-management.ts releaseSession

    // ========== STEP 8: Alice Sends Offline Messages ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: Alice Sends Offline Messages');
    console.log('─'.repeat(50));

    const OFFLINE_MSG_1 = 'Bob, this is offline message 1';
    const OFFLINE_MSG_2 = 'Bob, this is offline message 2';
    const OFFLINE_MSG_3 = 'Bob, this is offline message 3 - did you get all of them?';

    // Ensure Alice's conversation is still open
    await openConversation(page1, USER1, USER2, uxTracker);

    // Wait for ILM to fully detect Bob as offline and switch to queue mode
    // This ensures the first message is properly queued, not lost in transition
    console.log('  Waiting 3s for ILM to stabilize in offline mode...');
    await sleep(3000);

    results.offlineMessages.message1Sent = await sendMessage(page1, USER1, OFFLINE_MSG_1);
    console.log(`  Offline message 1: ${results.offlineMessages.message1Sent ? 'SENT' : 'FAILED'}`);
    await sleep(2000); // Increased delay between messages

    results.offlineMessages.message2Sent = await sendMessage(page1, USER1, OFFLINE_MSG_2);
    console.log(`  Offline message 2: ${results.offlineMessages.message2Sent ? 'SENT' : 'FAILED'}`);
    await sleep(2000);

    results.offlineMessages.message3Sent = await sendMessage(page1, USER1, OFFLINE_MSG_3);
    console.log(`  Offline message 3: ${results.offlineMessages.message3Sent ? 'SENT' : 'FAILED'}`);

    await takeScreenshot(page1, `${USER1}_offline_messages_sent`);

    // ========== STEP 9: Bob Reconnects via ClaimSession ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 9: Bob Reconnects via ClaimSession');
    console.log('─'.repeat(50));

    // Reuse tempCheckPage which already shows Bob's orphan session.
    // CRITICAL: Do NOT call reconnectViaClaimSession() here — it calls page.goto()
    // which triggers beforeunload → ReleaseSession, destroying the orphan session.
    // Instead, click the session button directly on tempCheckPage.
    const reconnectPage = tempCheckPage;
    setupConsoleCapture(reconnectPage, 'Bob-Reconnect', ['P2P', 'error', 'Error', 'ILM', 'LOSS-DIAG']);

    // Click the orphan session button directly (already visible from STEP 7)
    const sessionButton = reconnectPage.locator(`[data-testid="session-button-${USER2}"]`);
    const sessionIcon = reconnectPage.locator(`[data-testid="session-icon-${USER2}"]`);
    let claimClicked = false;
    if (await isVisibleWithin(sessionButton, 3000)) {
      await sessionButton.click();
      claimClicked = true;
    } else if (await isVisibleWithin(sessionIcon, 2000)) {
      await sessionIcon.click();
      claimClicked = true;
    }
    if (claimClicked) {
      results.reconnection.claimSessionSuccess = await waitForWorkspaceLoaded(reconnectPage, 45000);
    } else {
      console.log(`  Session button not visible on tempCheckPage for ${USER2}`);
      results.reconnection.claimSessionSuccess = false;
    }
    results.reconnection.user2Reconnected = results.reconnection.claimSessionSuccess;
    console.log(`  ClaimSession: ${results.reconnection.claimSessionSuccess ? 'SUCCESS' : 'FAILED'}`);

    if (!results.reconnection.claimSessionSuccess) {
      console.log('  WARNING: ClaimSession failed - offline messages may not be delivered');
      console.log('  Known issue: ClaimSession can fail due to session state or SDK timing');
      await takeScreenshot(reconnectPage, `${USER2}_claimsession_failed`);
    }

    // Steps 10-11 depend on a working session from ClaimSession.
    // When ClaimSession fails, the page is stuck on the landing page with
    // OrphanSessionsNavbar overlapping the sidebar, making openConversation fail.
    if (results.reconnection.claimSessionSuccess) {
      // Wait for ACTUAL P2P reconnection instead of fixed sleep
      console.log('  Waiting for P2P auto-reconnection via forceInitiatorMode...');
      const reconnectP2PReady = await waitForP2PConnection(reconnectPage, USER2, USER1, 30000);
      console.log(`  P2P reconnection: ${reconnectP2PReady ? 'SUCCESS' : 'TIMEOUT (may still deliver via ILM)'}`);

      // DETERMINISTIC: Wait for channel to be READY (proven message flow from Alice)
      console.log('  Waiting for P2P channel to be READY (proven message flow)...');
      const channelReady = await waitForP2PChannelReady(reconnectPage, USER2, USER1, 30000);
      console.log(`  Channel ready: ${channelReady ? 'SUCCESS (ILM delivered at least one message)' : 'TIMEOUT (may still check messages)'}`);

      // Small delay for UI to render incoming messages
      await sleep(1000);

      // ========== STEP 10: Verify Offline Messages Received ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 10: Verify Offline Messages Received');
      console.log('─'.repeat(50));

      await openConversation(reconnectPage, USER2, USER1, uxTracker);
      await sleep(2000);

      // Use robust offline message verification with retry and UI refresh
      const offlineVerification = await verifyOfflineMessagesWithRetry(
        reconnectPage,
        USER2,
        USER1,
        [OFFLINE_MSG_1, OFFLINE_MSG_2, OFFLINE_MSG_3],
        {
          maxRetries: 3,
          verifyTimeout: 20000,
          retryDelay: 3000,
          openConversationFn: openConversation,
          uxTracker,
        }
      );

      results.offlineDelivery.message1Received = offlineVerification.results[OFFLINE_MSG_1] ?? false;
      results.offlineDelivery.message2Received = offlineVerification.results[OFFLINE_MSG_2] ?? false;
      results.offlineDelivery.message3Received = offlineVerification.results[OFFLINE_MSG_3] ?? false;

      console.log(`  Offline message 1: ${results.offlineDelivery.message1Received ? 'RECEIVED' : 'NOT RECEIVED'}`);
      console.log(`  Offline message 2: ${results.offlineDelivery.message2Received ? 'RECEIVED' : 'NOT RECEIVED'}`);
      console.log(`  Offline message 3: ${results.offlineDelivery.message3Received ? 'RECEIVED' : 'NOT RECEIVED'}`);

      await takeScreenshot(reconnectPage, `${USER2}_offline_messages_verification`);

      // ========== STEP 11: Post-Reconnect Bidirectional Messaging ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 11: Post-Reconnect Bidirectional Messaging');
      console.log('─'.repeat(50));

      console.log('  Verifying P2P is ready for bidirectional messaging...');
      const bobReady = await waitForP2PReady(reconnectPage, USER2, USER1, 30000);
      const aliceReady = await waitForP2PReady(page1, USER1, USER2, 30000);
      console.log(`  P2P ready: Alice=${aliceReady}, Bob=${bobReady}`);

      const POST_MSG_1 = 'Welcome back Bob! Did you get my offline messages?';
      const POST_MSG_2 = 'Thanks Alice! Yes I got all of them!';

      results.postReconnectMessaging.user2Received = await sendAndVerifyMessage(
        page1, USER1, reconnectPage, USER2, POST_MSG_1,
        { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
      );
      results.postReconnectMessaging.user1ToUser2 = results.postReconnectMessaging.user2Received;

      results.postReconnectMessaging.user1Received = await sendAndVerifyMessage(
        reconnectPage, USER2, page1, USER1, POST_MSG_2,
        { maxRetries: 3, verifyTimeout: 15000, retryDelay: 2000, uxTracker }
      );
      results.postReconnectMessaging.user2ToUser1 = results.postReconnectMessaging.user1Received;

      console.log(`  Post-reconnect: Alice->Bob=${results.postReconnectMessaging.user2Received}, Bob->Alice=${results.postReconnectMessaging.user1Received}`);

      await takeScreenshot(page1, `${USER1}_final`);
      await takeScreenshot(reconnectPage, `${USER2}_final`);
    } else {
      console.log('\n  SKIPPING Steps 10-11: ClaimSession failed, session not recovered');
      console.log('  (Offline delivery and post-reconnect messaging require an active session)');
    }

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const offlineDeliverySuccess =
      results.offlineDelivery.message1Received &&
      results.offlineDelivery.message2Received &&
      results.offlineDelivery.message3Received;

    // All checks are mandatory — no separate "core" vs "extended" split
    const allPassed =
      results.accountCreation.user1 &&
      results.accountCreation.user2 &&
      results.p2pRegistration &&
      results.p2pAccept &&
      results.conversationOpen.user1 &&
      results.conversationOpen.user2 &&
      results.initialMessaging.user1Received &&
      results.initialMessaging.user2Received &&
      results.disconnection.user2Disconnected &&
      results.disconnection.sessionOrphaned &&
      results.reconnection.claimSessionSuccess &&
      offlineDeliverySuccess &&
      // Printed PASS/FAIL and gated on nothing, directly under a comment saying
      // all checks are mandatory. Post-reconnect bidirectional messaging is the
      // fragile part this spec exists for — ILM channel asymmetry means
      // Alice->Bob can work while Bob->Alice does not — so a run could print two
      // FAILs and still exit 0.
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

    console.log('\nPhase 3 - Disconnect & Offline:');
    console.log(`  Bob TCP Drop:           ${results.disconnection.user2Disconnected ? 'PASS' : 'FAIL'}`);
    console.log(`  Session Orphaned:       ${results.disconnection.sessionOrphaned ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msgs Sent:      ${results.offlineMessages.message1Sent && results.offlineMessages.message2Sent && results.offlineMessages.message3Sent ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 4 - Reconnect & ILM Delivery:');
    console.log(`  ClaimSession:           ${results.reconnection.claimSessionSuccess ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 1 Received: ${results.offlineDelivery.message1Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 2 Received: ${results.offlineDelivery.message2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Offline Msg 3 Received: ${results.offlineDelivery.message3Received ? 'PASS' : 'FAIL'}`);

    console.log('\nPhase 5 - Post-Reconnect Messaging:');
    console.log(`  Alice -> Bob:           ${results.postReconnectMessaging.user2Received ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob -> Alice:           ${results.postReconnectMessaging.user1Received ? 'PASS' : 'FAIL'}`);

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
