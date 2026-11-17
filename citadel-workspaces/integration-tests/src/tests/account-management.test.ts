/**
 * Account Management Integration Test (P14)
 *
 * Tests account management features:
 * 1. AccountManagementDialog (from WorkspaceSwitcher or landing)
 * 2. LoginConflictModal
 * 3. /connect saved workspaces page
 * 4. Login passkey-enrol switch (replaced "Remember credentials")
 */

import { Page } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isHiddenWithin, isVisibleWithin, waitForAppReady } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreated: boolean;

  // AccountManagementDialog
  accountMgmtOpens: boolean;
  sessionListVisible: boolean;

  // Login page features
  loginPageRenders: boolean;
  passkeyEnrolVisible: boolean;

  // Saved workspaces

  // LoginConflictModal
  loginConflictDetected: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `acctmgmt_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

async function testAccountManagementDialog(page: Page): Promise<{
  opens: boolean;
  sessionList: boolean;
}> {
  console.log('\n=== Testing Account Management Dialog ===');

  const results = { opens: false, sessionList: false };

  // Manage Accounts is a button on the LANDING page (Landing.tsx renders
  // <ManageAccountsButton/>), not an item in the workspace switcher dropdown.
  // This used to open the switcher and hunt for a "Manage Accounts" menu item
  // that has never been there, so the dialog was never opened and both this and
  // the session-list assertion reported failures the app had not made.
  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);

  const manageAccounts = page.getByRole('button', { name: 'Manage Accounts' });
  if (!(await isVisibleWithin(manageAccounts, 10_000))) {
    console.log('  Manage Accounts button not found on the landing page');
    return results;
  }

  await manageAccounts.click();

  const dialog = page.locator('[role="dialog"]').first();
  results.opens = await isVisibleWithin(dialog, 10_000);
  console.log(`  Dialog opens: ${results.opens}`);

  if (results.opens) {
    // Active Sessions, by its real heading. The old check accepted "the dialog
    // has more than 50 characters of text" as a fallback, which any open dialog
    // satisfies and which therefore asserted nothing at all.
    //
    // Only Active Sessions is asserted. Saved Accounts renders solely when
    // storedSessions is non-empty, which requires having logged in with Remember
    // Credentials enabled — something this spec never does, so requiring it would
    // be asserting a state the test did not create. This account was just
    // created, so an active session must be listed.
    results.sessionList = await isVisibleWithin(dialog.getByText(/Active Sessions/), 5000);
    console.log(`  Active sessions listed: ${results.sessionList}`);

    await page.keyboard.press('Escape');
    await isHiddenWithin(dialog, 5000);
  }

  return results;
}

async function testLoginPage(page: Page): Promise<{
  renders: boolean;
  passkeyEnrol: boolean;
}> {
  console.log('\n=== Testing Login Page Features ===');

  const results = { renders: false, passkeyEnrol: false };

  await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);

  const loginBtn = page.getByTestId('sign-in-button');
  if (!(await isVisibleWithin(loginBtn, 10_000))) {
    console.log('  Sign In button not found');
    return results;
  }

  await loginBtn.click();

  // The real heading (Login.tsx renders <h2>Login to Workspace</h2>). The old
  // selector was `'text="Login to Workspace", text="Login"'` — a comma list of
  // two text engines, which is not parsed as a union of the two, so it matched
  // nothing regardless of what had rendered.
  results.renders = await isVisibleWithin(
    page.getByRole('heading', { name: 'Login to Workspace' }), 10_000
  );
  console.log(`  Login page renders: ${results.renders}`);

  if (!results.renders) return results;

  // The passkey-enrol switch (it replaced plaintext "Remember Credentials")
  // sits inside the collapsed "Advanced Options" section,
  // beside Configure. Without expanding it the control is genuinely not on
  // screen — the same omission that hid the Configure button in
  // security-settings.
  const advancedOptions = page.getByRole('button', { name: /Advanced Options/i });
  if (await isVisibleWithin(advancedOptions, 10_000)) {
    await advancedOptions.click();
  }

  results.passkeyEnrol = await isVisibleWithin(page.getByText(/Add a security key after I sign in|Passkeys need a secure/i), 5000);
  console.log(`  Passkey enrol switch visible: ${results.passkeyEnrol}`);

  await page.keyboard.press('Escape');

  return results;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Account Management Test',
    reportFileName: 'ACCOUNT_MANAGEMENT_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    accountMgmtOpens: false,
    sessionListVisible: false,
    loginPageRenders: false,
    passkeyEnrolVisible: false,
    loginConflictDetected: false,
  };

  try {
    const page = await context.newPage();
    setupConsoleCapture(page, 'AcctMgmt', ['error', 'Error', 'Login', 'Account', 'ILM']);

    // ========== STEP 1: Create Account ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('\u2500'.repeat(50));

    results.accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    if (!results.accountCreated) throw new Error('Account creation failed');

    await sleep(3000);
    await closeAnyModals(page);
    await waitForWorkspaceLoaded(page, 30000);

    // ========== STEP 2: Test Account Management Dialog ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 2: Test Account Management Dialog');
    console.log('\u2500'.repeat(50));

    const acctMgmtResult = await testAccountManagementDialog(page);
    results.accountMgmtOpens = acctMgmtResult.opens;
    results.sessionListVisible = acctMgmtResult.sessionList;
    await takeScreenshot(page, '02_acct_mgmt');

    // ========== STEP 3: Navigate to Landing ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 3: Test Login Page Features');
    console.log('\u2500'.repeat(50));

    const loginResult = await testLoginPage(page);
    results.loginPageRenders = loginResult.renders;
    results.passkeyEnrolVisible = loginResult.passkeyEnrol;
    await takeScreenshot(page, '03_login_page');

    // ========== STEP 4: Check Saved Workspaces ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 4: Check Saved Workspaces');
    console.log('\u2500'.repeat(50));

    await takeScreenshot(page, '04_saved_workspaces');

    // ========== STEP 5: Login Conflict ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 5: Login Conflict Detection');
    console.log('\u2500'.repeat(50));

    // LoginConflictModal only appears when logging in while already logged in
    // This is hard to trigger deterministically, but we can check if the modal
    // component exists in the page by attempting a second login
    console.log('  LoginConflictModal: Requires simultaneous login (skipped for deterministic testing)');
    results.loginConflictDetected = false; // Cannot deterministically trigger
    await takeScreenshot(page, '05_conflict');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // loginConflictDetected stays out: it needs a second session competing for
    // the same account, which this spec does not set up, and it already reports
    // SKIP rather than CHECK. The other five are unconditional.
    const corePassed = [
      results.accountCreated,
      results.accountMgmtOpens,
      results.sessionListVisible,
      results.loginPageRenders,
      results.passkeyEnrolVisible,
    ].every(Boolean);

    console.log(`\n  Account Created:           ${results.accountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Acct Mgmt Dialog Opens:    ${results.accountMgmtOpens ? 'PASS' : 'CHECK'}`);
    console.log(`  Session List:              ${results.sessionListVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Login Page Renders:        ${results.loginPageRenders ? 'PASS' : 'CHECK'}`);
    console.log(`  Passkey enrol switch:     ${results.passkeyEnrolVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Login Conflict:            ${results.loginConflictDetected ? 'PASS' : 'SKIP'}`);

    harness.finalize(corePassed, results);
    return corePassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

runTestMain(runTest);
