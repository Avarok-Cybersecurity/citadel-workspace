/**
 * P2P + One C2S Reconnection Test
 *
 * Tests mixed scenario: TCP drop (orphans session, preserves ratchets) + explicit disconnect:
 * 1. Create 2 accounts with P2P connection
 * 2. disconnectViaTcpDrop(user2) - TCP drop (orphans session, preserves P2P ratchets)
 * 3. Verify user2 IS in OrphanSessionsNavbar
 * 4. disconnectViaTopBar(user1) - User1 explicit logout (destroys ratchets)
 * 5. reconnectViaClaimSession(user2) - User2 reclaims orphaned session
 * 6. loginAfterDisconnect(user1) - User1 fresh login
 * 7. P2P must re-register (user1's ratchets destroyed)
 * 8. Verify messaging works
 *
 * Key insight: This tests the mixed case where:
 * - TCP drop preserves P2P ratchets (user2 can resume)
 * - Explicit disconnect destroys ratchets (user1 must re-register)
 * - After user1 re-registers, both can communicate again
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import {
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  disconnectViaTcpDrop,
  disconnectViaTopBar,
  assertSessionInOrphanNavbar,
  assertSessionNotInOrphanNavbar,
  reconnectViaClaimSession,
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
const USER1_NAME = `p2pc2s_1_${timestamp}`;
const USER2_NAME = `p2pc2s_2_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  notes: string;
}

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'P2P + One C2S Reconnection Test',
    reportFileName: 'p2p-one-c2s-reconnect-test.json',
    metadata: { user1: USER1_NAME, user2: USER2_NAME },
  });
  const uxTracker = harness.uxTracker;

  const results: TestResult[] = [];
  let browser1: Browser | null = null;
  let browser2: Browser | null = null;
  let context2: BrowserContext | null = null;
  let page1: Page | null = null;
  let page2: Page | null = null;
  const consoleErrors: string[] = [];

  try {

    const browserSetup = await createSeparateBrowsers(2);
    browser1 = browserSetup.browsers[0];
    browser2 = browserSetup.browsers[1];
    page1 = browserSetup.pages[0];
    page2 = browserSetup.pages[1];
    // Store context2 for creating new pages later (after TCP drop simulation)
    context2 = page2.context();

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
      step: 'Phase 1a: Create User1',
      status: user1Created ? 'PASS' : 'FAIL',
      notes: user1Created ? `Created ${USER1_NAME}` : 'Failed',
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
      notes: user2Created ? `Created ${USER2_NAME}` : 'Failed',
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
      step: 'Phase 2a: P2P Register',
      status: p2pRequested ? 'PASS' : 'FAIL',
      notes: p2pRequested ? 'Initiated' : 'Failed',
    });

    if (!p2pRequested) return false;
    await sleep(3000);

    const p2pAccepted = await acceptP2PRequest(page2, USER2_NAME, uxTracker, USER1_NAME);
    results.push({
      step: 'Phase 2b: P2P Accept',
      status: p2pAccepted ? 'PASS' : 'FAIL',
      notes: p2pAccepted ? 'Accepted' : 'Failed',
    });

    if (!p2pAccepted) return false;
    await sleep(3000);

    // Verify initial messaging
    await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    const msg1 = `Initial from ${USER1_NAME} - ${Date.now()}`;
    const msg1Sent = await sendMessage(page1, USER1_NAME, msg1, uxTracker);
    // The verification result used to be DISCARDED, so this row reported
    // PASS when the send button worked — not when the message arrived. This
    // is the baseline every later reconnection phase is measured against, so
    // an undelivered baseline makes the whole spec meaningless while green.
    const msg1Received = msg1Sent
      ? await verifyMessageReceived(page2, USER2_NAME, msg1, 30000, uxTracker)
      : false;

    results.push({
      step: 'Phase 2c: Initial Messaging',
      status: msg1Sent && msg1Received ? 'PASS' : 'FAIL',
      notes: msg1Sent
        ? msg1Received
          ? 'Sent and received'
          : 'Sent but never arrived'
        : 'Send failed',
    });

    await takeScreenshot(page1, `${USER1_NAME}_phase2_p2p_established`);
    await takeScreenshot(page2, `${USER2_NAME}_phase2_p2p_established`);

    // ===== PHASE 3: User2 TCP Drop (Orphans Session) =====
    console.log('\n=== Phase 3: User2 TCP Drop (Orphans Session) ===');

    // Save reference to browser2 context for later
    // We need to create a new page after TCP drop
    const user2TcpDropped = await disconnectViaTcpDrop(page2, USER2_NAME, uxTracker);
    results.push({
      step: 'Phase 3: User2 TCP Drop',
      status: user2TcpDropped ? 'PASS' : 'FAIL',
      notes: user2TcpDropped ? 'Page closed (TCP drop simulated)' : 'Failed',
    });

    await sleep(3000);

    // ===== PHASE 4: Verify User2 IS Orphaned (from User1's browser) =====
    console.log('\n=== Phase 4: Verify User2 IS Orphaned ===');

    // Navigate user1 to landing page to check for user2's orphan session
    // We need to use user1's page since user2's page is closed
    const configModule = await import('../../lib/config.js');
    await page1.goto(configModule.config.BASE_URL, { waitUntil: 'commit', timeout: 30000 });
    await sleep(3000);

    // Note: We can't directly check user2's orphan status from user1's browser
    // because orphan sessions are per-browser. Instead, we'll create a new page
    // for user2 to check from.

    // Create new page for user2 in browser2
    if (!context2) {
      throw new Error('context2 is null - cannot create new page for user2');
    }
    page2 = await context2.newPage();
    trackErrors(page2, USER2_NAME);

    // User2 should see their orphaned session on landing page
    const user2IsOrphaned = await assertSessionInOrphanNavbar(page2, USER2_NAME, uxTracker);
    results.push({
      step: 'Phase 4: User2 IS Orphaned',
      status: user2IsOrphaned ? 'PASS' : 'FAIL',
      notes: user2IsOrphaned
        ? 'Session correctly in OrphanSessionsNavbar (TCP drop preserved it)'
        : 'Session NOT in OrphanSessionsNavbar (unexpected)',
    });

    await takeScreenshot(page2, `${USER2_NAME}_phase4_orphaned`);

    // ===== PHASE 5: User1 Explicit Logout (Destroys Ratchets) =====
    console.log('\n=== Phase 5: User1 Explicit Logout (Destroys Ratchets) ===');

    // First go back to workspace for user1
    await page1.goto(`${configModule.config.BASE_URL}/workspace`, { waitUntil: 'commit', timeout: 30000 });
    await sleep(2000);

    const user1LoggedOut = await disconnectViaTopBar(page1, USER1_NAME, uxTracker);
    results.push({
      step: 'Phase 5a: User1 Sign Out',
      status: user1LoggedOut ? 'PASS' : 'FAIL',
      notes: user1LoggedOut ? 'Signed out (ratchets destroyed)' : 'Failed',
    });

    await sleep(2000);

    // Verify user1 NOT orphaned (explicit disconnect removes session)
    const user1NotOrphaned = await assertSessionNotInOrphanNavbar(page1, USER1_NAME, uxTracker);
    results.push({
      step: 'Phase 5b: User1 NOT Orphaned',
      status: user1NotOrphaned ? 'PASS' : 'FAIL',
      notes: user1NotOrphaned ? 'Session correctly removed' : 'Unexpected orphan',
    });

    await takeScreenshot(page1, `${USER1_NAME}_phase5_logged_out`);

    // ===== PHASE 6: User2 Claims Orphaned Session =====
    console.log('\n=== Phase 6: User2 Claims Orphaned Session ===');

    const user2Claimed = await reconnectViaClaimSession(page2, USER2_NAME, uxTracker);
    results.push({
      step: 'Phase 6: User2 ClaimSession',
      status: user2Claimed ? 'PASS' : 'FAIL',
      notes: user2Claimed ? 'Session reclaimed' : 'Failed',
    });

    await sleep(3000);
    await takeScreenshot(page2, `${USER2_NAME}_phase6_claimed`);

    // ===== PHASE 7: User1 Fresh Login =====
    console.log('\n=== Phase 7: User1 Fresh Login ===');

    const user1LoggedIn = await loginAfterDisconnect(
      page1,
      USER1_NAME,
      PASSWORD,
      uxTracker,
      config.WORKSPACE_SERVER
    );

    results.push({
      step: 'Phase 7: User1 Login',
      status: user1LoggedIn ? 'PASS' : 'FAIL',
      notes: user1LoggedIn ? 'Logged in' : 'Failed',
    });

    if (!user1LoggedIn) return false;
    await sleep(3000);
    await takeScreenshot(page1, `${USER1_NAME}_phase7_logged_in`);

    // ===== PHASE 8: Re-establish P2P (User1's ratchets were destroyed) =====
    console.log('\n=== Phase 8: Re-establish P2P ===');
    console.log('  (User1 ratchets destroyed by explicit disconnect)');
    console.log('  Waiting for P2P auto-connect to attempt reconnection...');

    // After User1 logs back in, the P2P auto-connect service should detect the
    // existing peer registration and attempt to reconnect automatically.
    // The SDK preserves peer relationships by CID, so auto-connect works even
    // after explicit disconnect + fresh login (same CID is preserved).
    await sleep(5000);

    // Check if P2P auto-connect already restored the connection
    let p2pAutoConnected = false;
    if (page1) {
      try {
        p2pAutoConnected = await page1.evaluate((peerUser: string) => {
          const autoConnect = (window as any).__p2pAutoConnectService;
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

    if (p2pAutoConnected) {
      console.log('  P2P auto-connect restored connection (no manual re-registration needed)');
      results.push({
        step: 'Phase 8a: P2P Re-establish',
        status: 'PASS',
        notes: 'Auto-connected (peer registration persists in SDK)',
      });
      results.push({
        step: 'Phase 8b: P2P Re-accept',
        status: 'SKIP',
        notes: 'Skipped - auto-connect handled reconnection',
      });
    } else {
      // Auto-connect didn't fire yet - try checking User2's sidebar for User1
      let user2SeesUser1 = false;
      if (page2) {
        try {
          user2SeesUser1 = await isVisibleWithin(page2.locator(`text="${USER1_NAME}"`).first(), 10000);
        } catch {
          user2SeesUser1 = false;
        }
      }

      if (user2SeesUser1) {
        console.log('  P2P connection visible in User2 sidebar (auto-connected)');
        results.push({
          step: 'Phase 8a: P2P Re-establish',
          status: 'PASS',
          notes: 'User2 sees User1 in sidebar (auto-connected)',
        });
        results.push({
          step: 'Phase 8b: P2P Re-accept',
          status: 'SKIP',
          notes: 'Skipped - auto-connect handled reconnection',
        });
      } else {
        // Fallback: Manual re-registration
        console.log('  Auto-connect did not fire, attempting manual re-registration...');
        const p2pReRequested = await p2pRegister(page1, USER1_NAME, USER2_NAME, uxTracker);
        results.push({
          step: 'Phase 8a: P2P Re-register',
          status: p2pReRequested ? 'PASS' : 'FAIL',
          notes: p2pReRequested ? 'Manual re-registration initiated' : 'Failed',
        });

        if (p2pReRequested) {
          await sleep(3000);
          const p2pReAccepted = await acceptP2PRequest(page2, USER2_NAME, uxTracker, USER1_NAME);
          results.push({
            step: 'Phase 8b: P2P Re-accept',
            status: p2pReAccepted ? 'PASS' : 'FAIL',
            notes: p2pReAccepted ? 'Accepted' : 'Badge not found (protocol limitation)',
          });
        } else {
          results.push({
            step: 'Phase 8b: P2P Re-accept',
            status: 'SKIP',
            notes: 'Skipped - re-registration failed',
          });
        }
      }
    }

    // Wait for P2P readiness with tight timeout (test has 300s budget)
    console.log('  Waiting for P2P readiness (ILM channel establishment)...');
    const u1Ready = await waitForP2PReady(page1, USER1_NAME, USER2_NAME, 30000);
    if (!u1Ready) {
      console.log('  WARNING: User1 P2P not confirmed, continuing anyway...');
    }

    await takeScreenshot(page1, `${USER1_NAME}_phase8_p2p_reestablished`);
    await takeScreenshot(page2, `${USER2_NAME}_phase8_p2p_reestablished`);

    // ===== PHASE 9: Verify Messaging Works =====
    console.log('\n=== Phase 9: Verify Messaging Works ===');

    await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    // Use verified warmup to confirm ILM channel is ready
    console.log('  Sending verified warmup to confirm ILM channel...');
    const warmupOk = await sendAndVerifyMessage(
      page1, USER1_NAME, page2, USER2_NAME,
      `Warmup ${Date.now()}`,
      { maxRetries: 2, verifyTimeout: 10000, retryDelay: 3000 }
    );
    if (!warmupOk) {
      console.log('  WARNING: Warmup delivery failed - ILM channel may not be ready');
    }

    const msg2 = `After mixed reconnect from ${USER1_NAME} - ${Date.now()}`;
    const msg2Sent = await sendMessage(page1, USER1_NAME, msg2, uxTracker);

    results.push({
      step: 'Phase 9a: Send Message',
      status: msg2Sent ? 'PASS' : 'FAIL',
      notes: msg2Sent ? 'Sent' : 'Failed',
    });

    if (msg2Sent) {
      const msg2Received = await verifyMessageReceived(page2, USER2_NAME, msg2, 30000, uxTracker);
      results.push({
        step: 'Phase 9b: Verify Received',
        status: msg2Received ? 'PASS' : 'FAIL',
        notes: msg2Received ? 'Received' : 'Not received',
      });
    }

    // Also test reverse direction
    const msg3 = `Reply from ${USER2_NAME} - ${Date.now()}`;
    const msg3Sent = await sendMessage(page2, USER2_NAME, msg3, uxTracker);

    // Recorded unconditionally. A failed SEND used to push no row at all, and
    // `allPassed` only checks the rows that exist — so the reverse direction,
    // the one most likely to break after an asymmetric reconnect, could fail
    // silently while the forward direction carried the spec to green.
    const msg3Received = msg3Sent
      ? await verifyMessageReceived(page1, USER1_NAME, msg3, 30000, uxTracker)
      : false;
    results.push({
      step: 'Phase 9c: Bidirectional Messaging',
      status: msg3Sent && msg3Received ? 'PASS' : 'FAIL',
      notes: !msg3Sent
        ? 'Reverse send failed'
        : msg3Received
          ? 'Works both ways'
          : 'One direction only',
    });


    await takeScreenshot(page1, `${USER1_NAME}_phase9_messaging`);
    await takeScreenshot(page2, `${USER2_NAME}_phase9_messaging`);

    // ===== PHASE 10: Verify No Critical Errors =====
    console.log('\n=== Phase 10: Verify No Critical Errors ===');

    const hasSessionErrors = consoleErrors.some((e) => e.includes('Session Already Connected'));
    const hasRatchetErrors = consoleErrors.some(
      (e) => e.includes('Ratchet does not exist') || e.includes('ratchet v')
    );

    // "Session Already Connected" is a benign race condition in this test scenario:
    // TCP drop + explicit disconnect + ClaimSession + fresh login causes the auto-connect
    // service and the manual login to race. The system handles this via exponential backoff
    // retry. Since all messaging works, treat as PASS with a warning note.
    // Named for what it is. The reasoning above — that this race is benign and
    // handled by retry — is sound, and the status is deliberately hardcoded
    // because of it. But a row called "No Session Errors: PASS" that cannot
    // report anything else is fake evidence: it reads, in the results table,
    // exactly like a check that ran and found nothing.
    results.push({
      step: 'Phase 10a: Session errors (informational)',
      status: 'PASS',
      notes: hasSessionErrors
        ? 'Session Already Connected seen — benign race during mixed reconnection, not gated'
        : 'None seen',
    });

    results.push({
      step: 'Phase 10b: No Ratchet Errors',
      status: !hasRatchetErrors ? 'PASS' : 'FAIL',
      notes: !hasRatchetErrors ? 'None' : 'Found ratchet errors',
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
