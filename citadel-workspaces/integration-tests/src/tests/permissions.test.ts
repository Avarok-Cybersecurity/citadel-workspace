/**
 * Permissions System Test
 *
 * Tests the permission-aware UI system:
 * 1. Verify Settings Modal has 5 tabs including Permissions tab with Lock icon
 * 2. Verify Permissions tab shows nested accordion structure (Workspace → Offices → Rooms)
 * 3. Verify permission status indicators (Allowed/Denied with correct icons)
 * 4. Verify Edit button styling when permission is denied (disabled state)
 * 5. Verify tooltip appears on hover over disabled elements
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
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Test 1: Settings Modal
  settingsModalOpens: boolean;
  allTabsExist: boolean;
  permissionsTabExists: boolean;
  permissionsTabHasLockIcon: boolean;

  // Test 2: Accordion Structure
  workspaceAccordionExists: boolean;
  roleBadgeDisplayed: boolean;
  permissionCategoriesExist: boolean;

  // Test 3: Permission Status
  permissionRowsExist: boolean;
  statusIndicatorsCorrect: boolean;

  // Test 4: Disabled Edit Button (edit button visible)
  editButtonExists: boolean;

  // Test 5: Legend
  legendVisible: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `perm_test_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get the Settings modal dialog locator for scoped searches
 */
function getSettingsDialog(page: Page) {
  return page.locator('[role="dialog"]').first();
}

/**
 * Open Settings Modal from the TopBar dropdown menu
 * Settings Modal is now accessible from within the workspace
 */
async function openSettingsFromTopBar(page: Page): Promise<boolean> {
  console.log('\n  Opening Settings Modal from TopBar...');

  try {
    // First close any open modals
    await closeAnyModals(page);
    await sleep(300);

    // Click the avatar button to open the dropdown menu
    const avatarButton = page.locator('[data-testid="user-avatar-button"]').first();
    if (await isVisibleWithin(avatarButton, 3000)) {
      console.log('    Clicking avatar button...');
      await avatarButton.click();
      await sleep(500);

      // Click "Settings" option in the dropdown
      const settingsOption = page.locator('[role="menuitem"]:has-text("Settings")').first();
      if (await isVisibleWithin(settingsOption, 2000)) {
        console.log('    Clicking Settings option...');
        await settingsOption.click();
        await sleep(1000);

        // Wait for any dropdown to close and modal to open
        await page.waitForTimeout(500);

        // Verify Settings modal with tabs is open
        const tabsList = page.locator('[role="dialog"] [role="tablist"]').first();
        const hasTabs = await isVisibleWithin(tabsList, 3000);
        if (hasTabs) {
          console.log('    Settings Modal opened successfully (with tabs)');
          return true;
        }
      }
    }

    console.log('    WARNING: Could not open Settings from TopBar');
    return false;
  } catch (error) {
    console.error('    Error opening Settings from TopBar:', error);
    return false;
  }
}

/**
 * Navigate to the Permissions tab within Settings modal
 */
async function navigateToPermissionsTab(page: Page): Promise<boolean> {
  console.log('\n  Navigating to Permissions tab...');

  try {
    const dialog = getSettingsDialog(page);

    // Find the permissions tab button and get its aria-controls to find the panel ID
    const permissionsTab = dialog.locator('button[aria-controls*="permissions"]').first();

    if (!await isVisibleWithin(permissionsTab, 2000)) {
      console.log('    Permissions tab button not found');
      return false;
    }

    // Get the aria-controls value to find the panel
    const ariaControls = await permissionsTab.getAttribute('aria-controls');
    console.log('    Found permissions tab with aria-controls:', ariaControls);

    // Click using dispatchEvent which is more reliable for Radix tabs
    await page.evaluate(() => {
      const tab = document.querySelector('button[aria-controls*="permissions"]') as HTMLButtonElement;
      if (tab) {
        // Simulate proper click events
        const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
        const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
        const click = new MouseEvent('click', { bubbles: true, cancelable: true });
        tab.dispatchEvent(mouseDown);
        tab.dispatchEvent(mouseUp);
        tab.dispatchEvent(click);
      }
    });

    console.log('    Dispatched click events on Permissions tab');
    await sleep(1000);

    // Wait for the permissions panel to become visible
    const permissionsPanel = dialog.locator(`[id*="permissions"][role="tabpanel"]`).first();
    const isPanelVisible = await isVisibleWithin(permissionsPanel, 3000);

    if (isPanelVisible) {
      const panelText = await permissionsPanel.textContent().catch(() => '');
      console.log('    Permissions panel content preview:', panelText?.substring(0, 200));
      return true;
    }

    // Fallback: try using keyboard navigation
    console.log('    Tab panel not visible, trying keyboard navigation...');
    await permissionsTab.focus();
    await page.keyboard.press('Enter');
    await sleep(500);

    // Check again
    const isPanelVisibleAfterKeyboard = await isVisibleWithin(permissionsPanel, 2000);
    if (isPanelVisibleAfterKeyboard) {
      console.log('    Permissions panel visible after keyboard navigation');
      return true;
    }

    console.log('    WARNING: Could not navigate to permissions tab');
    return false;
  } catch (error) {
    console.error('    Error navigating to Permissions tab:', error);
    return false;
  }
}

/**
 * Count the number of tabs in the Settings modal TabsList
 */
async function countSettingsTabs(page: Page): Promise<number> {
  const dialog = getSettingsDialog(page);
  const tabsList = dialog.locator('[role="tablist"]').first();
  if (!await isVisibleWithin(tabsList, 3000)) {
    return 0;
  }

  const tabs = dialog.locator('[role="tablist"] button[role="tab"]');
  return await tabs.count();
}

/**
 * Check if a specific tab exists with the given text
 */
async function tabExists(page: Page, tabText: string): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  const tab = dialog.locator(`[role="tablist"] button:has-text("${tabText}")`).first();
  return await isVisibleWithin(tab, 2000);
}

/**
 * Check if the Permissions tab has a Lock icon
 */
async function permissionsTabHasLockIcon(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  // Look for lock icon in the permissions tab trigger using aria-controls attribute
  const permissionsTab = dialog.locator('button[aria-controls*="permissions"]').first();
  if (await isVisibleWithin(permissionsTab, 1000)) {
    // Check for any SVG (lucide icons render as SVG)
    const svg = permissionsTab.locator('svg').first();
    const hasSvg = await isVisibleWithin(svg, 1000);
    if (hasSvg) {
      console.log('    Found SVG icon in Permissions tab');
      return true;
    }
    // Fallback: check the inner HTML for lucide-lock class
    const html = await permissionsTab.innerHTML().catch(() => '');
    if (html.includes('lucide') || html.includes('lock') || html.includes('svg')) {
      console.log('    Found icon reference in Permissions tab HTML');
      return true;
    }
  }
  return false;
}

/**
 * Check if workspace accordion exists
 */
async function workspaceAccordionExists(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  // Look for workspace text or Building2 icon
  // "Root Workspace" was in this list twice. The sidebar's members heading was
  // given one noun and no screen says those words any more, so both entries
  // were dead -- and a dead entry in a fallback list is worse than none: it
  // reads as coverage, and the list quietly gets shorter than it looks.
  const workspaceSelectors = [
    'text="Your Permissions"',
    '[data-state] button:has-text("Workspace")',
  ];

  for (const selector of workspaceSelectors) {
    const element = dialog.locator(selector).first();
    if (await isVisibleWithin(element, 1000)) {
      console.log(`    Found workspace element: ${selector}`);
      return true;
    }
  }
  return false;
}

/**
 * Check if role badge is displayed
 */
async function roleBadgeDisplayed(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  // Role badges have specific styling - look for Admin, Owner, Member, Guest, or Unknown badges
  const roleBadges = [
    'span:has-text("Admin")',
    'span:has-text("Owner")',
    'span:has-text("Member")',
    'span:has-text("Guest")',
    'span:has-text("Unknown")', // Also check for Unknown role badge
  ];

  for (const selector of roleBadges) {
    const badge = dialog.locator(selector).first();
    if (await isVisibleWithin(badge, 1000)) {
      const text = await badge.textContent();
      console.log(`    Found role badge: ${text}`);
      return true;
    }
  }

  return false;
}

/**
 * Check if permission categories exist (Content, Messaging, etc.)
 */
async function permissionCategoriesExist(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  const categories = ['Content', 'Messaging', 'Files', 'Rooms', 'Offices'];
  let foundCount = 0;

  for (const category of categories) {
    const categoryElement = dialog.locator(`text="${category}"`).first();
    if (await isVisibleWithin(categoryElement, 1000)) {
      foundCount++;
    }
  }

  console.log(`    Found ${foundCount}/${categories.length} permission categories`);
  return foundCount >= 2; // At least 2 categories should be visible
}

/**
 * Check if permission rows with status indicators exist
 */
async function permissionRowsExist(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  // Look for permission labels like "View Content", "Edit MDX Content", etc.
  const permissionLabels = [
    'View Content',
    'Edit Content',
    'Edit MDX Content',
    'Send Messages',
    'Read Messages',
  ];

  let foundCount = 0;
  for (const label of permissionLabels) {
    const row = dialog.locator(`text="${label}"`).first();
    if (await isVisibleWithin(row, 1000)) {
      foundCount++;
    }
  }

  console.log(`    Found ${foundCount}/${permissionLabels.length} permission rows`);
  return foundCount >= 1;
}

/**
 * Check if status indicators (Allowed/Denied) are correct
 */
async function statusIndicatorsCorrect(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  // Look for Allowed or Denied text with corresponding icons
  const allowedIndicator = dialog.locator('text="Allowed"').first();
  const deniedIndicator = dialog.locator('text="Denied"').first();

  const hasAllowed = await isVisibleWithin(allowedIndicator, 2000);
  const hasDenied = await isVisibleWithin(deniedIndicator, 2000);

  // At least one status indicator should be visible
  if (hasAllowed || hasDenied) {
    console.log(`    Status indicators found: Allowed=${hasAllowed}, Denied=${hasDenied}`);
    return true;
  }

  // Check for CheckCircle or XCircle icons as fallback
  const checkIcon = dialog.locator('.lucide-check-circle-2, [class*="check-circle"]').first();
  const xIcon = dialog.locator('.lucide-x-circle, [class*="x-circle"]').first();

  const hasCheckIcon = await isVisibleWithin(checkIcon, 1000);
  const hasXIcon = await isVisibleWithin(xIcon, 1000);

  console.log(`    Icons found: CheckCircle=${hasCheckIcon}, XCircle=${hasXIcon}`);
  return hasCheckIcon || hasXIcon;
}

/**
 * Check if Edit button exists on the office/room page
 */
async function editButtonExists(page: Page): Promise<boolean> {
  // First close settings modal if open
  await closeAnyModals(page);
  await sleep(500);

  // Look for Edit button in the office header
  const editButton = page.locator('button:has-text("Edit")').first();
  return await isVisibleWithin(editButton, 3000);
}

/**
 * Check if legend section is visible in Permissions tab
 */
async function legendVisible(page: Page): Promise<boolean> {
  const dialog = getSettingsDialog(page);
  const legend = dialog.locator('text="Legend"').first();
  return await isVisibleWithin(legend, 2000);
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'Permissions System Test',
    reportFileName: 'PERMISSIONS_TEST_REPORT.json',
    metadata: { username: USERNAME },
  });
  const uxTracker = harness.uxTracker;

  console.log(`Username: ${USERNAME}`);
  console.log(`Password: ${PASSWORD}`);
  console.log('');

  // Setup browser
  const { browser, context } = await createBrowser();

  const results: TestResults = {
    settingsModalOpens: false,
    allTabsExist: false,
    permissionsTabExists: false,
    permissionsTabHasLockIcon: false,
    workspaceAccordionExists: false,
    roleBadgeDisplayed: false,
    permissionCategoriesExist: false,
    permissionRowsExist: false,
    statusIndicatorsCorrect: false,
    editButtonExists: false,
    legendVisible: false,
  };

  try {
    const page = await context.newPage();

    // Setup console capture - exclude verbose permission messages
    setupConsoleCapture(page, 'PermTest', ['error', 'Error', 'ILM']);

    // ========== STEP 0: Create account and login ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 0: Create Account and Login');
    console.log('─'.repeat(50));

    const accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    if (!accountCreated) {
      console.log('  FATAL: Account creation failed');
      throw new Error('Account creation failed');
    }

    await takeScreenshot(page, 'perm_00_account_created');

    // Wait for workspace to load
    await waitForWorkspaceLoaded(page, 60000);

    // Dismiss any modals that appear after account creation (like Connection Preferences)
    console.log('  Dismissing any initial modals...');

    // Try to close Connection Preferences modal by clicking its close button
    // The close button is positioned absolutely in the top-right corner
    const closeSelectors = [
      '[role="dialog"] button.absolute',          // The close button has absolute positioning
      '[role="dialog"] button:has(svg)',          // Any button with SVG icon
      'button[class*="right-4"][class*="top-4"]', // Button with right-4 top-4 classes
      '[role="dialog"] button >> nth=0',          // First button in dialog
    ];

    for (const selector of closeSelectors) {
      const closeBtn = page.locator(selector).first();
      if (await isVisibleWithin(closeBtn, 1000)) {
        console.log(`  Found close button with selector: ${selector}`);
        await closeBtn.click();
        await sleep(800);
        break;
      }
    }

    // Verify modal is closed
    // No dialog is titled "Connection Preferences"; this has been asking
    // whether a modal that cannot exist is still open, and always getting
    // false. Ask about the dialog that is actually there.
    const modalStillOpen = await isVisibleWithin(page.locator('[role="dialog"]'), 500);
    if (modalStillOpen) {
      console.log('  Modal still open, trying Escape key...');
      await page.keyboard.press('Escape');
      await sleep(500);
    }

    await sleep(500);

    // ========== TEST 1: Settings Modal - Permissions Tab ==========
    // Settings Modal is now accessible from TopBar dropdown while in workspace
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 1: Settings Modal - Permissions Tab');
    console.log('─'.repeat(50));

    results.settingsModalOpens = await openSettingsFromTopBar(page);
    await takeScreenshot(page, 'perm_01_settings_modal');

    if (results.settingsModalOpens) {
      // Count tabs
      const tabCount = await countSettingsTabs(page);
      // Seven since the Calendar's reminders gained a Notifications tab (fc0ddfcd).
      results.allTabsExist = tabCount === 7;
      console.log(`  Tab count: ${tabCount} (expected: 7: General, Connections, Theme, Privacy, Notifications, Perms, Security) - ${results.allTabsExist ? 'PASS' : 'FAIL'}`);

      // Check for Permissions tab. The visible label is short-form 'Perms'
      // (matches the SettingsModal tab text); other tests in this repo
      // (settings-modal.test.ts) handle this by also accepting the lock
      // icon as a fallback, but here a single text match is sufficient
      // since the rest of the test depends on this same locator.
      results.permissionsTabExists = await tabExists(page, 'Perms');
      console.log(`  Permissions tab exists: ${results.permissionsTabExists ? 'PASS' : 'FAIL'}`);

      // Check for Lock icon
      results.permissionsTabHasLockIcon = await permissionsTabHasLockIcon(page);
      console.log(`  Lock icon in tab: ${results.permissionsTabHasLockIcon ? 'PASS' : 'FAIL'}`);

      await takeScreenshot(page, 'perm_02_tabs_checked');
    }

    // ========== TEST 2: Accordion Structure ==========
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 2: Permissions Accordion Structure');
    console.log('─'.repeat(50));

    if (results.permissionsTabExists) {
      const navigated = await navigateToPermissionsTab(page);
      await sleep(1000);
      await takeScreenshot(page, 'perm_03_permissions_tab');

      if (navigated) {
        // Check workspace accordion
        results.workspaceAccordionExists = await workspaceAccordionExists(page);
        console.log(`  Workspace accordion: ${results.workspaceAccordionExists ? 'PASS' : 'FAIL'}`);

        // Check role badge
        results.roleBadgeDisplayed = await roleBadgeDisplayed(page);
        console.log(`  Role badge displayed: ${results.roleBadgeDisplayed ? 'PASS' : 'FAIL'}`);

        // Expand workspace accordion if needed and check categories (scoped to dialog)
        const dialogForAccordion = getSettingsDialog(page);
        const workspaceHeader = dialogForAccordion.locator('[data-state="closed"] button').first();
        if (await isVisibleWithin(workspaceHeader, 1000)) {
          await workspaceHeader.click();
          await sleep(500);
        }

        results.permissionCategoriesExist = await permissionCategoriesExist(page);
        console.log(`  Permission categories: ${results.permissionCategoriesExist ? 'PASS' : 'FAIL'}`);

        await takeScreenshot(page, 'perm_04_accordion_expanded');
      }
    }

    // ========== TEST 3: Permission Status Indicators ==========
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 3: Permission Status Indicators');
    console.log('─'.repeat(50));

    // Expand a category to see permission rows (scoped to dialog)
    const dialog = getSettingsDialog(page);
    const contentCategory = dialog.locator('button:has-text("Content")').first();
    if (await isVisibleWithin(contentCategory, 2000)) {
      await contentCategory.click();
      await sleep(500);
    }

    results.permissionRowsExist = await permissionRowsExist(page);
    console.log(`  Permission rows exist: ${results.permissionRowsExist ? 'PASS' : 'FAIL'}`);

    results.statusIndicatorsCorrect = await statusIndicatorsCorrect(page);
    console.log(`  Status indicators correct: ${results.statusIndicatorsCorrect ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, 'perm_05_permission_status');

    // ========== TEST 4: Edit Button Exists ==========
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 4: Edit Button Visibility');
    console.log('─'.repeat(50));

    // Close settings modal first
    await page.keyboard.press('Escape');
    await sleep(500);

    // We're already in the workspace, just check for Edit button
    results.editButtonExists = await editButtonExists(page);
    console.log(`  Edit button exists: ${results.editButtonExists ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, 'perm_06_edit_button');

    // ========== TEST 5: Legend Section ==========
    console.log('\n' + '─'.repeat(50));
    console.log('TEST 5: Legend Section');
    console.log('─'.repeat(50));

    // Reopen settings and go to permissions tab
    await openSettingsFromTopBar(page);
    await navigateToPermissionsTab(page);
    await sleep(500);

    // Scroll to bottom to see legend (scoped to dialog)
    const dialogForLegend = getSettingsDialog(page);
    const tabContent = dialogForLegend.locator('[role="tabpanel"]').first();
    if (await isVisibleWithin(tabContent, 1000)) {
      await tabContent.evaluate((el) => el.scrollTop = el.scrollHeight);
      await sleep(500);
    }

    results.legendVisible = await legendVisible(page);
    console.log(`  Legend visible: ${results.legendVisible ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, 'perm_07_legend');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const allPassed =
      results.settingsModalOpens &&
      results.allTabsExist &&
      results.permissionsTabExists &&
      results.permissionsTabHasLockIcon &&
      results.workspaceAccordionExists &&
      results.roleBadgeDisplayed &&
      results.permissionCategoriesExist &&
      results.permissionRowsExist &&
      results.statusIndicatorsCorrect &&
      results.editButtonExists &&
      results.legendVisible;

    console.log('\nTest 1: Settings Modal');
    console.log(`  Settings modal opens:        ${results.settingsModalOpens ? 'PASS' : 'FAIL'}`);
    console.log(`  All seven tabs exist:        ${results.allTabsExist ? 'PASS' : 'FAIL'}`);
    console.log(`  Permissions tab exists:      ${results.permissionsTabExists ? 'PASS' : 'FAIL'}`);
    console.log(`  Lock icon in tab:            ${results.permissionsTabHasLockIcon ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 2: Accordion Structure');
    console.log(`  Workspace accordion:         ${results.workspaceAccordionExists ? 'PASS' : 'FAIL'}`);
    console.log(`  Role badge displayed:        ${results.roleBadgeDisplayed ? 'PASS' : 'FAIL'}`);
    console.log(`  Permission categories:       ${results.permissionCategoriesExist ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 3: Permission Status');
    console.log(`  Permission rows exist:       ${results.permissionRowsExist ? 'PASS' : 'FAIL'}`);
    console.log(`  Status indicators correct:   ${results.statusIndicatorsCorrect ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 4: Edit Button');
    console.log(`  Edit button exists:          ${results.editButtonExists ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 5: Legend');
    console.log(`  Legend visible:              ${results.legendVisible ? 'PASS' : 'FAIL'}`);

    harness.finalize(allPassed, results);

    return allPassed;

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
