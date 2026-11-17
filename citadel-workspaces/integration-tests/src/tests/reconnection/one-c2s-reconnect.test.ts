/**
 * One C2S Reconnection Test
 *
 * Tests P2P disconnect then ONE user C2S logout:
 * 1. Create 2 accounts with P2P connection
 * 2. disconnectP2P(user2, user1) - P2P disconnects
 * 3. disconnectViaTopBar(user1) - User1 C2S explicit logout
 * 4. Verify user1 NOT in OrphanSessionsNavbar (explicit = removed)
 * 5. loginAfterDisconnect(user1) - User1 logs back in
 * 6. connectP2P(user1, user2) - Reconnect P2P
 * 7. Verify messaging works
 *
 * Key insight: After explicit logout, user1's ratchets may be destroyed,
 * so we test if P2P reconnection works after C2S reconnect.
 */

import type { Page, Browser } from 'playwright';
import {
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  connectP2P,
  disconnectP2P,
  disconnectViaTopBar,
  assertSessionNotInOrphanNavbar,
  loginAfterDisconnect,
  sendMessage,
  verifyMessageReceived,
  sendAndVerifyMessage,
  waitForP2PReady,
  takeScreenshot,
  setupConsoleCapture,
  config,
  TestHarness,
  runTestMain,
  isVisibleWithin,
  waitForWorkspaceLoaded,
} from '../../lib/index.js';

// Test configuration
const timestamp = Date.now();
const USER1_NAME = `onec2s_1_${timestamp}`;
const USER2_NAME = `onec2s_2_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  notes: string;
}

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'One C2S Reconnection Test',
    reportFileName: 'one-c2s-reconnect-test.json',
    metadata: { user1: USER1_NAME, user2: USER2_NAME },
  });
  const uxTracker = harness.uxTracker;

  const results: TestResult[] = [];
  let browser1: Browser | null = null;
  let browser2: Browser | null = null;
  let page1: Page | null = null;
  let page2: Page | null = null;
  const consoleErrors: string[] = [];

  try {

    // Create separate browsers for each user
    const browserSetup = await createSeparateBrowsers(2);
    browser1 = browserSetup.browsers[0];
    browser2 = browserSetup.browsers[1];
    page1 = browserSetup.pages[0];
    page2 = browserSetup.pages[1];

    // Setup console capture for ratchet errors
    // 'ILM' included deliberately. These specs assert message delivery, and the
    // delivery layer is ILM -- but its diagnostics were filtered out of the
    // captured console, so a delivery failure here produced a log with literally
    // zero ILM lines in it and nothing to diagnose from.
    const errorPatterns = ['Session Already Connected', 'Ratchet does not exist', 'ratchet v', 'ILM'];

    // What is CAPTURED and what counts as a FAILURE are different lists.
    //
    // `errorPatterns` above is the capture list, and it includes `'ILM'` on
    // purpose: a delivery failure with no ILM lines in the log has nothing to
    // diagnose from, which the comment above records. Reusing it here as the
    // failure list made every informational router line -- `[ILM-Router]
    // Registering CID <n> for self (leader's own connection)` -- a
    // `critical/functional` UX failure and an entry in `consoleErrors`. A run
    // reports errors it does not have, which is how the ones it does have stop
    // being noticed.
    //
    // `c2s-reconnect.test.ts` in this directory already separates the two; the
    // other four specs reused one list.
    const failurePatterns = ['Session Already Connected', 'Ratchet does not exist', 'ratchet v'];

    setupConsoleCapture(page1, USER1_NAME, errorPatterns);
    setupConsoleCapture(page2, USER2_NAME, errorPatterns);

    const trackErrors = (page: Page, username: string) => {
      page.on('console', (msg) => {
        const text = msg.text();
        if (failurePatterns.some((pattern) => text.includes(pattern))) {
          consoleErrors.push(`[${username}] ${text}`);
          console.log(`[CONSOLE ERROR] [${username}] ${text}`);
          uxTracker.log('critical', 'functional', text);
        }
      });
    };

    trackErrors(page1, USER1_NAME);
    trackErrors(page2, USER2_NAME);

    // ===== PHASE 1: Create Accounts =====
    console.log('\n=== Phase 1: Create Accounts ===');

    const user1Created = await createAccount(page1, USER1_NAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    results.push({
      step: 'Phase 1a: Create User1 (initializer)',
      status: user1Created ? 'PASS' : 'FAIL',
      notes: user1Created ? `Created ${USER1_NAME}` : 'Failed to create user1',
    });

    if (!user1Created) return false;
    await sleep(3000);

    const user2Created = await createAccount(page2, USER2_NAME, {
      isFirstUser: false,
      password: PASSWORD,
      uxTracker,
    });

    results.push({
      step: 'Phase 1b: Create User2',
      status: user2Created ? 'PASS' : 'FAIL',
      notes: user2Created ? `Created ${USER2_NAME}` : 'Failed to create user2',
    });

    if (!user2Created) return false;

    // Both pages READY before any peer registration.
    //
    // This was a bare `sleep(2000)`. The incoming-registration handshake is
    // one-shot: the agent stores the pending signal and pushes exactly one
    // `PeerRegisterNotification`, and no request variant can ask for it again. If
    // the invitee's session is not yet in `server_connection_map`, the push is
    // skipped silently; if the invitee's page has no cid yet, the notification is
    // filtered out on arrival. Either way the badge never appears and no amount
    // of polling helps -- which is why these specs failed after ~40s of it while
    // `test:p2p`, which DOES wait here, got past registration.
    //
    // 45s each, matching what createAccount itself waits for.
    const bothReady =
      (await waitForWorkspaceLoaded(page1, 45000)) && (await waitForWorkspaceLoaded(page2, 45000));
    if (!bothReady) {
      console.error('A workspace never loaded; not starting P2P registration into a page that is not ready');
      return false;
    }

    // ===== PHASE 2: P2P Registration =====
    console.log('\n=== Phase 2: P2P Registration ===');

    const p2pRequested = await p2pRegister(page1, USER1_NAME, USER2_NAME, uxTracker);
    results.push({
      step: 'Phase 2a: P2P Register Request',
      status: p2pRequested ? 'PASS' : 'FAIL',
      notes: p2pRequested ? 'P2P registration initiated' : 'Failed',
    });

    if (!p2pRequested) return false;
    await sleep(3000);

    const p2pAccepted = await acceptP2PRequest(page2, USER2_NAME, uxTracker, USER1_NAME);
    results.push({
      step: 'Phase 2b: P2P Accept',
      status: p2pAccepted ? 'PASS' : 'FAIL',
      notes: p2pAccepted ? 'P2P registration accepted' : 'Failed',
    });

    if (!p2pAccepted) return false;
    await sleep(3000);

    // Open conversations
    await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    // Send initial message
    const msg1 = `Initial message from ${USER1_NAME} - ${Date.now()}`;
    const msg1Sent = await sendMessage(page1, USER1_NAME, msg1, uxTracker);
    // The verification result used to be DISCARDED, so the row below reported
    // PASS when the send button worked — not when the message arrived. This is
    // the baseline every later reconnection phase is measured against, so an
    // undelivered baseline makes the whole spec meaningless while green.
    const msg1Received = msg1Sent
      ? await verifyMessageReceived(page2, USER2_NAME, msg1, 30000, uxTracker)
      : false;

    await takeScreenshot(page1, `${USER1_NAME}_phase2_p2p_established`);
    await takeScreenshot(page2, `${USER2_NAME}_phase2_p2p_established`);

    results.push({
      step: 'Phase 2c: Initial Message',
      status: msg1Sent && msg1Received ? 'PASS' : 'FAIL',
      notes: msg1Sent ? 'Initial messaging works' : 'Failed',
    });

    // ===== PHASE 3: Disconnect P2P =====
    console.log('\n=== Phase 3: Disconnect P2P ===');

    const p2pDisconnected = await disconnectP2P(page2, USER2_NAME, USER1_NAME, uxTracker);
    results.push({
      step: 'Phase 3: P2P Disconnect',
      status: p2pDisconnected ? 'PASS' : 'FAIL',
      notes: p2pDisconnected ? 'P2P disconnected' : 'Failed',
    });

    await sleep(2000);

    // ===== PHASE 4: User1 C2S Explicit Logout =====
    console.log('\n=== Phase 4: User1 C2S Explicit Logout ===');

    const user1LoggedOut = await disconnectViaTopBar(page1, USER1_NAME, uxTracker);
    results.push({
      step: 'Phase 4a: User1 Sign Out',
      status: user1LoggedOut ? 'PASS' : 'FAIL',
      notes: user1LoggedOut ? 'User1 signed out' : 'Failed',
    });

    if (!user1LoggedOut) {
      console.error('User1 logout failed');
      // Continue anyway to see what happens
    }

    await sleep(2000);
    await takeScreenshot(page1, `${USER1_NAME}_phase4_logged_out`);

    // Verify user1 NOT in OrphanSessionsNavbar (explicit disconnect removes session)
    const notOrphaned = await assertSessionNotInOrphanNavbar(page1, USER1_NAME, uxTracker);
    results.push({
      step: 'Phase 4b: User1 NOT Orphaned',
      status: notOrphaned ? 'PASS' : 'FAIL',
      notes: notOrphaned
        ? 'Session correctly NOT in OrphanSessionsNavbar'
        : 'Session unexpectedly found in OrphanSessionsNavbar',
    });

    // ===== PHASE 5: User1 Login Again =====
    console.log('\n=== Phase 5: User1 Login Again ===');

    const user1LoggedIn = await loginAfterDisconnect(
      page1,
      USER1_NAME,
      PASSWORD,
      uxTracker,
      config.WORKSPACE_SERVER
    );

    results.push({
      step: 'Phase 5: User1 Login',
      status: user1LoggedIn ? 'PASS' : 'FAIL',
      notes: user1LoggedIn ? 'User1 logged back in' : 'Failed to login',
    });

    if (!user1LoggedIn) {
      console.error('User1 login failed');
      return false;
    }

    // Wait for P2P auto-connect service to establish connections
    console.log('  Waiting for P2P auto-connect service to establish connections...');
    await sleep(5000);
    await takeScreenshot(page1, `${USER1_NAME}_phase5_logged_in`);

    // ===== PHASE 6: Reconnect P2P =====
    console.log('\n=== Phase 6: Reconnect P2P ===');

    // After User1 logs back in, the P2P auto-connect service should detect the
    // existing peer registration and attempt to reconnect automatically.
    // The SDK preserves peer relationships by CID, so auto-connect works even
    // after explicit disconnect + fresh login (same CID is preserved).

    // Check if P2P auto-connect already restored the connection
    let p2pAutoConnected = false;
    if (page1) {
      try {
        p2pAutoConnected = await page1.evaluate((peerUser: string) => {
          const autoConnect = (window as unknown as Record<string, unknown>).__p2pAutoConnectService as
            { connectedPeers?: Map<unknown, { username?: string }> } | undefined;
          if (!autoConnect) return false;
          const connected = autoConnect.connectedPeers;
          if (!connected) return false;
          for (const [, peer] of connected) {
            if (peer.username?.toLowerCase() === peerUser.toLowerCase()) return true;
          }
          return false;
        }, USER2_NAME);
      } catch {
        p2pAutoConnected = false;
      }
    }

    let p2pReconnected = false;
    if (p2pAutoConnected) {
      console.log('  P2P auto-connect restored connection (no manual connectP2P needed)');
      p2pReconnected = true;
    } else {
      // Check if User2 is visible in User1's sidebar (another indicator of connectivity)
      let user2InSidebar = false;
      if (page1) {
        try {
          user2InSidebar = await isVisibleWithin(page1.locator(`text="${USER2_NAME}"`).first(), 10000);
        } catch {
          user2InSidebar = false;
        }
      }

      if (user2InSidebar) {
        console.log('  P2P connection detected via sidebar (User2 visible)');
        p2pReconnected = true;
      } else {
        // Fallback: attempt manual connectP2P
        console.log('  Auto-connect not detected, attempting manual connectP2P...');
        p2pReconnected = await connectP2P(page1, USER1_NAME, USER2_NAME, uxTracker);
      }
    }

    results.push({
      step: 'Phase 6: P2P Reconnect',
      status: p2pReconnected ? 'PASS' : 'FAIL',
      notes: p2pReconnected
        ? (p2pAutoConnected ? 'Auto-connected' : 'Reconnected')
        : 'Failed',
    });

    // Wait for P2P readiness (ILM channel can take longer than P2P connection)
    console.log('  Waiting for P2P readiness (ILM channel establishment)...');
    const user1Ready = await waitForP2PReady(page1, USER1_NAME, USER2_NAME, 60000);
    const user2Ready = await waitForP2PReady(page2, USER2_NAME, USER1_NAME, 60000);
    console.log(`  P2P ready: User1=${user1Ready}, User2=${user2Ready}`);
    if (!user1Ready || !user2Ready) {
      console.log('  WARNING: P2P readiness not confirmed, continuing with sleep fallback...');
      await sleep(10000);
    }

    await takeScreenshot(page1, `${USER1_NAME}_phase6_p2p_reconnected`);
    await takeScreenshot(page2, `${USER2_NAME}_phase6_p2p_reconnected`);

    // ===== PHASE 7: Verify Messaging After Reconnect =====
    console.log('\n=== Phase 7: Verify Messaging After Reconnect ===');

    // Reopen conversations
    await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    // Use verified warmup to confirm ILM channel is ready
    console.log('  Sending verified warmup to confirm ILM channel...');
    const warmupOk = await sendAndVerifyMessage(
      page1, USER1_NAME, page2, USER2_NAME,
      `Warmup ${Date.now()}`,
      { maxRetries: 3, verifyTimeout: 15000, retryDelay: 5000 }
    );
    if (!warmupOk) {
      console.log('  WARNING: Warmup delivery failed - ILM channel may not be ready');
    }

    // Send message from user1 (the one who reconnected) to user2
    const msg2 = `Message after reconnect from ${USER1_NAME} - ${Date.now()}`;
    const msg2Sent = await sendMessage(page1, USER1_NAME, msg2, uxTracker);

    results.push({
      step: 'Phase 7a: Send Message After Reconnect',
      status: msg2Sent ? 'PASS' : 'FAIL',
      notes: msg2Sent ? 'Message sent' : 'Failed to send',
    });

    if (msg2Sent) {
      const msg2Received = await verifyMessageReceived(page2, USER2_NAME, msg2, 30000, uxTracker);
      results.push({
        step: 'Phase 7b: Verify Message Received',
        status: msg2Received ? 'PASS' : 'FAIL',
        notes: msg2Received ? 'Message received' : 'Not received',
      });
    }

    await takeScreenshot(page1, `${USER1_NAME}_phase7_msg_sent`);
    await takeScreenshot(page2, `${USER2_NAME}_phase7_msg_received`);

    // ===== PHASE 8: Verify No Ratchet Errors =====
    console.log('\n=== Phase 8: Verify No Ratchet Errors ===');

    const hasRatchetErrors = consoleErrors.some(
      (e) => e.includes('Ratchet does not exist') || e.includes('ratchet v')
    );

    results.push({
      step: 'Phase 8: No Ratchet Errors',
      status: !hasRatchetErrors ? 'PASS' : 'FAIL',
      notes: !hasRatchetErrors
        ? 'No ratchet errors detected'
        : `Found ratchet errors`,
    });

    // Print and write results
    printResults(results);

    if (consoleErrors.length > 0) {
      console.log('\n=== Console Errors Detected ===');
      for (const error of consoleErrors) {
        console.log(`  ${error}`);
      }
    }

    const allPassed = results.every((r) => r.status === 'PASS' || r.status === 'SKIP');
    harness.finalize(allPassed, { results, consoleErrors } as Record<string, unknown>);

    return allPassed;
  } catch (error) {
    console.error('Test failed with error:', error);
    results.push({
      step: 'Test Execution',
      status: 'FAIL',
      notes: `Error: ${error instanceof Error ? error.message : String(error)}`,
    });

    if (page1) await takeScreenshot(page1, `${USER1_NAME}_error`);
    if (page2) await takeScreenshot(page2, `${USER2_NAME}_error`);

    printResults(results);
    return false;
  } finally {
    if (browser1) await browser1.close();
    if (browser2) await browser2.close();
  }
}

function printResults(results: TestResult[]): void {
  console.log('\n=== Test Results ===');
  console.log('─'.repeat(80));

  for (const result of results) {
    const statusIcon =
      result.status === 'PASS' ? '✅' : result.status === 'FAIL' ? '❌' : '⏭️';
    console.log(`${statusIcon} ${result.step}`);
    console.log(`   ${result.notes}`);
  }

  console.log('─'.repeat(80));

  const passed = results.filter((r) => r.status === 'PASS').length;
  const failed = results.filter((r) => r.status === 'FAIL').length;
  const skipped = results.filter((r) => r.status === 'SKIP').length;

  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`);
}

runTestMain(runTest);
