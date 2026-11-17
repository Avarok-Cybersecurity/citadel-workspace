/**
 * Admin Member Management Integration Test (P6)
 *
 * Tests MemberManagementModal and role management:
 * 1. Open Member Management from admin settings
 * 2. Verify member list renders
 * 3. Role assignment dropdown
 * 4. Member kick/ban action
 */

import { Page } from 'playwright';
import {
  activateAdminTab,
  adminDialog,
  openAdminPanel,
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
  accountCreation: { admin: boolean; member: boolean };
  memberManagementOpens: boolean;
  memberListVisible: boolean;
  roleDropdownVisible: boolean;
  kickButtonVisible: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `admin_mgmt_${timestamp}`;
const MEMBER_USER = `member_mgmt_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

async function openMemberManagement(page: Page): Promise<boolean> {
  console.log('\n=== Opening Member Management ===');

  // The panel is reached through a tree node's context menu, not through a
  // sidebar "Admin" button and a "Member Management" button — neither of which
  // exists. The old route also used a selector mixing CSS with the text engine,
  // which throws rather than matching. Shared with admin-modal via lib.
  if (!(await openAdminPanel(page))) return false;

  const onMembers = await activateAdminTab(page, 'members');
  console.log(`  Members tab active: ${onMembers}`);
  return onMembers;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Member Management Test',
    reportFileName: 'MEMBER_MANAGEMENT_TEST_REPORT.json',
    metadata: { admin: ADMIN_USER, member: MEMBER_USER },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser } = await createBrowser();
  const [context1, context2] = await createIsolatedContexts(browser, 2);

  const results: TestResults = {
    accountCreation: { admin: false, member: false },
    memberManagementOpens: false,
    memberListVisible: false,
    roleDropdownVisible: false,
    kickButtonVisible: false,
  };

  try {
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    setupConsoleCapture(page1, 'Admin', ['error', 'Error', 'ILM']);
    setupConsoleCapture(page2, 'Member', ['error', 'Error', 'ILM']);

    // ========== STEP 1: Create Accounts ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 1: Create Accounts');
    console.log('\u2500'.repeat(50));

    results.accountCreation.admin = await createAccount(page1, ADMIN_USER, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });
    results.accountCreation.member = await createAccount(page2, MEMBER_USER, {
      isFirstUser: false,
      password: PASSWORD,
      uxTracker,
    });

    if (!results.accountCreation.admin) throw new Error('Admin creation failed');

    await sleep(3000);
    await closeAnyModals(page1);
    await waitForWorkspaceLoaded(page1, 30000);

    // ========== STEP 2: Open Member Management ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 2: Open Member Management');
    console.log('\u2500'.repeat(50));

    results.memberManagementOpens = await openMemberManagement(page1);
    await takeScreenshot(page1, '02_member_management');

    // ========== STEP 3: Verify Member List ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 3: Verify Member List');
    console.log('\u2500'.repeat(50));

    if (results.memberManagementOpens) {
      // Member rows by their own testid. `[class*="member"], tr, [role="row"]`
      // matched anything on the page whose class happened to contain "member",
      // and "more than zero of those exist" is not evidence the list rendered.
      // Wait for the tab to finish loading before counting. It renders
      // members-tab-loading first, and counting during that window finds zero
      // rows and calls it an empty list.
      const dialog = adminDialog(page1);
      await isVisibleWithin(dialog.locator('[data-testid="members-tab-content"]'), 20_000);

      const rows = dialog.locator('[data-testid^="member-row-"]');
      const count = await rows.count();
      results.memberListVisible = count > 0 && (await isVisibleWithin(rows.first(), 10_000));
      console.log(`  Member rows found: ${count}`);
      if (count === 0) {
        const shown = (await dialog.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200);
        console.log(`  Members panel showed: ${JSON.stringify(shown)}`);
      }

      await takeScreenshot(page1, '03_member_list');
    }

    // ========== STEP 4: Check Role Dropdown ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 4: Check Role Dropdown');
    console.log('\u2500'.repeat(50));

    if (results.memberManagementOpens) {
      const roleSelect = adminDialog(page1).locator('[data-testid^="member-role-select-"]').first();
      results.roleDropdownVisible = await isVisibleWithin(roleSelect, 10_000);
      console.log(`  Role dropdown visible: ${results.roleDropdownVisible}`);
      await takeScreenshot(page1, '04_role_dropdown');
    }

    // ========== STEP 5: Check Kick/Ban Button ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 5: Check Kick/Ban Button');
    console.log('\u2500'.repeat(50));

    if (results.memberManagementOpens) {
      const kickBtn = adminDialog(page1).locator('[data-testid^="member-remove-"]').first();
      results.kickButtonVisible = await isVisibleWithin(kickBtn, 10_000);
      console.log(`  Kick/Ban button visible: ${results.kickButtonVisible}`);
      await takeScreenshot(page1, '05_kick_ban');
    }

    // Close modal
    await page1.keyboard.press('Escape');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // All six. Four were failing silently because the panel never opened.
    const corePassed = [
      results.accountCreation.admin,
      results.accountCreation.member,
      results.memberManagementOpens,
      results.memberListVisible,
      results.roleDropdownVisible,
      results.kickButtonVisible,
    ].every(Boolean);

    console.log(`\n  Admin Created:             ${results.accountCreation.admin ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Created:            ${results.accountCreation.member ? 'PASS' : 'CHECK'}`);
    console.log(`  Mgmt Modal Opens:          ${results.memberManagementOpens ? 'PASS' : 'CHECK'}`);
    console.log(`  Member List Visible:       ${results.memberListVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Role Dropdown:             ${results.roleDropdownVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Kick/Ban Button:           ${results.kickButtonVisible ? 'PASS' : 'CHECK'}`);

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
