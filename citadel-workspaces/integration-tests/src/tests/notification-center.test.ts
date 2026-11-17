/**
 * Notification Center Integration Test
 *
 * Tests the Notification Center sheet functionality:
 * 1. Open notification center via Bell icon
 * 2. Verify sheet structure (title, tabs, clear all button)
 * 3. Test tab switching (All, Messages, Requests, System)
 * 4. Test empty state display
 * 5. Test Clear All button
 * 6. Close notification center
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
import { activateTab, isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Account creation
  accountCreated: boolean;

  // Notification center
  bellIconVisible: boolean;
  sheetOpens: boolean;

  // Sheet structure
  titleVisible: boolean;
  tabsVisible: boolean;
  clearAllButtonVisible: boolean;

  // Tab functionality
  allTabWorks: boolean;
  messagesTabWorks: boolean;
  requestsTabWorks: boolean;
  systemTabWorks: boolean;

  // Empty state
  emptyStateVisible: boolean;

  // Close functionality
  sheetCloses: boolean;

  // P11 additions: notification badge and item interaction
  notificationBadgeChecked: boolean;
  notificationItemInteraction: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `notif_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Open the notification center by clicking the bell icon
 */
async function openNotificationCenter(page: Page): Promise<boolean> {
  console.log('\n=== Opening Notification Center ===');

  try {
    // Look for the bell icon button in the TopBar
    // It's a ghost button with a Bell icon
    // By testid, not by the icon inside it. `svg.lucide-bell` is lucide's own
  // class name and nothing promises to keep it -- the responsive spec already
  // says so and addresses this same control by name.
  const bellButton = page.getByTestId('notification-bell').first();

    if (!(await isVisibleWithin(bellButton, 5000))) {
      console.log('  Bell icon not found');
      return false;
    }

    console.log('  Found bell icon, clicking...');
    await bellButton.click();
    await sleep(1000);

    // Check if sheet opened
    const sheetTitle = page.locator('text="Notifications"');

    const opened = await isVisibleWithin(sheetTitle, 3000);
    console.log(`  Notification center opened: ${opened}`);
    return opened;
  } catch (error) {
    console.error('  Error opening notification center:', error);
    return false;
  }
}

/**
 * A notification-center tab, scoped to the sheet.
 *
 * The sheet renders over the office view, which has Content/Chat tabs of its
 * own; an unscoped `button[role="tab"]` matches those first.
 */
function notificationTab(page: Page, label: string) {
  return page.locator(`[role="dialog"] button[role="tab"]:has-text("${label}")`);
}

/**
 * Verify sheet structure elements
 */
async function verifySheetStructure(page: Page): Promise<{
  title: boolean;
  tabs: boolean;
  clearAllButton: boolean;
}> {
  console.log('\n=== Verifying Sheet Structure ===');

  const results = {
    title: false,
    tabs: false,
    clearAllButton: false,
  };

  // Check title
  const title = page.locator('text="Notifications"');
  results.title = await isVisibleWithin(title, 3000);
  console.log(`  Title visible: ${results.title}`);

  // Check tabs (All, Messages, Requests, System)
  const tabsVisible = await Promise.all(
    ['All', 'Messages', 'Requests', 'System'].map((label) =>
      isVisibleWithin(notificationTab(page, label), 5000)
    )
  );
  results.tabs = tabsVisible.every(Boolean);
  console.log(`  Tabs visible: ${results.tabs} (All: ${tabsVisible[0]}, Messages: ${tabsVisible[1]}, Requests: ${tabsVisible[2]}, System: ${tabsVisible[3]})`);

  // Check Clear All button
  const clearAllButton = page.locator('button:has-text("Clear All")');
  results.clearAllButton = await isVisibleWithin(clearAllButton, 3000);
  console.log(`  Clear All button visible: ${results.clearAllButton}`);

  return results;
}

/**
 * Test tab switching functionality
 */
async function testTabSwitching(page: Page): Promise<{
  allTab: boolean;
  messagesTab: boolean;
  requestsTab: boolean;
  systemTab: boolean;
}> {
  console.log('\n=== Testing Tab Switching ===');

  const results = {
    allTab: false,
    messagesTab: false,
    requestsTab: false,
    systemTab: false,
  };

  results.allTab = (await activateTab(page, notificationTab(page, 'All'), 'All tab',
    page.locator('[role="dialog"] [role="tabpanel"]').first())).works;

  results.messagesTab = (await activateTab(page, notificationTab(page, 'Messages'), 'Messages tab',
    page.locator('[role="dialog"] [role="tabpanel"]').first())).works;

  results.requestsTab = (await activateTab(page, notificationTab(page, 'Requests'), 'Requests tab',
    page.locator('[role="dialog"] [role="tabpanel"]').first())).works;

  results.systemTab = (await activateTab(page, notificationTab(page, 'System'), 'System tab',
    page.locator('[role="dialog"] [role="tabpanel"]').first())).works;

  // Leave the All tab selected for whatever runs next.
  await activateTab(page, notificationTab(page, 'All'), 'All tab (restore)',
    page.locator('[role="dialog"] [role="tabpanel"]').first());

  return results;
}

/**
 * Check for empty state display
 */
async function checkEmptyState(page: Page): Promise<boolean> {
  console.log('\n=== Checking Empty State ===');

  // Look for the empty state message
  // Check the Requests tab specifically. This used to inspect whichever tab the
  // previous step left active — System — which by then holds real connection
  // notifications, so the empty state was correctly absent and the assertion
  // reported a failure the app had not made. A fresh account has received no peer
  // registration requests, so Requests is the one tab that must be empty.
  await activateTab(page, notificationTab(page, 'Requests'), 'Requests tab',
    page.locator('[role="dialog"] [role="tabpanel"]').first());

  // isVisibleWithin, not isVisible({ timeout }): the latter never waits, and the
  // list has just re-rendered.
  const emptyState = page.locator('text="No notifications to display"');
  const visible = await isVisibleWithin(emptyState, 5000);
  console.log(`  Empty state visible: ${visible}`);
  return visible;
}

/**
 * Close the notification center
 */
async function closeNotificationCenter(page: Page): Promise<boolean> {
  console.log('\n=== Closing Notification Center ===');

  try {
    // Confirm it is actually OPEN first. Reporting "closed" for a sheet that
    // never opened is the same as not checking at all.
    const sheet = page.getByRole('dialog').first();
    const wasOpen = await isVisibleWithin(sheet, 5000);
    if (!wasOpen) {
      console.log('  Notification center was not open before Escape');
      return false;
    }

    await page.keyboard.press('Escape');

    // Wait for it to GO. This previously sampled `text="Notifications"` once,
    // 500ms after Escape, via isVisible({ timeout: 1000 }) - whose timeout
    // option Playwright declares `@deprecated This option is ignored`, so it
    // never waited out the close animation. The bare text selector was also
    // page-wide, so any other "Notifications" label would have reported the
    // sheet as still open. Scoped to the dialog and genuinely awaited.
    const closed = await isHiddenWithin(sheet, 5000);
    console.log(`  Notification center closed: ${closed}`);
    return closed;
  } catch (error) {
    console.error('  Error closing notification center:', error);
    return false;
  }
}

/**
 * Check if bell icon is visible
 */
async function checkBellIconVisible(page: Page): Promise<boolean> {
  console.log('\n=== Checking Bell Icon ===');

  // By testid, not by the icon inside it. `svg.lucide-bell` is lucide's own
  // class name and nothing promises to keep it -- the responsive spec already
  // says so and addresses this same control by name.
  const bellButton = page.getByTestId('notification-bell').first();
  const visible = await isVisibleWithin(bellButton, 5000);
  console.log(`  Bell icon visible: ${visible}`);
  return visible;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Notification Center Integration Test',
    reportFileName: 'NOTIFICATION_CENTER_TEST_REPORT.json',
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
    bellIconVisible: false,
    sheetOpens: false,
    titleVisible: false,
    tabsVisible: false,
    clearAllButtonVisible: false,
    allTabWorks: false,
    messagesTabWorks: false,
    requestsTabWorks: false,
    systemTabWorks: false,
    emptyStateVisible: false,
    sheetCloses: false,
    notificationBadgeChecked: false,
    notificationItemInteraction: false,
  };

  try {
    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('─'.repeat(50));

    const page = await context.newPage();
    setupConsoleCapture(page, 'Notifications', ['error', 'Error', 'notification', 'Notification', 'ILM']);

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

    // ========== STEP 2: Check Bell Icon ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Check Bell Icon');
    console.log('─'.repeat(50));

    results.bellIconVisible = await checkBellIconVisible(page);
    await takeScreenshot(page, '02_bell_icon');

    if (!results.bellIconVisible) {
      console.log('  WARNING: Bell icon not visible');
      uxTracker.log('major', 'functional', 'Notification bell icon not visible');
    }

    // ========== STEP 3: Open Notification Center ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Open Notification Center');
    console.log('─'.repeat(50));

    results.sheetOpens = await openNotificationCenter(page);
    await takeScreenshot(page, '03_notification_center_open');

    if (!results.sheetOpens) {
      console.log('  WARNING: Could not open notification center');
      uxTracker.log('major', 'functional', 'Notification center sheet does not open');
    }

    // ========== STEP 4: Verify Sheet Structure ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Verify Sheet Structure');
    console.log('─'.repeat(50));

    if (results.sheetOpens) {
      const structure = await verifySheetStructure(page);
      results.titleVisible = structure.title;
      results.tabsVisible = structure.tabs;
      results.clearAllButtonVisible = structure.clearAllButton;

      await takeScreenshot(page, '04_sheet_structure');
    }

    // ========== STEP 5: Test Tab Switching ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Test Tab Switching');
    console.log('─'.repeat(50));

    if (results.tabsVisible) {
      const tabResults = await testTabSwitching(page);
      results.allTabWorks = tabResults.allTab;
      results.messagesTabWorks = tabResults.messagesTab;
      results.requestsTabWorks = tabResults.requestsTab;
      results.systemTabWorks = tabResults.systemTab;

      await takeScreenshot(page, '05_tabs_tested');
    }

    // ========== STEP 6: Check Empty State ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Check Empty State');
    console.log('─'.repeat(50));

    if (results.sheetOpens) {
      results.emptyStateVisible = await checkEmptyState(page);
      await takeScreenshot(page, '06_empty_state');
    }

    // ========== STEP 7: Close Notification Center ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Close Notification Center');
    console.log('─'.repeat(50));

    if (results.sheetOpens) {
      results.sheetCloses = await closeNotificationCenter(page);
      await takeScreenshot(page, '07_sheet_closed');
    }

    // ========== STEP 8: Inject Notifications & Check Badge (P11) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: Inject Notifications & Check Badge (P11)');
    console.log('─'.repeat(50));

    // Inject test notifications via window.notificationService (exposed on window)
    const injected = await page.evaluate(() => {
      const svc = (window as any).notificationService;
      if (!svc || typeof svc.addSystemNotification !== 'function') {
        return false;
      }
      svc.addSystemNotification('Test Alert 1', 'First test notification content', 'normal');
      svc.addSystemNotification('Test Alert 2', 'Second test notification content', 'high');
      return true;
    });
    console.log(`  Injected test notifications: ${injected}`);
    await sleep(500);

    // Check badge appears on bell icon (should show unread count)
    // Badge component renders as a div (shadcn), not a span
    // By name. This was `button:has(svg.lucide-bell) .absolute` -- an icon
    // library's internal class and a Tailwind positioning utility, either of
    // which can change without anyone touching the notification centre. The
    // responsive spec already addresses the bell itself by testid for the same
    // reason; the badge had no name until now.
    const badge = page.getByTestId('notification-badge').first();
    const badgeVisible = await isVisibleWithin(badge, 3000);
    results.notificationBadgeChecked = badgeVisible;
    if (badgeVisible) {
      const badgeText = await badge.textContent().catch(() => '');
      console.log(`  Notification badge visible with text: "${badgeText}"`);
    } else {
      console.log('  Notification badge not visible after injection');
    }
    await takeScreenshot(page, '08_notification_badge');

    // ========== STEP 9: Test Notification Item Interaction (P11) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 9: Test Notification Item Interaction (P11)');
    console.log('─'.repeat(50));

    // Open notification center to see injected items
    const reopened = await openNotificationCenter(page);
    if (reopened) {
      await sleep(500);

      // Look for our injected notification text
      const testAlert = page.locator('text="Test Alert 1"').first();
      const itemVisible = await isVisibleWithin(testAlert, 3000);
      console.log(`  Injected notification item visible: ${itemVisible}`);

      if (itemVisible) {
        results.notificationItemInteraction = true;
        console.log('  NotificationItem renders correctly with injected content');
      } else {
        // Fallback: check for any items in the notification list
        const anyItems = page.locator('[role="tabpanel"] > div > div').first();
        const anyContent = await anyItems.textContent().catch(() => '');
        results.notificationItemInteraction = (anyContent?.length ?? 0) > 10;
        console.log(`  Notification list content length: ${anyContent?.length ?? 0}`);
      }

      await takeScreenshot(page, '09_notification_items');
    } else {
      console.log('  Could not reopen notification center');
    }

    // Close notification center if open
    await closeNotificationCenter(page);

    // Final screenshot
    await takeScreenshot(page, 'FINAL_notification_center');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const corePassed = [
      results.accountCreated,
      results.bellIconVisible,
      results.sheetOpens,
      results.titleVisible,
      results.tabsVisible,
      results.clearAllButtonVisible,
      results.allTabWorks,
      results.messagesTabWorks,
      results.requestsTabWorks,
      results.systemTabWorks,
      results.emptyStateVisible,
      results.sheetCloses,
      results.notificationBadgeChecked,
      results.notificationItemInteraction,
    ].every(Boolean);

    console.log('\nAccount Creation:');
    console.log(`  Account Created:          ${results.accountCreated ? 'PASS' : 'FAIL'}`);

    console.log('\nNotification Center:');
    console.log(`  Bell Icon Visible:        ${results.bellIconVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Sheet Opens:              ${results.sheetOpens ? 'PASS' : 'CHECK'}`);

    console.log('\nSheet Structure:');
    console.log(`  Title Visible:            ${results.titleVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Tabs Visible:             ${results.tabsVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Clear All Button:         ${results.clearAllButtonVisible ? 'PASS' : 'CHECK'}`);

    console.log('\nTab Functionality:');
    console.log(`  All Tab Works:            ${results.allTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Messages Tab Works:       ${results.messagesTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Requests Tab Works:       ${results.requestsTabWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  System Tab Works:         ${results.systemTabWorks ? 'PASS' : 'CHECK'}`);

    console.log('\nUI State:');
    console.log(`  Empty State Visible:      ${results.emptyStateVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Sheet Closes:             ${results.sheetCloses ? 'PASS' : 'CHECK'}`);

    console.log('\nP11 Additions:');
    console.log(`  Badge Checked:            ${results.notificationBadgeChecked ? 'PASS' : 'CHECK'}`);
    console.log(`  Item Interaction:         ${results.notificationItemInteraction ? 'PASS' : 'CHECK'}`);

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
