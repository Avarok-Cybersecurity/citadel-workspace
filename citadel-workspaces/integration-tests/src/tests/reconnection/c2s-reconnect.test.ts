/**
 * C2S Reconnection Test
 *
 * Mirrors SDK test: reconnection_c2s.rs
 *
 * Tests the C2S logout/login cycle:
 * 1. Create account (first user - initializes workspace)
 * 2. Verify connection (on /workspace page)
 * 3. Logout via TopBar Sign out (disconnect C2S)
 * 4. Login again (reconnect C2S)
 * 5. Verify connection restored
 * 6. Verify no "Session Already Connected" errors
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import {
  isVisibleWithin,
  sleep,
  createBrowser,
  createAccount,
  disconnectViaTopBar,
  loginAfterDisconnect,
  assertSessionNotInOrphanNavbar,
  waitForWorkspaceLoaded,
  takeScreenshot,
  setupConsoleCapture,
  config,
  TestHarness,
  runTestMain,
} from '../../lib/index.js';

// Test configuration
const timestamp = Date.now();
const USERNAME = `c2s_reconnect_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

interface TestResult {
  step: string;
  status: 'PASS' | 'FAIL' | 'SKIP';
  notes: string;
}

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'C2S Reconnection Test',
    reportFileName: 'c2s-reconnection-test.json',
    metadata: { username: USERNAME },
  });
  const uxTracker = harness.uxTracker;

  const results: TestResult[] = [];
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  const consoleErrors: string[] = [];

  try {

    // Create browser with shared context
    const browserResult = await createBrowser();
    browser = browserResult.browser;
    context = browserResult.context;
    page = await context.newPage();

    // Setup console capture to detect session errors
    setupConsoleCapture(page, USERNAME, ['Session Already Connected', 'Ratchet does not exist', 'ratchet v', 'ILM']);

    // Also track errors in our array
    page.on('console', (msg) => {
      const text = msg.text();
      if (
        text.includes('Session Already Connected') ||
        text.includes('Ratchet does not exist') ||
        text.includes('ratchet v')
      ) {
        consoleErrors.push(text);
        console.log(`[CONSOLE ERROR] ${text}`);
        uxTracker.log('critical', 'functional', text);
      }
    });

    // ===== PHASE 1: Create Account =====
    console.log('\n=== Phase 1: Create Account ===');

    const accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    results.push({
      step: 'Phase 1: Create Account',
      status: accountCreated ? 'PASS' : 'FAIL',
      notes: accountCreated ? `Created ${USERNAME}` : 'Failed to create account',
    });

    if (!accountCreated) {
      console.error('Account creation failed, cannot continue test');
      return false;
    }

    // ===== PHASE 2: Verify Initial Connection =====
    console.log('\n=== Phase 2: Verify Initial Connection ===');

    await sleep(2000);
    const currentUrl = page.url();
    const isOnWorkspace = currentUrl.includes('/workspace') || currentUrl.includes('/office');

    await takeScreenshot(page, `${USERNAME}_phase2_workspace`);

    results.push({
      step: 'Phase 2: Verify Initial Connection',
      status: isOnWorkspace ? 'PASS' : 'FAIL',
      notes: isOnWorkspace ? `On workspace page: ${currentUrl}` : `Not on workspace page: ${currentUrl}`,
    });

    if (!isOnWorkspace) {
      console.error('Not on workspace page after account creation');
      return false;
    }

    // Navigate to General office if visible (optional — not a test criterion)
    try {
      const generalOffice = page.locator('text=General').first();
      if (await isVisibleWithin(generalOffice, 3000)) {
        await generalOffice.click();
        await sleep(1000);
        console.log('  Clicked General office');
      } else {
        console.log('  General office not visible — skipping');
      }
    } catch (e) {
      console.log(`  General office click failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    await takeScreenshot(page, `${USERNAME}_phase2_in_office`);

    // ===== PHASE 3: Logout (Disconnect C2S) =====
    console.log('\n=== Phase 3: Logout (Disconnect C2S) ===');

    const loggedOut = await disconnectViaTopBar(page, USERNAME, uxTracker);

    results.push({
      step: 'Phase 3: Logout',
      status: loggedOut ? 'PASS' : 'FAIL',
      notes: loggedOut ? 'Successfully logged out via TopBar' : 'Failed to logout',
    });

    if (!loggedOut) {
      console.error('Logout failed');
      return false;
    }

    await sleep(2000);
    await takeScreenshot(page, `${USERNAME}_phase3_after_logout`);

    // Verify session is NOT in OrphanSessionsNavbar (explicit disconnect removes session)
    const notOrphaned = await assertSessionNotInOrphanNavbar(page, USERNAME, uxTracker);
    results.push({
      step: 'Phase 3: Session Not Orphaned',
      status: notOrphaned ? 'PASS' : 'FAIL',
      notes: notOrphaned
        ? 'Session correctly NOT in OrphanSessionsNavbar after explicit disconnect'
        : 'Session unexpectedly found in OrphanSessionsNavbar',
    });

    // ===== PHASE 4: Login Again (Reconnect C2S) =====
    console.log('\n=== Phase 4: Login Again (Reconnect C2S) ===');

    const loggedIn = await loginAfterDisconnect(
      page,
      USERNAME,
      PASSWORD,
      uxTracker,
      config.WORKSPACE_SERVER
    );

    results.push({
      step: 'Phase 4: Login Again',
      status: loggedIn ? 'PASS' : 'FAIL',
      notes: loggedIn ? 'Successfully logged back in' : 'Failed to login',
    });

    if (!loggedIn) {
      console.error('Login after disconnect failed');
      return false;
    }

    await sleep(2000);
    await takeScreenshot(page, `${USERNAME}_phase4_after_login`);

    // ===== PHASE 5: Verify Connection Restored =====
    console.log('\n=== Phase 5: Verify Connection Restored ===');

    const workspaceLoaded = await waitForWorkspaceLoaded(page, 30000);
    const currentUrl2 = page.url();
    const isOnWorkspace2 = currentUrl2.includes('/workspace') || currentUrl2.includes('/office');

    await takeScreenshot(page, `${USERNAME}_phase5_reconnected`);

    // Try to navigate to General office again to verify workspace functionality
    try {
      const generalOffice = page.locator('text=General').first();
      if (await isVisibleWithin(generalOffice, 5000)) {
        await generalOffice.click();
        await sleep(1000);
        console.log('  Clicked General office after reconnection');
      } else {
        console.log('  General office not visible after reconnection — skipping');
      }
    } catch (e) {
      console.log(`  General office click failed after reconnection: ${e instanceof Error ? e.message : String(e)}`);
    }

    await takeScreenshot(page, `${USERNAME}_phase5_in_office`);

    results.push({
      step: 'Phase 5: Verify Connection Restored',
      status: workspaceLoaded && isOnWorkspace2 ? 'PASS' : 'FAIL',
      notes: workspaceLoaded && isOnWorkspace2
        ? `Workspace loaded at: ${currentUrl2}`
        : `Workspace not restored: loaded=${workspaceLoaded}, url=${currentUrl2}`,
    });

    // ===== PHASE 6: Verify No Session Errors =====
    console.log('\n=== Phase 6: Verify No Session Errors ===');

    const hasSessionErrors = consoleErrors.some((e) =>
      e.includes('Session Already Connected')
    );
    const hasRatchetErrors = consoleErrors.some(
      (e) => e.includes('Ratchet does not exist') || e.includes('ratchet v')
    );

    results.push({
      step: 'Phase 6: No "Session Already Connected" Errors',
      status: !hasSessionErrors ? 'PASS' : 'FAIL',
      notes: !hasSessionErrors
        ? 'No session errors detected'
        : `Found ${consoleErrors.filter((e) => e.includes('Session Already Connected')).length} session errors`,
    });

    results.push({
      step: 'Phase 6: No Ratchet Errors',
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

    if (page) {
      await takeScreenshot(page, `${USERNAME}_error`);
    }

    printResults(results);
    return false;
  } finally {
    if (browser) {
      await browser.close();
    }
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
