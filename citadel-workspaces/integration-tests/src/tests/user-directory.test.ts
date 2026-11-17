/**
 * User Directory Integration Test
 *
 * Tests the User Directory page functionality:
 * 1. Navigate to /directory page
 * 2. Verify page structure (title, search, tabs, member list)
 * 3. Verify workspace members appear in directory
 * 4. Test tab switching (All, Online)
 * 5. Test user selection and profile panel
 * 6. Test connection request dialog
 */

import { Page } from 'playwright';
import {
  navigateToDirectory,
  activateTab,
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
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
  // Account creation
  aliceCreated: boolean;
  bobCreated: boolean;

  // Navigation
  navigatedToDirectory: boolean;

  // Page structure
  pageTitleVisible: boolean;
  searchCardVisible: boolean;
  directoryCardVisible: boolean;
  tabsVisible: boolean;

  // Tab functionality
  allTabWorks: boolean;
  onlineTabWorks: boolean;

  // User list
  memberListVisible: boolean;
  bobAppearsInList: boolean;

  // User selection
  profilePanelVisible: boolean;
  selectedUserInfo: boolean;

  // Connection request
  requestButtonVisible: boolean;
  requestDialogOpens: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ALICE = `dir_alice_${timestamp}`;
const BOB = `dir_bob_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Navigate to the User Directory page using client-side navigation
 */

/**
 * Verify page structure elements
 */
async function verifyPageStructure(page: Page): Promise<{
  title: boolean;
  searchCard: boolean;
  directoryCard: boolean;
  tabs: boolean;
}> {
  console.log('\n=== Verifying Page Structure ===');

  const results = {
    title: false,
    searchCard: false,
    directoryCard: false,
    tabs: false,
  };

  // Check page title
  const title = page.locator('h1:has-text("User Directory")');
  results.title = await isVisibleWithin(title, 3000);
  console.log(`  Page title visible: ${results.title}`);

  // Check search card ("Find People")
  const searchCard = page.locator('text="Find People"');
  results.searchCard = await isVisibleWithin(searchCard, 3000);
  console.log(`  Search card visible: ${results.searchCard}`);

  // Check directory card ("Workspace Directory")
  const directoryCard = page.locator('text="Workspace Directory"');
  results.directoryCard = await isVisibleWithin(directoryCard, 3000);
  console.log(`  Directory card visible: ${results.directoryCard}`);

  // Check tabs
  // Two tabs, not three: the directory has no Favorites tab and never has.

  const tabsVisible = await Promise.all(
    ['All', 'Online'].map((label) => isVisibleWithin(directoryTab(page, label), 5000))
  );
  results.tabs = tabsVisible.every(Boolean);
  console.log(`  Tabs visible: ${results.tabs} (All: ${tabsVisible[0]}, Online: ${tabsVisible[1]})`);

  return results;
}

/** A directory tab, by its visible label. */
function directoryTab(page: Page, label: string) {
  return page.locator(`button[role="tab"]:has-text("${label}")`);
}

/**
 * Test tab switching functionality
 */
async function testTabSwitching(page: Page): Promise<{
  allTab: boolean;
  onlineTab: boolean;
}> {
  console.log('\n=== Testing Tab Switching ===');

  const results = {
    allTab: false,
    onlineTab: false,
  };

  // The search step before this leaves UserSearch's results panel open. It is
  // absolutely positioned at z-50 directly over the tabs, so Playwright's
  // hit-target check refuses to click through it. Escape is how a user dismisses
  // it, so that is what this does — and it only works because UserSearch now
  // handles Escape at all.
  await page.keyboard.press('Escape');

  results.allTab = (await activateTab(page, directoryTab(page, 'All'),
    'All tab', page.locator('[role="tabpanel"]').first())).works;

  results.onlineTab = (await activateTab(page, directoryTab(page, 'Online'),
    'Online tab', page.locator('[role="tabpanel"]').first())).works;


  // Leave All selected for the steps that follow.
  await activateTab(page, directoryTab(page, 'All'), 'All tab (restore)',
    page.locator('[role="tabpanel"]').first());

  return results;
}

/**
 * Check if a user appears in the member list
 */
async function checkUserInList(page: Page, displayName: string): Promise<boolean> {
  console.log(`\n=== Checking if ${displayName} appears in member list ===`);

  // Look for the user's name in the directory list
  const userEntry = page.locator(`text="${displayName}"`).first();
  const visible = await isVisibleWithin(userEntry, 5000);
  console.log(`  ${displayName} in list: ${visible}`);
  return visible;
}

/**
 * Click on a user in the list and verify profile panel opens
 */
async function selectUserAndVerifyPanel(page: Page, displayName: string): Promise<{
  panelVisible: boolean;
  userInfoCorrect: boolean;
}> {
  console.log(`\n=== Selecting ${displayName} and verifying profile panel ===`);

  const results = {
    panelVisible: false,
    userInfoCorrect: false,
  };

  // The row by its accessible name. The previous selector,
  // `div:has(h3:has-text(name))`, matched every ancestor div containing that
  // heading, and `.first()` took the OUTERMOST — the grid wrapper — so the click
  // landed on a container and never reached the row.
  const userRow = page.getByRole('button', { name: `View profile for ${displayName}` });

  if (await isVisibleWithin(userRow, 5000)) {
    await userRow.click();
    await sleep(1000);

    // Check if profile panel shows the selected user's name
    // The profile panel is on the right side and shows the user's name in a CardTitle
    const profilePanel = page.locator('div.lg\\:col-span-1');
    if (await isVisibleWithin(profilePanel, 5000)) {
      results.panelVisible = true;
      console.log('  Profile panel visible: true');

      // Check if the user's name appears in the profile panel
      const panelTitle = profilePanel.locator(`text="${displayName}"`);
      results.userInfoCorrect = await isVisibleWithin(panelTitle, 5000);
      console.log(`  User info correct: ${results.userInfoCorrect}`);
    }
  } else {
    console.log(`  Could not find ${displayName} in list to click`);
  }

  return results;
}

/**
 * Test the connection request flow
 */
async function testConnectionRequestFlow(page: Page): Promise<{
  buttonVisible: boolean;
  dialogOpens: boolean;
}> {
  console.log('\n=== Testing Connection Request Flow ===');

  const results = {
    buttonVisible: false,
    dialogOpens: false,
  };

  // Look for "Send Connection Request" button in the profile panel
  // For unconnected users, this should be visible in the CardFooter
  const requestButton = page.locator('button:has-text("Send Connection Request")');
  results.buttonVisible = await isVisibleWithin(requestButton, 5000);
  console.log(`  Request button visible: ${results.buttonVisible}`);

  if (results.buttonVisible) {
    // Click the button to open the dialog
    await requestButton.click();
    await sleep(1000);

    // Check if dialog opened
    // Scoped to the dialog. Unscoped, this text also matches the button that was
    // just clicked, so `.last()` was relying on portal ordering to tell the two
    // apart — and reported on whichever the DOM happened to put second.
    const dialogTitle = page.locator('[role="dialog"]').getByText('Send Connection Request');
    results.dialogOpens = await isVisibleWithin(dialogTitle, 5000);
    console.log(`  Dialog opens: ${results.dialogOpens}`);

    // Close the dialog
    const cancelButton = page.locator('button:has-text("Cancel")');
    if (await isVisibleWithin(cancelButton, 2000)) {
      await cancelButton.click();
      await sleep(500);
    }
  } else {
    // Alternative: try the UserPlus icon button in the member list
    const inviteButton = page.locator('button svg.lucide-user-plus').first();
    if (await isVisibleWithin(inviteButton, 2000)) {
      await inviteButton.click();
      await sleep(1000);

      const dialogTitle = page.locator('[role="dialog"]').getByText('Send Connection Request');
      results.dialogOpens = await isVisibleWithin(dialogTitle, 5000);
      results.buttonVisible = true;
      console.log(`  (via inline button) Dialog opens: ${results.dialogOpens}`);

      // Close the dialog
      const cancelButton = page.locator('button:has-text("Cancel")');
      if (await isVisibleWithin(cancelButton, 2000)) {
        await cancelButton.click();
        await sleep(500);
      }
    }
  }

  return results;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'User Directory Test',
    reportFileName: 'USER_DIRECTORY_TEST_REPORT.json',
    metadata: { alice: ALICE, bob: BOB },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Alice: ${ALICE}`);
  console.log(`Bob: ${BOB}`);
  console.log('');

  // Setup browser
  const { browser, context } = await createBrowser();

  const results: TestResults = {
    aliceCreated: false,
    bobCreated: false,
    navigatedToDirectory: false,
    pageTitleVisible: false,
    searchCardVisible: false,
    directoryCardVisible: false,
    tabsVisible: false,
    allTabWorks: false,
    onlineTabWorks: false,
    memberListVisible: false,
    bobAppearsInList: false,
    profilePanelVisible: false,
    selectedUserInfo: false,
    requestButtonVisible: false,
    requestDialogOpens: false,
  };

  try {
    // ========== STEP 1: Create Alice (first user) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Alice (First User)');
    console.log('─'.repeat(50));

    const alicePage = await context.newPage();
    setupConsoleCapture(alicePage, 'Alice', ['error', 'Error', 'Directory', 'Member', 'ILM']);

    results.aliceCreated = await createAccount(alicePage, ALICE, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    await takeScreenshot(alicePage, '01_alice_created');

    if (!results.aliceCreated) {
      throw new Error('Alice account creation failed');
    }

    await sleep(3000);

    // ========== STEP 2: Create Bob (second user) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Create Bob (Second User)');
    console.log('─'.repeat(50));

    const bobPage = await context.newPage();
    setupConsoleCapture(bobPage, 'Bob', ['error', 'Error', 'Directory', 'Member', 'ILM']);

    results.bobCreated = await createAccount(bobPage, BOB, {
      isFirstUser: false,
      password: PASSWORD,
      uxTracker,
    });

    await takeScreenshot(bobPage, '02_bob_created');

    if (!results.bobCreated) {
      throw new Error('Bob account creation failed');
    }

    await sleep(3000);

    // ========== STEP 3: Navigate Alice to User Directory ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Navigate to User Directory');
    console.log('─'.repeat(50));

    // Close any modals first
    await closeAnyModals(alicePage);

    results.navigatedToDirectory = await navigateToDirectory(alicePage);
    await takeScreenshot(alicePage, '03_directory_page');

    if (!results.navigatedToDirectory) {
      console.log('  WARNING: Could not navigate to directory - page may not be implemented');
      uxTracker.log('major', 'functional', 'User Directory page not accessible');
    }

    // ========== STEP 4: Verify Page Structure ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Verify Page Structure');
    console.log('─'.repeat(50));

    if (results.navigatedToDirectory) {
      const structure = await verifyPageStructure(alicePage);
      results.pageTitleVisible = structure.title;
      results.searchCardVisible = structure.searchCard;
      results.directoryCardVisible = structure.directoryCard;
      results.tabsVisible = structure.tabs;

      await takeScreenshot(alicePage, '04_page_structure');
    }

    // ========== STEP 5: Test Tab Switching ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Test Tab Switching');
    console.log('─'.repeat(50));

    if (results.tabsVisible) {
      const tabResults = await testTabSwitching(alicePage);
      results.allTabWorks = tabResults.allTab;
      results.onlineTabWorks = tabResults.onlineTab;

      await takeScreenshot(alicePage, '05_tabs_tested');
    }

    // ========== STEP 6: Check Member List ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Check Member List');
    console.log('─'.repeat(50));

    if (results.navigatedToDirectory) {
      // Check if the member list container exists
      // By test id, not by styling class. This looked for
      // `div.divide-y.divide-gray-700` until the palette migration replaced
      // that class with `divide-border` — the list was rendering fine and had
      // been the whole time, but the selector matched nothing, so the spec
      // failed in CI on a change that had nothing to do with the directory.
      const memberList = alicePage.locator('[data-testid="directory-member-list"]');
      results.memberListVisible = await isVisibleWithin(memberList, 5000);
      console.log(`  Member list visible: ${results.memberListVisible}`);

      // Check if Bob appears in the list
      // Note: Members are populated from workspace state, so Bob should appear
      // after joining the workspace
      results.bobAppearsInList = await checkUserInList(alicePage, BOB);

      if (!results.bobAppearsInList) {
        // Bob might not be visible yet - workspace state might not have synced
        uxTracker.log('suggestion', 'functional', 'New users may not immediately appear in directory');

        // Try reloading the page
        await alicePage.reload({ waitUntil: 'commit', timeout: 30000 });
        await sleep(3000);
        results.bobAppearsInList = await checkUserInList(alicePage, BOB);
      }

      await takeScreenshot(alicePage, '06_member_list');
    }

    // ========== STEP 7: Test User Selection ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Test User Selection');
    console.log('─'.repeat(50));

    if (results.bobAppearsInList) {
      const selectionResults = await selectUserAndVerifyPanel(alicePage, BOB);
      results.profilePanelVisible = selectionResults.panelVisible;
      results.selectedUserInfo = selectionResults.userInfoCorrect;

      await takeScreenshot(alicePage, '07_user_selected');
    } else if (results.memberListVisible) {
      // Try selecting any user that appears in the list
      console.log('  Bob not in list, trying to select first available user...');
      const firstUser = alicePage.locator('div.divide-y.divide-gray-700 > div').first();
      if (await isVisibleWithin(firstUser, 3000)) {
        await firstUser.click();
        await sleep(1000);

        // Check if profile panel appeared
        const profileCard = alicePage.locator('div.lg\\:col-span-1 h3, div.lg\\:col-span-1 [class*="CardTitle"]').first();
        results.profilePanelVisible = await isVisibleWithin(profileCard, 3000);
        results.selectedUserInfo = results.profilePanelVisible;
        console.log(`  Profile panel visible (any user): ${results.profilePanelVisible}`);

        await takeScreenshot(alicePage, '07_any_user_selected');
      }
    }

    // ========== STEP 8: Test Connection Request Flow ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: Test Connection Request Flow');
    console.log('─'.repeat(50));

    if (results.profilePanelVisible || results.memberListVisible) {
      const requestResults = await testConnectionRequestFlow(alicePage);
      results.requestButtonVisible = requestResults.buttonVisible;
      results.requestDialogOpens = requestResults.dialogOpens;

      await takeScreenshot(alicePage, '08_connection_request');
    }

    // Final screenshots
    await takeScreenshot(alicePage, 'FINAL_alice_directory');
    await takeScreenshot(bobPage, 'FINAL_bob_workspace');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Core functionality that must pass
    // Every assertion this spec reports, gated. It previously printed 15 results
    // and let 5 of them fail silently.
    const corePassed = [
      results.aliceCreated,
      results.bobCreated,
      results.navigatedToDirectory,
      results.pageTitleVisible,
      results.searchCardVisible,
      results.directoryCardVisible,
      results.tabsVisible,
      results.allTabWorks,
      results.onlineTabWorks,
      results.memberListVisible,
      results.bobAppearsInList,
      results.profilePanelVisible,
      results.selectedUserInfo,
      results.requestButtonVisible,
      results.requestDialogOpens,
    ].every(Boolean);

    console.log('\nAccount Creation:');
    console.log(`  Alice Created:          ${results.aliceCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Created:            ${results.bobCreated ? 'PASS' : 'FAIL'}`);

    console.log('\nNavigation:');
    console.log(`  Navigated to Directory: ${results.navigatedToDirectory ? 'PASS' : 'FAIL'}`);

    console.log('\nPage Structure:');
    console.log(`  Page Title Visible:     ${results.pageTitleVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Search Card Visible:    ${results.searchCardVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Directory Card Visible: ${results.directoryCardVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Tabs Visible:           ${results.tabsVisible ? 'PASS' : 'CHECK'}`);

    console.log('\nTab Functionality:');
    console.log(`  All Tab Works:          ${results.allTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Online Tab Works:       ${results.onlineTabWorks ? 'PASS' : 'CHECK'}`);

    console.log('\nMember List:');
    // FAIL, not CHECK. This one is in corePassed above, so when it is false the
    // run fails — and printing the word used for ungated, informational results
    // meant the summary showed fourteen PASSes and a CHECK next to a verdict of
    // FAILED, with nothing to say which assertion caused it.
    console.log(`  Member List Visible:    ${results.memberListVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Appears in List:    ${results.bobAppearsInList ? 'PASS' : 'CHECK'}`);

    console.log('\nUser Selection:');
    console.log(`  Profile Panel Visible:  ${results.profilePanelVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Selected User Info:     ${results.selectedUserInfo ? 'PASS' : 'CHECK'}`);

    console.log('\nConnection Request:');
    console.log(`  Request Button Visible: ${results.requestButtonVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Request Dialog Opens:   ${results.requestDialogOpens ? 'PASS' : 'CHECK'}`);

    harness.finalize(corePassed, results);

    return corePassed; // Pass if core functionality works

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
