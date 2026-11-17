/**
 * P2P-Only Reconnection Test
 *
 * Tests P2P disconnect while C2S stays active:
 * 1. Create 2 accounts (user1 initializes workspace)
 * 2. P2P register user1 ↔ user2
 * 3. Send messages, verify delivery
 * 4. disconnectP2P(user2, user1) - P2P disconnects, C2S stays active
 * 5. Verify both users still on /workspace (C2S active)
 * 6. connectP2P(user2, user1) - Reconnect P2P
 * 7. Send more messages, verify delivery
 * 8. Verify no ratchet errors
 *
 * Key insight: This tests the P2P protocol flow where after registration,
 * you can connect → disconnect → connect without re-registering.
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
  sendMessage,
  verifyMessageReceived,
  takeScreenshot,
  setupConsoleCapture,
  config,
  TestHarness,
  runTestMain,
  waitForWorkspaceLoaded,
} from '../../lib/index.js';

// Test configuration
const timestamp = Date.now();
const USER1_NAME = `p2p_recon_1_${timestamp}`;
const USER2_NAME = `p2p_recon_2_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  notes: string;
}

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'P2P-Only Reconnection Test',
    reportFileName: 'p2p-only-reconnect-test.json',
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

    // Track errors in array
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

    // User1 (first user - initializes workspace)
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

    if (!user1Created) {
      console.error('User1 creation failed');
      return false;
    }

    await sleep(3000);

    // User2 (joins existing workspace)
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

    if (!user2Created) {
      console.error('User2 creation failed');
      return false;
    }


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

    // User1 initiates P2P registration with User2
    const p2pRequested = await p2pRegister(page1, USER1_NAME, USER2_NAME, uxTracker);

    results.push({
      step: 'Phase 2a: P2P Register Request (user1 → user2)',
      status: p2pRequested ? 'PASS' : 'FAIL',
      notes: p2pRequested ? 'P2P registration initiated' : 'Failed to initiate P2P registration',
    });

    if (!p2pRequested) {
      console.error('P2P registration request failed');
      return false;
    }

    await sleep(3000);

    // User2 accepts the P2P request
    const p2pAccepted = await acceptP2PRequest(page2, USER2_NAME, uxTracker, USER1_NAME);

    results.push({
      step: 'Phase 2b: P2P Accept Request (user2)',
      status: p2pAccepted ? 'PASS' : 'FAIL',
      notes: p2pAccepted ? 'P2P registration accepted' : 'Failed to accept P2P registration',
    });

    if (!p2pAccepted) {
      console.error('P2P registration accept failed');
      return false;
    }

    await sleep(3000);
    await takeScreenshot(page1, `${USER1_NAME}_phase2_registered`);
    await takeScreenshot(page2, `${USER2_NAME}_phase2_registered`);

    // ===== PHASE 3: Send Initial Messages =====
    console.log('\n=== Phase 3: Send Initial Messages ===');

    // Open conversation on both sides
    const conv1Opened = await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    const conv2Opened = await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    results.push({
      step: 'Phase 3a: Open Conversations',
      status: conv1Opened && conv2Opened ? 'PASS' : 'FAIL',
      notes: `User1: ${conv1Opened}, User2: ${conv2Opened}`,
    });

    if (!conv1Opened || !conv2Opened) {
      console.error('Failed to open conversations');
      return false;
    }

    // Send message from user1 to user2
    const msg1 = `Hello from ${USER1_NAME} before P2P disconnect - ${Date.now()}`;
    const msg1Sent = await sendMessage(page1, USER1_NAME, msg1, uxTracker);

    results.push({
      step: 'Phase 3b: Send Message (user1 → user2)',
      status: msg1Sent ? 'PASS' : 'FAIL',
      notes: msg1Sent ? 'Message sent' : 'Failed to send',
    });

    if (msg1Sent) {
      const msg1Received = await verifyMessageReceived(page2, USER2_NAME, msg1, 30000, uxTracker);
      results.push({
        step: 'Phase 3c: Verify Message Received (user2)',
        status: msg1Received ? 'PASS' : 'FAIL',
        notes: msg1Received ? 'Message received' : 'Message not received',
      });
    }

    await takeScreenshot(page1, `${USER1_NAME}_phase3_msg_sent`);
    await takeScreenshot(page2, `${USER2_NAME}_phase3_msg_received`);

    // ===== PHASE 4: Disconnect P2P (C2S stays active) =====
    console.log('\n=== Phase 4: Disconnect P2P (C2S stays active) ===');

    const p2pDisconnected = await disconnectP2P(page2, USER2_NAME, USER1_NAME, uxTracker);

    results.push({
      step: 'Phase 4: P2P Disconnect (user2 from user1)',
      status: p2pDisconnected ? 'PASS' : 'FAIL',
      notes: p2pDisconnected ? 'P2P disconnected, C2S still active' : 'P2P disconnect failed',
    });

    if (!p2pDisconnected) {
      console.error('P2P disconnect failed');
      return false;
    }

    await sleep(2000);

    // Verify both users still on workspace (C2S active)
    const user1Url = page1.url();
    const user2Url = page2.url();
    const user1OnWorkspace = user1Url.includes('/workspace') || user1Url.includes('/office');
    const user2OnWorkspace = user2Url.includes('/workspace') || user2Url.includes('/office');

    results.push({
      step: 'Phase 4b: Verify C2S Still Active',
      status: user1OnWorkspace && user2OnWorkspace ? 'PASS' : 'FAIL',
      notes: `User1: ${user1Url}, User2: ${user2Url}`,
    });

    await takeScreenshot(page1, `${USER1_NAME}_phase4_after_p2p_disconnect`);
    await takeScreenshot(page2, `${USER2_NAME}_phase4_after_p2p_disconnect`);

    // ===== PHASE 5: Reconnect P2P =====
    console.log('\n=== Phase 5: Reconnect P2P ===');

    const p2pReconnected = await connectP2P(page2, USER2_NAME, USER1_NAME, uxTracker);

    results.push({
      step: 'Phase 5: P2P Reconnect (user2 to user1)',
      status: p2pReconnected ? 'PASS' : 'FAIL',
      notes: p2pReconnected ? 'P2P reconnected' : 'P2P reconnect failed',
    });

    if (!p2pReconnected) {
      console.error('P2P reconnect failed');
      // Continue anyway to see what happens
    }

    await sleep(3000);
    await takeScreenshot(page1, `${USER1_NAME}_phase5_p2p_reconnected`);
    await takeScreenshot(page2, `${USER2_NAME}_phase5_p2p_reconnected`);

    // ===== PHASE 6: Send Messages After Reconnect =====
    console.log('\n=== Phase 6: Send Messages After Reconnect ===');

    // Reopen conversations (may need to refresh UI state)
    await openConversation(page1, USER1_NAME, USER2_NAME, uxTracker);
    await openConversation(page2, USER2_NAME, USER1_NAME, uxTracker);

    // Send message from user2 to user1 after reconnect
    const msg2 = `Hello from ${USER2_NAME} after P2P reconnect - ${Date.now()}`;
    const msg2Sent = await sendMessage(page2, USER2_NAME, msg2, uxTracker);

    results.push({
      step: 'Phase 6a: Send Message After Reconnect (user2 → user1)',
      status: msg2Sent ? 'PASS' : 'FAIL',
      notes: msg2Sent ? 'Message sent' : 'Failed to send',
    });

    if (msg2Sent) {
      const msg2Received = await verifyMessageReceived(page1, USER1_NAME, msg2, 30000, uxTracker);
      results.push({
        step: 'Phase 6b: Verify Message Received (user1)',
        status: msg2Received ? 'PASS' : 'FAIL',
        notes: msg2Received ? 'Message received' : 'Message not received',
      });
    }

    await takeScreenshot(page1, `${USER1_NAME}_phase6_msg_received`);
    await takeScreenshot(page2, `${USER2_NAME}_phase6_msg_sent`);

    // ===== PHASE 7: Verify No Ratchet Errors =====
    console.log('\n=== Phase 7: Verify No Ratchet Errors ===');

    const hasRatchetErrors = consoleErrors.some(
      (e) => e.includes('Ratchet does not exist') || e.includes('ratchet v')
    );

    results.push({
      step: 'Phase 7: No Ratchet Errors',
      status: !hasRatchetErrors ? 'PASS' : 'FAIL',
      notes: !hasRatchetErrors
        ? 'No ratchet errors detected'
        : `Found ${consoleErrors.filter((e) => e.includes('Ratchet') || e.includes('ratchet')).length} ratchet errors`,
    });

    // Print results
    printResults(results);

    // Log any console errors found
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

// Run the test
runTestMain(runTest);
