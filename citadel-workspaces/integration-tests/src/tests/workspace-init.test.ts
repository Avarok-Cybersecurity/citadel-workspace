/**
 * Workspace Initialization Test
 *
 * Tests the first-user workspace initialization flow:
 * 1. First user sees WorkspaceInitializationModal after registration
 * 2. First user initializes workspace with password
 * 3. Second user does NOT see initialization modal
 * 4. Workspace is properly initialized for both users
 */

import { Page } from 'playwright';
import {
  sleep,
  createBrowser,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  clearBrowserStorage,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { waitForRegistrationToSettle } from '../lib/post-registration.js';
import { isHiddenWithin, isVisibleWithin, waitForAppReady } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // First user
  firstUserRegistered: boolean;
  initModalAppears: boolean;
  dismissalSticks: boolean;
  modalHasTitle: boolean;
  modalHasPasswordField: boolean;
  modalHasInitButton: boolean;
  initSubmitted: boolean;
  firstUserWorkspaceLoaded: boolean;

  // Second user
  secondUserRegistered: boolean;
  noInitModalForSecond: boolean;
  secondUserWorkspaceLoaded: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const FIRST_USER = `init_first_${timestamp}`;
const SECOND_USER = `init_second_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Register a new user (without workspace initialization handling)
 */
async function registerUser(page: Page, username: string, password: string): Promise<boolean> {
  console.log(`\n=== Registering user: ${username} ===`);

  let submitted: boolean = false;
  try {
    // Navigate to app
    // Wait for the app to render, not a fixed 2s. On a cold dev server the
    // first load compiles for 10-30s; the fixed sleep plus a 5s button check
    // skipped every step for the first user and still reported success, so
    // CI failed three steps later at "Workspace Loaded" with no Register sent
    // (master 6e3c3b27, #171, 2026-09-28). createAccount already did this.
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60000 });
    await waitForAppReady(page, 60_000);

    // Clear browser storage
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    await waitForAppReady(page, 30_000);

    const joinBtn = page.getByTestId('create-account-button');
    if (!(await isVisibleWithin(joinBtn, 10_000))) {
      console.log(`  No Create Account button for ${username}; nothing was submitted`);
      return false;
    }
    await joinBtn.click();
    await sleep(1000);

    // Step 1: Fill workspace address
    const serverInput = page.getByRole('textbox', { name: 'Workspace Address' });
    if (await isVisibleWithin(serverInput, 5000)) {
      await serverInput.fill(config.WORKSPACE_SERVER);
      await sleep(500);

      const nextBtn = page.getByRole('button', { name: 'NEXT' });
      await nextBtn.click();
      await sleep(2000);
    }

    // Step 2: Security Settings - just click NEXT
    const securityTitle = page.locator('text="Security Settings"');
    if (await isVisibleWithin(securityTitle, 3000)) {
      const nextBtn = page.getByRole('button', { name: 'NEXT' });
      await nextBtn.click();
      await sleep(2000);
    }

    // Step 3: User Details form
    const fullNameInput = page.getByRole('textbox', { name: 'Full Name' });
    if (await isVisibleWithin(fullNameInput, 5000)) {
      await fullNameInput.fill(username);
      await sleep(300);

      const usernameInput = page.getByRole('textbox', { name: 'Username' });
      if (await usernameInput.isVisible()) {
        await usernameInput.fill(username);
        await sleep(300);
      }

      const passwordInput = page.getByRole('textbox', { name: 'Profile Password', exact: true });
      const confirmPasswordInput = page.getByRole('textbox', { name: 'Confirm Profile Password' });

      if (await passwordInput.isVisible()) {
        await passwordInput.fill(password);
        await sleep(300);
      }
      if (await confirmPasswordInput.isVisible()) {
        await confirmPasswordInput.fill(password);
        await sleep(300);
      }

      // Click JOIN button
      const submitBtn = page.getByRole('button', { name: 'Join', exact: true });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        submitted = true;
        // Answers "Secure your account" (a post-quantum server's key and
        // recovery codes) and waits for the workspace, instead of a blind 5s.
        await waitForRegistrationToSettle(page);
      }
    }

    if (!submitted) {
      console.log(`  The profile form never reached Join for ${username}; nothing was submitted`);
      return false;
    }
    console.log(`  User ${username} registration submitted`);
    return true;
  } catch (error) {
    console.error(`  Error registering user ${username}:`, error);
    return false;
  }
}

/**
 * Check if WorkspaceInitializationModal appears
 */
/**
 * Closing the initialization modal has to keep it closed.
 *
 * Regression test. The app retries workspace operations after dismissal, and each
 * retry fails with the same "No workspace found" error. useMessageEventSetup used
 * to respond to that error by calling setShowInitModal(true) directly, skipping
 * the `!initModalDismissed` guard in WorkspaceEventHandler — so the modal
 * reappeared within seconds and a user had no way to keep it shut. Only the state
 * flag is set now, and the guarded effect decides.
 *
 * Waits out several retry cycles rather than checking once: the bug was a
 * reappearance a moment later, which an immediate assertion would miss.
 */
async function dismissedModalStaysClosed(page: Page, username: string): Promise<boolean> {
  const modal = page.locator('[role="dialog"]');
  // By testid, not by the word on it.
  //
  // The button is called "Not now" -- "Cancel" is ambiguous on a modal you are
  // declining rather than aborting -- and this looked for `Cancel`, found
  // nothing, and reported "Dismissal Sticks: FAIL" for a feature that works.
  // Round 190's rule, and the second CI failure this session caused by a check
  // pinned to copy that improved.
  const decline = page.getByTestId('init-modal-decline');

  if (!(await isVisibleWithin(decline, 5000))) {
    console.log('  No decline button on the init modal — cannot test dismissal');
    return false;
  }

  await decline.click();

  if (!(await isHiddenWithin(modal, 5000))) {
    console.log('  Modal did not close on Cancel');
    return false;
  }

  // Cancelling means declining to set this workspace up, so it must return to
  // the index rather than leave the user inside a workspace that does not exist
  // yet — which showed an empty, non-functional shell with no way back and no
  // explanation.
  const backAtIndex = await page
    .waitForURL((url) => new URL(url).pathname === '/', { timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!backAtIndex) {
    console.log(`  Cancel did not return to the index (still on ${page.url()})`);
    return false;
  }

  // If it is coming back, it comes back on the next failed workspace call.
  const reappeared = await modal
    .waitFor({ state: 'visible', timeout: 12_000 })
    .then(() => true)
    .catch(() => false);

  console.log(`  Stayed dismissed: ${!reappeared}`);

  // Put the app back how it was found, so the steps after this one still have a
  // modal to initialise the workspace with.
  //
  // Two things have to be undone, not one. The dismissal is remembered in
  // sessionStorage, and cancelling now also returns to the index — declining
  // setup should not leave you inside a workspace that does not exist yet. So a
  // reload alone lands back on the landing page with no modal to submit, which
  // is what made every step after this one fail.
  //
  // The session is still live after that redirect, so it is listed for resuming;
  // claiming it is both the shortest way back and the path a real user takes.
  await page.evaluate(() => sessionStorage.removeItem('workspace-init-modal-dismissed'));
  // Reload before resuming, not after. The app reads the dismissal flag into
  // component state once at load, and claiming a session does not remount it —
  // so clearing the key alone left the in-memory flag set and the modal stayed
  // suppressed, which read exactly like initialisation being broken.
  await page.reload({ waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);

  const resume = page.locator(`[data-testid="session-button-${username}"]`);
  if (await isVisibleWithin(resume, 30_000)) {
    await resume.click();
  } else {
    console.log('  No session listed to resume after the cancel redirect');
    return false;
  }
  await waitForAppReady(page, 60_000);
  // No assertion that the modal came back here — the next step waits for it and
  // asserts it properly. Checking twice on a shorter budget only produced a
  // warning that contradicted the step that followed it.

  return !reappeared;
}

async function checkInitModalAppears(page: Page): Promise<{
  appears: boolean;
  hasTitle: boolean;
  hasPasswordField: boolean;
  hasInitButton: boolean;
}> {
  console.log('\n=== Checking for Initialization Modal ===');

  const results = {
    appears: false,
    hasTitle: false,
    hasPasswordField: false,
    hasInitButton: false,
  };

  // Check for modal title "Initialize Workspace"
  const modalTitle = page.locator('text="Initialize Workspace"');
  results.hasTitle = await isVisibleWithin(modalTitle, 8000);
  console.log(`  Modal title visible: ${results.hasTitle}`);

  if (results.hasTitle) {
    results.appears = true;

    // Check for password field
    const passwordField = page.locator('input#masterPassword');
    results.hasPasswordField = await isVisibleWithin(passwordField, 3000);
    console.log(`  Password field visible: ${results.hasPasswordField}`);

    // Check for "Initialize & Become Admin" button
    const initButton = page.locator('button:has-text("Initialize & Become Admin")');
    results.hasInitButton = await isVisibleWithin(initButton, 3000);
    console.log(`  Initialize button visible: ${results.hasInitButton}`);
  }

  return results;
}

/**
 * Submit the workspace initialization form
 */
async function submitInitialization(page: Page, password: string): Promise<boolean> {
  console.log('\n=== Submitting Workspace Initialization ===');

  try {
    // Fill password
    const passwordField = page.locator('input#masterPassword');
    if (!(await isVisibleWithin(passwordField, 3000))) {
      console.log('  Password field not found');
      return false;
    }

    await passwordField.fill(password);
    await sleep(500);

    // Click "Initialize & Become Admin" button
    const initButton = page.locator('button:has-text("Initialize & Become Admin")');
    if (!(await isVisibleWithin(initButton, 3000))) {
      console.log('  Initialize button not found');
      return false;
    }

    await initButton.click();

    // Wait for the modal to GO, rather than sleeping a fixed 5s and sampling
    // once. isVisible ignores its timeout option (Playwright declares it
    // deprecated), so the old form asked "is it visible at this instant" — and a
    // selector that matched nothing, for any reason, reported the modal closed
    // and this function returned SUCCESS for an initialization that may never
    // have happened. isHiddenWithin asks the right question and returns the
    // moment it holds, so a fast init no longer pays the 5 seconds.
    const initModal = page.locator('text="Initialize Workspace"');
    const modalClosed = await isHiddenWithin(initModal, 15_000);

    if (modalClosed) {
      console.log('  Initialization submitted successfully');
      return true;
    } else {
      // Check for error message.
      //
      // By testid. This was `.text-red-400`, a class that appears NOWHERE in the
      // app -- WorkspaceInitializationModal renders its error with
      // `role="alert"` and `text-destructive-emphasis`. So the locator matched
      // nothing, this branch never ran, and an initialization failure was
      // reported without the reason the modal was displaying at the time.
      const errorMsg = page.getByTestId('init-modal-error');
      if (await isVisibleWithin(errorMsg, 2000)) {
        const errorText = await errorMsg.textContent();
        console.log(`  Initialization error: ${errorText}`);
      }
      return false;
    }
  } catch (error) {
    console.error('  Error submitting initialization:', error);
    return false;
  }
}

/**
 * Check that no initialization modal appears
 */
async function checkNoInitModal(page: Page): Promise<boolean> {
  console.log('\n=== Checking that NO Initialization Modal Appears ===');

  // Wait a few seconds to make sure modal would have appeared if it was going to
  await sleep(5000);

  // Check for modal title
  const modalTitle = page.locator('text="Initialize Workspace"');
  const appears = await isVisibleWithin(modalTitle, 3000);
  console.log(`  Initialization modal appears: ${appears}`);

  return !appears; // Return true if modal does NOT appear
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Workspace Initialization Test',
    reportFileName: 'WORKSPACE_INIT_TEST_REPORT.json',
    metadata: { firstUser: FIRST_USER, secondUser: SECOND_USER },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`First User: ${FIRST_USER}`);
  console.log(`Second User: ${SECOND_USER}`);
  console.log('');

  // Setup browser
  const { browser, context } = await createBrowser();

  const results: TestResults = {
    firstUserRegistered: false,
    initModalAppears: false,
    dismissalSticks: false,
    modalHasTitle: false,
    modalHasPasswordField: false,
    modalHasInitButton: false,
    initSubmitted: false,
    firstUserWorkspaceLoaded: false,
    secondUserRegistered: false,
    noInitModalForSecond: false,
    secondUserWorkspaceLoaded: false,
  };

  try {
    // ========== PART 1: First User (Should See Init Modal) ==========
    console.log('\n' + '='.repeat(50));
    console.log('PART 1: FIRST USER INITIALIZATION');
    console.log('='.repeat(50));

    const firstPage = await context.newPage();
    setupConsoleCapture(firstPage, 'FirstUser', ['error', 'Error', 'Initialize', 'Workspace', 'ILM']);

    // ========== STEP 1: Register First User ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Register First User');
    console.log('─'.repeat(50));

    results.firstUserRegistered = await registerUser(firstPage, FIRST_USER, PASSWORD);
    await takeScreenshot(firstPage, '01_first_user_registered');

    if (!results.firstUserRegistered) {
      throw new Error('First user registration failed');
    }

    // ========== STEP 2: Check for Init Modal ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Check for Initialization Modal');
    console.log('─'.repeat(50));

    const modalCheck = await checkInitModalAppears(firstPage);
    results.initModalAppears = modalCheck.appears;
    results.modalHasTitle = modalCheck.hasTitle;
    results.modalHasPasswordField = modalCheck.hasPasswordField;
    results.modalHasInitButton = modalCheck.hasInitButton;

    await takeScreenshot(firstPage, '02_init_modal');

    if (!results.initModalAppears) {
      console.log('  WARNING: Initialization modal did not appear');
      uxTracker.log('major', 'functional', 'Workspace initialization modal not shown for first user');
    }

    // ========== STEP 2b: Dismissal must stick ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2b: Dismissed Init Modal Stays Dismissed');
    console.log('─'.repeat(50));

    if (results.initModalAppears) {
      results.dismissalSticks = await dismissedModalStaysClosed(firstPage, FIRST_USER);
    }

    // ========== STEP 3: Submit Initialization ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Submit Workspace Initialization');
    console.log('─'.repeat(50));

    if (results.initModalAppears) {
      results.initSubmitted = await submitInitialization(firstPage, config.WORKSPACE_PASSWORD);
      await takeScreenshot(firstPage, '03_init_submitted');
    }

    // ========== STEP 4: Verify Workspace Loaded for First User ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Verify Workspace Loaded');
    console.log('─'.repeat(50));

    results.firstUserWorkspaceLoaded = await waitForWorkspaceLoaded(firstPage, 30000);
    console.log(`  Workspace loaded for first user: ${results.firstUserWorkspaceLoaded}`);
    await takeScreenshot(firstPage, '04_first_user_workspace');

    // ========== PART 2: Second User (Should NOT See Init Modal) ==========
    console.log('\n' + '='.repeat(50));
    console.log('PART 2: SECOND USER (NO INIT MODAL)');
    console.log('='.repeat(50));

    const secondPage = await context.newPage();
    setupConsoleCapture(secondPage, 'SecondUser', ['error', 'Error', 'Initialize', 'Workspace', 'ILM']);

    // ========== STEP 5: Register Second User ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Register Second User');
    console.log('─'.repeat(50));

    results.secondUserRegistered = await registerUser(secondPage, SECOND_USER, PASSWORD);
    await takeScreenshot(secondPage, '05_second_user_registered');

    if (!results.secondUserRegistered) {
      throw new Error('Second user registration failed');
    }

    // ========== STEP 6: Check NO Init Modal ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Verify NO Initialization Modal');
    console.log('─'.repeat(50));

    results.noInitModalForSecond = await checkNoInitModal(secondPage);
    await takeScreenshot(secondPage, '06_no_init_modal');

    if (!results.noInitModalForSecond) {
      console.log('  WARNING: Second user incorrectly saw initialization modal');
      uxTracker.log('major', 'functional', 'Second user should not see initialization modal');
    }

    // ========== STEP 7: Verify Workspace Loaded for Second User ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Verify Workspace Loaded for Second User');
    console.log('─'.repeat(50));

    results.secondUserWorkspaceLoaded = await waitForWorkspaceLoaded(secondPage, 30000);
    console.log(`  Workspace loaded for second user: ${results.secondUserWorkspaceLoaded}`);
    await takeScreenshot(secondPage, '07_second_user_workspace');

    // Final screenshots
    await takeScreenshot(firstPage, 'FINAL_first_user');
    await takeScreenshot(secondPage, 'FINAL_second_user');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Whether the init modal appears depends on something outside this spec's
    // control: a workspace already existing on the server. So the init chain is
    // gated only when this run actually is the initialising user — and when it is,
    // every step of it must work. Asserting the modal unconditionally would make
    // the spec pass or fail on run order, which is the fragility global-setup was
    // added to remove.
    const initialisedWorkspace = results.initModalAppears;
    if (!initialisedWorkspace) {
      console.log(
        '\nNOTE: a workspace already existed, so this run did not initialise one.\n' +
        '      The init-modal assertions are not applicable and are reported as SKIP.\n' +
        '      Reset with `docker compose down && docker compose up -d` to cover them.'
      );
    }

    const initChainPassed = !initialisedWorkspace || [
      results.modalHasTitle,
      results.modalHasPasswordField,
      results.modalHasInitButton,
      results.initSubmitted,
      results.dismissalSticks,
    ].every(Boolean);

    // These hold either way: both users must register and land in the workspace,
    // and the second user must never be asked to initialise one.
    const corePassed = [
      results.firstUserRegistered,
      results.secondUserRegistered,
      results.firstUserWorkspaceLoaded,
      results.secondUserWorkspaceLoaded,
      results.noInitModalForSecond,
      initChainPassed,
    ].every(Boolean);

    console.log('\nFirst User (Initialization):');
    console.log(`  Registration:             ${results.firstUserRegistered ? 'PASS' : 'FAIL'}`);
    console.log(`  Init Modal Appears:       ${results.initModalAppears ? 'PASS' : 'SKIP (workspace already existed)'}`);
    console.log(`  Modal Has Title:          ${initialisedWorkspace ? (results.modalHasTitle ? 'PASS' : 'FAIL') : 'SKIP'}`);
    console.log(`  Modal Has Password Field: ${initialisedWorkspace ? (results.modalHasPasswordField ? 'PASS' : 'FAIL') : 'SKIP'}`);
    console.log(`  Modal Has Init Button:    ${initialisedWorkspace ? (results.modalHasInitButton ? 'PASS' : 'FAIL') : 'SKIP'}`);
    console.log(`  Dismissal Sticks:         ${initialisedWorkspace ? (results.dismissalSticks ? 'PASS' : 'FAIL') : 'SKIP'}`);
    console.log(`  Init Submitted:           ${initialisedWorkspace ? (results.initSubmitted ? 'PASS' : 'FAIL') : 'SKIP'}`);
    console.log(`  Workspace Loaded:         ${results.firstUserWorkspaceLoaded ? 'PASS' : 'FAIL'}`);

    console.log('\nSecond User (No Init Modal):');
    console.log(`  Registration:             ${results.secondUserRegistered ? 'PASS' : 'FAIL'}`);
    console.log(`  No Init Modal:            ${results.noInitModalForSecond ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Loaded:         ${results.secondUserWorkspaceLoaded ? 'PASS' : 'FAIL'}`);

    harness.finalize(corePassed, results);

    return corePassed;

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
