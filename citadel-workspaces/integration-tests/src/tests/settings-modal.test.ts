/**
 * Settings Modal Integration Test
 *
 * Tests the Settings Modal functionality:
 * 1. Open settings via TopBar user dropdown
 * 2. Verify modal structure (title, description, tabs)
 * 3. Test tab navigation (General, Connections, Appearance, Privacy, Permissions)
 * 4. Verify tab content renders
 * 5. Close settings modal
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
  isHiddenWithin,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { activateTab as sharedActivateTab, isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Account creation
  accountCreated: boolean;

  // Opening settings
  userDropdownOpens: boolean;
  settingsMenuItemVisible: boolean;
  modalOpens: boolean;

  // Modal structure
  titleVisible: boolean;
  descriptionVisible: boolean;
  tabsVisible: boolean;

  // Tab functionality
  generalTabWorks: boolean;
  connectionsTabWorks: boolean;
  appearanceTabWorks: boolean;
  privacyTabWorks: boolean;
  permissionsTabWorks: boolean;

  // Tab content
  generalTabHasContent: boolean;
  connectionsTabHasContent: boolean;
  appearanceTabHasContent: boolean;
  privacyTabHasContent: boolean;
  permissionsTabHasContent: boolean;

  // Close functionality
  modalCloses: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `settings_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Open the user dropdown menu in TopBar
 */
async function openUserDropdown(page: Page): Promise<boolean> {
  console.log('\n=== Opening User Dropdown ===');

  try {
    // Find the user avatar button using data-testid (most reliable)
    const avatarButton = page.locator('[data-testid="user-avatar-button"]');

    if (await isVisibleWithin(avatarButton, 5000)) {
      console.log('  Found avatar button via data-testid');
      await avatarButton.click();
      await sleep(500);

      // Check if dropdown opened
      const dropdownContent = page.locator('[role="menu"]');
      const opened = await isVisibleWithin(dropdownContent, 3000);
      console.log(`  Dropdown opened: ${opened}`);
      return opened;
    }

    // Alternative: try finding by button containing Avatar
    const altButton = page.locator('button:has([class*="Avatar"])').first();
    if (await isVisibleWithin(altButton, 3000)) {
      console.log('  Found avatar button via class selector');
      await altButton.click();
      await sleep(500);
      const dropdownContent = page.locator('[role="menu"]');
      const opened = await isVisibleWithin(dropdownContent, 3000);
      console.log(`  Dropdown opened (alt): ${opened}`);
      return opened;
    }

    console.log('  User dropdown trigger not found');
    return false;
  } catch (error) {
    console.error('  Error opening user dropdown:', error);
    return false;
  }
}

/**
 * Click the Settings menu item
 */
async function clickSettingsMenuItem(page: Page): Promise<boolean> {
  console.log('\n=== Clicking Settings Menu Item ===');

  try {
    const settingsItem = page.locator('[role="menuitem"]:has-text("Settings")');
    if (!(await isVisibleWithin(settingsItem, 3000))) {
      console.log('  Settings menu item not found');
      return false;
    }

    await settingsItem.click();
    await sleep(500);

    // Check if settings modal opened
    const modalTitle = page.locator('text="Settings"').first();
    const opened = await isVisibleWithin(modalTitle, 3000);
    console.log(`  Settings modal opened: ${opened}`);
    return opened;
  } catch (error) {
    console.error('  Error clicking settings:', error);
    return false;
  }
}

/**
 * Verify modal structure elements
 */
async function verifyModalStructure(page: Page): Promise<{
  title: boolean;
  description: boolean;
  tabs: boolean;
}> {
  console.log('\n=== Verifying Modal Structure ===');

  const results = {
    title: false,
    description: false,
    tabs: false,
  };

  // Check title
  // getByRole, not '[role="dialog"] text="Settings"' — that mixes a CSS selector
  // with the text engine in one string, which Playwright cannot parse as intended,
  // so the check could never have matched.
  const title = page.getByRole('heading', { name: 'Settings' }).first();
  results.title = await isVisibleWithin(title, 3000);
  console.log(`  Title visible: ${results.title}`);

  // Check description
  const description = page.locator('text="Configure your workspace preferences"');
  results.description = await isVisibleWithin(description, 3000);
  console.log(`  Description visible: ${results.description}`);

  // Check tabs (General, Connections, Appearance, Privacy, Permissions)
  const dialog = page.locator('[role="dialog"]');
  const generalTab = dialog.locator('button[role="tab"]').nth(0);
  const connectionsTab = page.locator('button[role="tab"]:has-text("Connections"), button[role="tab"]:has(svg.lucide-wifi)');
  const appearanceTab = page.locator('button[role="tab"]:has-text("Appearance"), button[role="tab"]:has(svg.lucide-palette)');
  const privacyTab = page.locator('button[role="tab"]:has-text("Privacy"), button[role="tab"]:has(svg.lucide-shield)');
  const permissionsTab = page.locator('button[role="tab"]:has-text("Permissions"), button[role="tab"]:has(svg.lucide-lock)');

  const tabsVisible = await Promise.all([
    isVisibleWithin(generalTab, 3000),
    isVisibleWithin(connectionsTab, 3000),
    isVisibleWithin(appearanceTab, 3000),
    isVisibleWithin(privacyTab, 3000),
    isVisibleWithin(permissionsTab, 3000),
  ]);
  results.tabs = tabsVisible.some(Boolean); // At least some tabs visible (icons might be shown without text on small screens)
  console.log(`  Tabs visible: ${results.tabs} (${tabsVisible.filter(Boolean).length}/5 visible)`);

  return results;
}

/**
 * Test tab switching and content
 */
/**
 * Click a tab and report whether it actually became active.
 *
 * Waits for `data-state="active"` rather than clicking and reading the attribute
 * after a fixed 300ms — Radix sets it asynchronously, so the old version was
 * sampling a race.
 *
 * A tab that is DISABLED is reported as such rather than as a failure. Connections
 * and Permissions carry `disabled={!isConnected}` in SettingsModal, so on a
 * disconnected session they are correctly unavailable; failing the suite for that
 * would be asserting the opposite of the intended behaviour.
 */
async function activateTab(page: Page, index: number, name: string) {
  // Scoped to the dialog: a bare `button[role="tab"]` matches page-wide, and the
  // office view behind the modal renders its own Content/Chat tabs FIRST — so
  // nth(0) and nth(1) were the office's tabs, not Settings'. This test was
  // reporting on the wrong control entirely, and the modal being on top is why
  // clicking one of them did not activate it.
  return sharedActivateTab(
    page,
    page.locator('[role="dialog"] button[role="tab"]').nth(index),
    name,
    page.locator('[role="dialog"] [role="tabpanel"]').first()
  );
}

async function testTabSwitching(page: Page): Promise<{
  general: { works: boolean; hasContent: boolean; disabled: boolean };
  connections: { works: boolean; hasContent: boolean; disabled: boolean };
  appearance: { works: boolean; hasContent: boolean; disabled: boolean };
  privacy: { works: boolean; hasContent: boolean; disabled: boolean };
  permissions: { works: boolean; hasContent: boolean; disabled: boolean };
}> {
  console.log('\n=== Testing Tab Switching ===');
  return {
    general: await activateTab(page, 0, 'General'),
    connections: await activateTab(page, 1, 'Connections'),
    appearance: await activateTab(page, 2, 'Appearance'),
    privacy: await activateTab(page, 3, 'Privacy'),
    permissions: await activateTab(page, 4, 'Permissions'),
  };
}

/**
 * Close the settings modal
 */
async function closeSettingsModal(page: Page): Promise<boolean> {
  console.log('\n=== Closing Settings Modal ===');

  try {
    // Confirm the modal is actually OPEN first. Without this the check below
    // passes just as happily against a modal that was never open, which is the
    // same as not checking.
    const dialog = page.getByRole('dialog').first();
    const wasOpen = await isVisibleWithin(dialog, 5000);
    if (!wasOpen) {
      console.log('  Modal was not open before Escape - nothing to close');
      return false;
    }

    await page.keyboard.press('Escape');

    // Wait for it to GO, rather than sampling once and hoping.
    //
    // This previously read:
    //   page.locator('[role="dialog"] text="Settings"')
    //     .isVisible({ timeout: 1000 }).catch(() => false)
    // and reported PASS unconditionally. Two faults compounded. The selector
    // mixes CSS with the text engine, which does not parse - Playwright throws
    // `Unexpected token "=" while parsing css selector`. The `.catch(() => false)`
    // then swallowed that throw, and the surrounding `!` turned it into
    // "closed: true". Verified against a page holding a plainly visible dialog:
    // it still reported closed. Separately, isVisible's timeout option is
    // declared `@deprecated This option is ignored`, so even a valid selector
    // would have sampled once, 500ms into a close animation.
    const closed = await isHiddenWithin(dialog, 5000);
    console.log(`  Modal closed: ${closed}`);
    return closed;
  } catch (error) {
    console.error('  Error closing modal:', error);
    return false;
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Settings Modal Test',
    reportFileName: 'SETTINGS_MODAL_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Username: ${USERNAME}`);
  console.log('');

  // Setup browser
  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    userDropdownOpens: false,
    settingsMenuItemVisible: false,
    modalOpens: false,
    titleVisible: false,
    descriptionVisible: false,
    tabsVisible: false,
    generalTabWorks: false,
    connectionsTabWorks: false,
    appearanceTabWorks: false,
    privacyTabWorks: false,
    permissionsTabWorks: false,
    generalTabHasContent: false,
    connectionsTabHasContent: false,
    appearanceTabHasContent: false,
    privacyTabHasContent: false,
    permissionsTabHasContent: false,
    modalCloses: false,
  };

  try {
    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('─'.repeat(50));

    const page = await context.newPage();
    setupConsoleCapture(page, 'Settings', ['error', 'Error', 'Settings', 'settings', 'ILM']);

    results.accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    await takeScreenshot(page, '01_account_created');

    if (!results.accountCreated) {
      throw new Error('Account creation failed');
    }

    await sleep(3000);

    // Close any modals and wait for workspace to load
    await closeAnyModals(page);
    await waitForWorkspaceLoaded(page, 30000);

    // ========== STEP 2: Open User Dropdown ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Open User Dropdown');
    console.log('─'.repeat(50));

    results.userDropdownOpens = await openUserDropdown(page);
    await takeScreenshot(page, '02_dropdown_open');

    if (!results.userDropdownOpens) {
      console.log('  WARNING: Could not open user dropdown');
      uxTracker.log('major', 'functional', 'User dropdown does not open');
    }

    // ========== STEP 3: Check Settings Menu Item ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Check Settings Menu Item');
    console.log('─'.repeat(50));

    if (results.userDropdownOpens) {
      const settingsItem = page.locator('[role="menuitem"]:has-text("Settings")');
      results.settingsMenuItemVisible = await isVisibleWithin(settingsItem, 3000);
      console.log(`  Settings menu item visible: ${results.settingsMenuItemVisible}`);
      await takeScreenshot(page, '03_settings_menu_item');
    }

    // ========== STEP 4: Open Settings Modal ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Open Settings Modal');
    console.log('─'.repeat(50));

    if (results.settingsMenuItemVisible) {
      results.modalOpens = await clickSettingsMenuItem(page);
      await takeScreenshot(page, '04_settings_modal_open');
    }

    // ========== STEP 5: Verify Modal Structure ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Verify Modal Structure');
    console.log('─'.repeat(50));

    if (results.modalOpens) {
      const structure = await verifyModalStructure(page);
      results.titleVisible = structure.title;
      results.descriptionVisible = structure.description;
      results.tabsVisible = structure.tabs;

      await takeScreenshot(page, '05_modal_structure');
    }

    // ========== STEP 6: Test Tab Switching ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Test Tab Switching');
    console.log('─'.repeat(50));

    if (results.tabsVisible) {
      const tabResults = await testTabSwitching(page);
      // "reachable" = it activated, OR it is deliberately disabled (Connections and
      // Permissions require an active workspace connection). Both are correct
      // behaviour; only a tab that is enabled and still will not activate is a bug.
      results.generalTabWorks = tabResults.general.works || tabResults.general.disabled;
      results.connectionsTabWorks = tabResults.connections.works || tabResults.connections.disabled;
      results.appearanceTabWorks = tabResults.appearance.works || tabResults.appearance.disabled;
      results.privacyTabWorks = tabResults.privacy.works || tabResults.privacy.disabled;
      results.permissionsTabWorks = tabResults.permissions.works || tabResults.permissions.disabled;

      results.generalTabHasContent = tabResults.general.hasContent;
      results.connectionsTabHasContent = tabResults.connections.hasContent;
      results.appearanceTabHasContent = tabResults.appearance.hasContent;
      results.privacyTabHasContent = tabResults.privacy.hasContent;
      results.permissionsTabHasContent = tabResults.permissions.hasContent;

      await takeScreenshot(page, '06_tabs_tested');
    }

    // ========== STEP 7: Close Modal ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Close Settings Modal');
    console.log('─'.repeat(50));

    if (results.modalOpens) {
      results.modalCloses = await closeSettingsModal(page);
      await takeScreenshot(page, '07_modal_closed');
    }

    // Final screenshot
    await takeScreenshot(page, 'FINAL_settings_modal');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Gate on what this spec is FOR. It previously passed on
    // `accountCreated && userDropdownOpens` alone, so a Settings Modal Test would
    // report PASSED with the modal broken, every tab dead and the close button
    // gone — the other 16 results were printed and thrown away.
    //
    // Tab *content* is deliberately not gated: some tabs render conditionally on
    // permissions, so "has content" is genuinely informational. Whether each tab
    // is reachable is not.
    const criticalResults = [
      results.accountCreated,
      results.userDropdownOpens,
      results.settingsMenuItemVisible,
      results.modalOpens,
      results.titleVisible,
      results.tabsVisible,
      results.generalTabWorks,
      results.connectionsTabWorks,
      results.appearanceTabWorks,
      results.privacyTabWorks,
      results.permissionsTabWorks,
      results.modalCloses,
    ];
    const corePassed = criticalResults.every(Boolean);

    console.log('\nAccount Creation:');
    console.log(`  Account Created:          ${results.accountCreated ? 'PASS' : 'FAIL'}`);

    console.log('\nOpening Settings:');
    console.log(`  User Dropdown Opens:      ${results.userDropdownOpens ? 'PASS' : 'FAIL'}`);
    console.log(`  Settings Menu Item:       ${results.settingsMenuItemVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Modal Opens:              ${results.modalOpens ? 'PASS' : 'CHECK'}`);

    console.log('\nModal Structure:');
    console.log(`  Title Visible:            ${results.titleVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Description Visible:      ${results.descriptionVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Tabs Visible:             ${results.tabsVisible ? 'PASS' : 'CHECK'}`);

    console.log('\nTab Switching:');
    console.log(`  General Tab:              ${results.generalTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Connections Tab:          ${results.connectionsTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Appearance Tab:           ${results.appearanceTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Privacy Tab:              ${results.privacyTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Permissions Tab:          ${results.permissionsTabWorks ? 'PASS' : 'CHECK'}`);

    console.log('\nTab Content:');
    console.log(`  General Has Content:      ${results.generalTabHasContent ? 'PASS' : 'CHECK'}`);
    console.log(`  Connections Has Content:  ${results.connectionsTabHasContent ? 'PASS' : 'CHECK'}`);
    console.log(`  Appearance Has Content:   ${results.appearanceTabHasContent ? 'PASS' : 'CHECK'}`);
    console.log(`  Privacy Has Content:      ${results.privacyTabHasContent ? 'PASS' : 'CHECK'}`);
    console.log(`  Permissions Has Content:  ${results.permissionsTabHasContent ? 'PASS' : 'CHECK'}`);

    console.log('\nClose Functionality:');
    console.log(`  Modal Closes:             ${results.modalCloses ? 'PASS' : 'CHECK'}`);

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
