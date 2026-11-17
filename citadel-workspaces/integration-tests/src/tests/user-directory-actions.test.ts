/**
 * User Directory Actions Integration Test (P5)
 *
 * Tests User Directory page interactive elements:
 * 1. Search input filtering
 * 2. "Send Connection Request" button + dialog
 * 3. Role badges
 * 4. "Message" button (after P2P connected)
 * 5. "Remove Connection" button
 */

import { Page } from 'playwright';
import {
  navigateToDirectory,
  sleep,
  createBrowser,
  createIsolatedContexts,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: { user1: boolean; user2: boolean };
  directoryNavigated: boolean;

  // Search
  searchInputVisible: boolean;
  searchFilterWorks: boolean;

  // Connection request
  sendRequestButtonVisible: boolean;
  requestDialogOpens: boolean;

  // Role badges
  roleBadgeVisible: boolean;

  // Message button (after P2P)
  messageButtonVisible: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `dir_alice_${timestamp}`;
const USER2 = `dir_bob_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================


async function testSearchInput(page: Page, searchTerm: string): Promise<{
  visible: boolean;
  filterWorks: boolean;
}> {
  console.log('\n=== Testing Search Input ===');

  const results = { visible: false, filterWorks: false };

  const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"], input[type="search"]').first();
  results.visible = await isVisibleWithin(searchInput, 5000);
  console.log(`  Search input visible: ${results.visible}`);

  if (results.visible) {
    // What "search works" actually means: type a user's name, and that user comes
    // back in the results list. The previous check counted elements matching
    // `[class*="hover:bg"]` before and after typing and passed if the count did
    // not go UP — but typing opens a results panel, which adds elements, so it
    // was testing an unrelated number and getting it backwards.
    await searchInput.fill(searchTerm);

    const resultsList = page.getByRole('listbox', { name: 'User search results' });
    const match = resultsList.getByText(searchTerm, { exact: false });

    // The input debounces 300ms before searching; waiting on the matching entry
    // covers that without guessing at a duration.
    results.filterWorks = await isVisibleWithin(match, 10_000);
    console.log(`  Search returned ${searchTerm}: ${results.filterWorks}`);

    // Escape leaves the panel closed for whatever runs next.
    await searchInput.fill('');
    await page.keyboard.press('Escape');
  }

  return results;
}

async function testConnectionRequestButton(page: Page): Promise<{
  buttonVisible: boolean;
  dialogOpens: boolean;
}> {
  console.log('\n=== Testing Connection Request Button ===');

  const results = { buttonVisible: false, dialogOpens: false };

  // Look for "Send Connection Request" or UserPlus icon button
  const requestBtn = page.locator('button:has-text("Send Connection Request"), button:has(svg.lucide-user-plus)').first();
  results.buttonVisible = await isVisibleWithin(requestBtn, 5000);
  console.log(`  Request button visible: ${results.buttonVisible}`);

  if (results.buttonVisible) {
    await requestBtn.click();
    await sleep(1000);

    // Check if dialog opened with textarea
    const dialog = page.locator('[role="dialog"], [role="alertdialog"]').first();
    const textarea = page.locator('#request-message, textarea').first();

    results.dialogOpens = (await isVisibleWithin(dialog, 3000)) ||
                          (await isVisibleWithin(textarea, 2000));
    console.log(`  Dialog opens: ${results.dialogOpens}`);

    // Close dialog
    await page.keyboard.press('Escape');
    await sleep(300);
  }

  return results;
}

async function checkRoleBadges(page: Page): Promise<boolean> {
  console.log('\n=== Checking Role Badges ===');

  // Look for role text (Admin, Member, Owner, Guest)
  const roleBadge = page.getByText(/Admin|Member|Owner|Guest/).first();
  const visible = await isVisibleWithin(roleBadge, 5000);
  console.log(`  Role badge visible: ${visible}`);

  if (!visible) {
    // Alternative: badge-like elements
    const badge = page.locator('[class*="badge"], [class*="Badge"], span.text-xs').first();
    return await isVisibleWithin(badge, 3000);
  }

  return visible;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'User Directory Actions Test',
    reportFileName: 'USER_DIRECTORY_ACTIONS_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser } = await createBrowser();
  const [context1, context2] = await createIsolatedContexts(browser, 2);

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    directoryNavigated: false,
    searchInputVisible: false,
    searchFilterWorks: false,
    sendRequestButtonVisible: false,
    requestDialogOpens: false,
    roleBadgeVisible: false,
    messageButtonVisible: false,
  };

  try {
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    setupConsoleCapture(page1, 'Alice', ['error', 'Error', 'ILM']);
    setupConsoleCapture(page2, 'Bob', ['error', 'Error', 'ILM']);

    // ========== STEP 1: Create Accounts ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 1: Create Accounts');
    console.log('\u2500'.repeat(50));

    results.accountCreation.user1 = await createAccount(page1, USER1, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });
    results.accountCreation.user2 = await createAccount(page2, USER2, {
      isFirstUser: false,
      password: PASSWORD,
      uxTracker,
    });

    if (!results.accountCreation.user1) throw new Error('User1 creation failed');

    await sleep(3000);
    await closeAnyModals(page1);
    await waitForWorkspaceLoaded(page1, 30000);

    // ========== STEP 2: Navigate to Directory ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 2: Navigate to Directory');
    console.log('\u2500'.repeat(50));

    results.directoryNavigated = await navigateToDirectory(page1);
    await takeScreenshot(page1, '02_directory');

    // ========== STEP 3: Test Search ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 3: Test Search Input');
    console.log('\u2500'.repeat(50));

    if (results.directoryNavigated) {
      const searchResult = await testSearchInput(page1, USER2);
      results.searchInputVisible = searchResult.visible;
      results.searchFilterWorks = searchResult.filterWorks;
      await takeScreenshot(page1, '03_search');
    }

    // ========== STEP 4: Test Connection Request ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 4: Test Connection Request');
    console.log('\u2500'.repeat(50));

    if (results.directoryNavigated) {
      const requestResult = await testConnectionRequestButton(page1);
      results.sendRequestButtonVisible = requestResult.buttonVisible;
      results.requestDialogOpens = requestResult.dialogOpens;
      await takeScreenshot(page1, '04_request');
    }

    // ========== STEP 5: Check Role Badges ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 5: Check Role Badges');
    console.log('\u2500'.repeat(50));

    if (results.directoryNavigated) {
      results.roleBadgeVisible = await checkRoleBadges(page1);
      await takeScreenshot(page1, '05_roles');
    }

    // ========== STEP 6: Check Message Button ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 6: Check Message Button');
    console.log('\u2500'.repeat(50));

    const messageBtn = page1.locator('button:has-text("Message"), button:has(svg.lucide-message-circle)').first();
    results.messageButtonVisible = await isVisibleWithin(messageBtn, 3000);
    console.log(`  Message button visible: ${results.messageButtonVisible}`);
    await takeScreenshot(page1, '06_message_btn');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // All nine, not just the first account. Everything downstream of
    // directoryNavigated was failing silently because that one step used the
    // route `?section=directory`, which does not exist.
    const corePassed = [
      results.accountCreation.user1,
      results.accountCreation.user2,
      results.directoryNavigated,
      results.searchInputVisible,
      results.searchFilterWorks,
      results.sendRequestButtonVisible,
      results.requestDialogOpens,
      results.roleBadgeVisible,
      results.messageButtonVisible,
    ].every(Boolean);

    console.log(`\n  User1 Created:             ${results.accountCreation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User2 Created:             ${results.accountCreation.user2 ? 'PASS' : 'CHECK'}`);
    console.log(`  Directory Navigated:       ${results.directoryNavigated ? 'PASS' : 'CHECK'}`);
    console.log(`  Search Input Visible:      ${results.searchInputVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Search Filter Works:       ${results.searchFilterWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Request Button:            ${results.sendRequestButtonVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Request Dialog:            ${results.requestDialogOpens ? 'PASS' : 'CHECK'}`);
    console.log(`  Role Badge:                ${results.roleBadgeVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Message Button:            ${results.messageButtonVisible ? 'PASS' : 'CHECK'}`);

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
