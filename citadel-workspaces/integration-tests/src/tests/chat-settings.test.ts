/**
 * Chat Settings Integration Test
 *
 * Tests the chat settings modal functionality:
 * 1. Create two users and establish P2P connection
 * 2. Open the chat settings modal via the settings icon
 * 3. Navigate through outer tabs (General, File, Advanced, Stats)
 * 4. Navigate through inner tabs in File section (Standard, Remote Storage)
 * 5. Confirm there is no transfer-method choice (one way to send: the Citadel protocol)
 *
 * Note: this covers the per-conversation chat settings modal, not the admin
 * modal's Chat tab (that is admin-modal.test.ts). It checks the controls render
 * and respond; it does not reopen the modal to confirm a setting was
 * stored, so do not read a pass here as evidence of persistence.
 */

import { Page } from 'playwright';
import {
  isVisibleWithin,
  sleep,
  createBrowser,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  takeScreenshot,
  setupConsoleCapture,
  TestHarness,
  runTestMain,
  pollUntil,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: {
    user1: boolean;
    user2: boolean;
  };
  p2pRegistration: boolean;
  p2pAccept: boolean;
  conversationOpen: boolean;
  chatSettings: {
    settingsButtonVisible: boolean;
    modalOpened: boolean;
    outerTabs: {
      generalVisible: boolean;
      fileVisible: boolean;
      advancedVisible: boolean;
      statsVisible: boolean;
      generalContent: boolean;
      fileContent: boolean;
      advancedContent: boolean;
      statsContent: boolean;
    };
    innerFileTabs: {
      standardVisible: boolean;
      remoteStorageVisible: boolean;
      standardContent: boolean;
      remoteStorageContent: boolean;
    };
    noTransferMethodChoice: boolean;
    settingsToggle: {
      autoAcceptVisible: boolean;
      autoAcceptToggleWorks: boolean;
    };
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `settings_alice_${timestamp}`;
const USER2 = `settings_bob_${timestamp}`;

// ============================================================================
// Chat Settings Helper Functions
// ============================================================================

async function openChatSettingsModal(page: Page, username: string): Promise<boolean> {
  console.log(`\n=== ${username}: Opening chat settings modal ===`);
  try {
    // Find the settings button using data-testid
    const settingsButton = page.locator('[data-testid="chat-settings-button"]');

    if (await isVisibleWithin(settingsButton, 5000)) {
      await settingsButton.click();
      console.log('  Clicked settings button');

      // Wait for modal to appear
      await sleep(500);

      // Check for modal title
      const modalTitle = page.getByRole('heading', { name: 'Chat Settings' });
      if (await isVisibleWithin(modalTitle, 3000)) {
        console.log('  Chat settings modal opened');
        return true;
      }
    }

    console.log('  Failed to open chat settings modal');
    return false;
  } catch (error) {
    console.error('  Error opening chat settings modal:', error);
    return false;
  }
}

async function clickOuterTab(page: Page, tabName: string): Promise<boolean> {
  console.log(`  Clicking outer tab: ${tabName}`);
  try {
    const tabTrigger = page.locator(`[data-testid="tab-${tabName.toLowerCase()}"]`);
    if (await isVisibleWithin(tabTrigger, 3000)) {
      await tabTrigger.click();
      await sleep(300);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`  Error clicking outer tab ${tabName}:`, error);
    return false;
  }
}

async function clickInnerFileTab(page: Page, tabName: string): Promise<boolean> {
  console.log(`  Clicking inner file tab: ${tabName}`);
  try {
    const testId = tabName === 'standard' ? 'tab-file-standard' : 'tab-file-remote';
    const tabTrigger = page.locator(`[data-testid="${testId}"]`);
    if (await isVisibleWithin(tabTrigger, 3000)) {
      await tabTrigger.click();
      await sleep(300);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`  Error clicking inner file tab ${tabName}:`, error);
    return false;
  }
}

async function isContentVisible(page: Page, testId: string): Promise<boolean> {
  try {
    const content = page.locator(`[data-testid="${testId}"]`);
    return await isVisibleWithin(content, 2000);
  } catch {
    return false;
  }
}

async function isElementVisible(page: Page, testId: string): Promise<boolean> {
  try {
    const element = page.locator(`[data-testid="${testId}"]`);
    return await isVisibleWithin(element, 2000);
  } catch {
    return false;
  }
}

async function closeChatSettingsModal(page: Page): Promise<void> {
  console.log('  Closing chat settings modal');
  try {
    // Press Escape to close
    await page.keyboard.press('Escape');
    await sleep(300);
  } catch (error) {
    console.log('  Could not close modal with Escape, trying close button');
    // Try clicking close button
    const closeButton = page.locator('button[aria-label="Close"]').first();
    if (await isVisibleWithin(closeButton, 1000)) {
      await closeButton.click();
      await sleep(300);
    }
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function runChatSettingsTest(): Promise<boolean> {
  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    p2pRegistration: false,
    p2pAccept: false,
    conversationOpen: false,
    chatSettings: {
      settingsButtonVisible: false,
      modalOpened: false,
      outerTabs: {
        generalVisible: false,
        fileVisible: false,
        advancedVisible: false,
        statsVisible: false,
        generalContent: false,
        fileContent: false,
        advancedContent: false,
        statsContent: false,
      },
      innerFileTabs: {
        standardVisible: false,
        remoteStorageVisible: false,
        standardContent: false,
        remoteStorageContent: false,
      },
      noTransferMethodChoice: false,
      settingsToggle: {
        autoAcceptVisible: false,
        autoAcceptToggleWorks: false,
      },
    },
  };

  const harness = await TestHarness.create({
    restartBackend: true,
    testName: 'Chat Settings Integration Test',
    reportFileName: 'CHAT_SETTINGS_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
  });
  const uxIssues = harness.uxTracker;

  // Create browser context
  const { browser, context } = await createBrowser();

  try {
    // ========================================================================
    // Step 1: Create two users
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 1: Creating user accounts');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Create Tab 1 for User 1
    const page1 = await context.newPage();
    setupConsoleCapture(page1, 'User1');

    // Create Tab 2 for User 2
    const page2 = await context.newPage();
    setupConsoleCapture(page2, 'User2');

    // Create accounts
    results.accountCreation.user1 = await createAccount(page1, USER1, { isFirstUser: true });
    await takeScreenshot(page1, '01_user1_created');

    results.accountCreation.user2 = await createAccount(page2, USER2, { isFirstUser: false });
    await takeScreenshot(page2, '02_user2_created');

    if (!results.accountCreation.user1 || !results.accountCreation.user2) {
      throw new Error('Account creation failed');
    }

    // ========================================================================
    // Step 2: P2P Registration
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 2: P2P Registration');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    results.p2pRegistration = await p2pRegister(page1, USER1, USER2, uxIssues);
    await takeScreenshot(page1, '03_p2p_register_sent');

    if (!results.p2pRegistration) {
      throw new Error('P2P registration failed');
    }

    // ========================================================================
    // Step 3: Accept P2P Request
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 3: Accept P2P Request');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    results.p2pAccept = await acceptP2PRequest(page2, USER2, uxIssues, USER1);
    await takeScreenshot(page2, '04_p2p_accepted');

    if (!results.p2pAccept) {
      throw new Error('P2P accept failed');
    }

    // ========================================================================
    // Step 4: Open Conversation
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 4: Open Conversation');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    results.conversationOpen = await openConversation(page1, USER1, USER2, uxIssues);
    await takeScreenshot(page1, '05_conversation_open');

    if (!results.conversationOpen) {
      throw new Error('Failed to open conversation');
    }

    // ========================================================================
    // Step 5: Test Chat Settings Modal
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('STEP 5: Test Chat Settings Modal');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    // Check settings button is visible
    results.chatSettings.settingsButtonVisible = await isElementVisible(page1, 'chat-settings-button');
    console.log(`Settings button visible: ${results.chatSettings.settingsButtonVisible}`);

    // Open the settings modal
    results.chatSettings.modalOpened = await openChatSettingsModal(page1, USER1);
    await takeScreenshot(page1, '06_settings_modal_opened');

    if (results.chatSettings.modalOpened) {
      // ======================================================================
      // Step 5a: Test Outer Tabs
      // ======================================================================
      console.log('\n--- Testing Outer Tabs ---');

      // Check General tab (should be default active)
      results.chatSettings.outerTabs.generalVisible = await isElementVisible(page1, 'tab-general');
      results.chatSettings.outerTabs.generalContent = await isContentVisible(page1, 'content-general');
      console.log(`General tab visible: ${results.chatSettings.outerTabs.generalVisible}`);
      console.log(`General content visible: ${results.chatSettings.outerTabs.generalContent}`);
      await takeScreenshot(page1, '07_general_tab');

      // Click File tab
      results.chatSettings.outerTabs.fileVisible = await isElementVisible(page1, 'tab-file');
      if (results.chatSettings.outerTabs.fileVisible) {
        await clickOuterTab(page1, 'file');
        results.chatSettings.outerTabs.fileContent = await isContentVisible(page1, 'content-file');
        console.log(`File tab visible: ${results.chatSettings.outerTabs.fileVisible}`);
        console.log(`File content visible: ${results.chatSettings.outerTabs.fileContent}`);
        await takeScreenshot(page1, '08_file_tab');
      }

      // Click Advanced tab
      results.chatSettings.outerTabs.advancedVisible = await isElementVisible(page1, 'tab-advanced');
      if (results.chatSettings.outerTabs.advancedVisible) {
        await clickOuterTab(page1, 'advanced');
        results.chatSettings.outerTabs.advancedContent = await isContentVisible(page1, 'content-advanced');
        console.log(`Advanced tab visible: ${results.chatSettings.outerTabs.advancedVisible}`);
        console.log(`Advanced content visible: ${results.chatSettings.outerTabs.advancedContent}`);
        await takeScreenshot(page1, '09_advanced_tab');
      }

      // Click Stats tab
      results.chatSettings.outerTabs.statsVisible = await isElementVisible(page1, 'tab-stats');
      if (results.chatSettings.outerTabs.statsVisible) {
        await clickOuterTab(page1, 'stats');
        results.chatSettings.outerTabs.statsContent = await isContentVisible(page1, 'content-stats');
        console.log(`Stats tab visible: ${results.chatSettings.outerTabs.statsVisible}`);
        console.log(`Stats content visible: ${results.chatSettings.outerTabs.statsContent}`);
        await takeScreenshot(page1, '10_stats_tab');
      }

      // ======================================================================
      // Step 5b: Test Inner File Tabs
      // ======================================================================
      console.log('\n--- Testing Inner File Tabs ---');

      // Navigate back to File tab
      await clickOuterTab(page1, 'file');
      await sleep(300);

      // Check Standard tab (should be default active in File section)
      results.chatSettings.innerFileTabs.standardVisible = await isElementVisible(page1, 'tab-file-standard');
      results.chatSettings.innerFileTabs.standardContent = await isContentVisible(page1, 'content-file-standard');
      console.log(`Standard tab visible: ${results.chatSettings.innerFileTabs.standardVisible}`);
      console.log(`Standard content visible: ${results.chatSettings.innerFileTabs.standardContent}`);
      await takeScreenshot(page1, '11_file_standard_tab');

      // Click Remote Storage tab
      results.chatSettings.innerFileTabs.remoteStorageVisible = await isElementVisible(page1, 'tab-file-remote');
      if (results.chatSettings.innerFileTabs.remoteStorageVisible) {
        await clickInnerFileTab(page1, 'remote');
        results.chatSettings.innerFileTabs.remoteStorageContent = await isContentVisible(page1, 'content-file-remote');
        console.log(`Remote Storage tab visible: ${results.chatSettings.innerFileTabs.remoteStorageVisible}`);
        console.log(`Remote Storage content visible: ${results.chatSettings.innerFileTabs.remoteStorageContent}`);
        await takeScreenshot(page1, '12_file_remote_tab');
      }

      // ======================================================================
      // Step 5c: Test Transfer Mode Toggle
      // ======================================================================
      console.log('\n--- Testing Transfer Mode Toggle ---');

      // Go back to Standard tab
      await clickInnerFileTab(page1, 'standard');
      await sleep(300);

      // There is one way to send a file; the old Browser / Citadel Protocol
      // radio must be gone, not merely hidden.
      // Absence by role and name, beside a presence check on the same tab: an
      // absence check alone is true for a panel that never rendered.
      results.chatSettings.noTransferMethodChoice =
        (await page1.locator('[data-testid="max-file-size-slider"]').count()) > 0 &&
        (await page1.getByRole('radio', { name: /browser transfer|citadel protocol/i }).count()) === 0;
      console.log(`No transfer-method choice: ${results.chatSettings.noTransferMethodChoice}`);

      // ======================================================================
      // Step 5d: Test Auto-Accept Toggle
      // ======================================================================
      console.log('\n--- Testing Auto-Accept Toggle ---');

      results.chatSettings.settingsToggle.autoAcceptVisible = await isElementVisible(page1, 'auto-accept-switch');
      console.log(`Auto-accept switch visible: ${results.chatSettings.settingsToggle.autoAcceptVisible}`);

      if (results.chatSettings.settingsToggle.autoAcceptVisible) {
        const autoAcceptSwitch = page1.locator('[data-testid="auto-accept-switch"]');
        const wasChecked = await autoAcceptSwitch.isChecked().catch(() => false);

        // Toggle it, and WAIT for the state to move.
        //
        // This slept 300ms and then read `isChecked()` once. The switch writes
        // its preference through storage before the checked state settles, so
        // 300ms is a guess at how long that takes — and when it is wrong the
        // report says the toggle does not work, which is a claim about the
        // product made from a number in the test.
        await autoAcceptSwitch.click();
        const flipped: boolean = await pollUntil(
          async (): Promise<boolean> =>
            (await autoAcceptSwitch.isChecked().catch(() => wasChecked)) !== wasChecked,
          5000,
        );
        results.chatSettings.settingsToggle.autoAcceptToggleWorks = flipped;

        // Toggle it back
        await autoAcceptSwitch.click();
        await sleep(300);

        await takeScreenshot(page1, '15_auto_accept_tested');
        console.log(`Auto-accept toggle works: ${results.chatSettings.settingsToggle.autoAcceptToggleWorks}`);
      }

      // Close the modal
      await closeChatSettingsModal(page1);
      await takeScreenshot(page1, '16_modal_closed');
    }

    // ========================================================================
    // Final Summary
    // ========================================================================
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('TEST RESULTS SUMMARY');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    const chatSettingsPass =
      results.chatSettings.settingsButtonVisible &&
      results.chatSettings.modalOpened &&
      results.chatSettings.outerTabs.generalVisible &&
      results.chatSettings.outerTabs.fileVisible &&
      results.chatSettings.outerTabs.advancedVisible &&
      results.chatSettings.outerTabs.statsVisible &&
      results.chatSettings.innerFileTabs.standardVisible &&
      results.chatSettings.innerFileTabs.remoteStorageVisible &&
      results.chatSettings.noTransferMethodChoice &&
      // Printed but not gated, until now. Nine booleans below the fold reported
      // PASS/FAIL to the console while the suite exited 0 regardless -- among
      // them the auto-accept toggle, which is the control for a recorded fix.
      // A verdict nobody reads is not a check.
      results.chatSettings.settingsToggle.autoAcceptVisible &&
      results.chatSettings.settingsToggle.autoAcceptToggleWorks &&
      results.chatSettings.outerTabs.generalContent &&
      results.chatSettings.outerTabs.fileContent &&
      results.chatSettings.outerTabs.advancedContent &&
      results.chatSettings.outerTabs.statsContent &&
      results.chatSettings.innerFileTabs.standardContent &&
      results.chatSettings.innerFileTabs.remoteStorageContent;

    console.log('Account Creation:');
    console.log(`  User 1: ${results.accountCreation.user1 ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  User 2: ${results.accountCreation.user2 ? '✓ PASS' : '✗ FAIL'}`);

    console.log('\nP2P Setup:');
    console.log(`  Registration: ${results.p2pRegistration ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Accept: ${results.p2pAccept ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Conversation: ${results.conversationOpen ? '✓ PASS' : '✗ FAIL'}`);

    console.log('\nChat Settings Modal:');
    console.log(`  Settings Button: ${results.chatSettings.settingsButtonVisible ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Modal Opened: ${results.chatSettings.modalOpened ? '✓ PASS' : '✗ FAIL'}`);

    console.log('\nOuter Tabs:');
    console.log(`  General: ${results.chatSettings.outerTabs.generalVisible ? '✓' : '✗'} visible, ${results.chatSettings.outerTabs.generalContent ? '✓' : '✗'} content`);
    console.log(`  File: ${results.chatSettings.outerTabs.fileVisible ? '✓' : '✗'} visible, ${results.chatSettings.outerTabs.fileContent ? '✓' : '✗'} content`);
    console.log(`  Advanced: ${results.chatSettings.outerTabs.advancedVisible ? '✓' : '✗'} visible, ${results.chatSettings.outerTabs.advancedContent ? '✓' : '✗'} content`);
    console.log(`  Stats: ${results.chatSettings.outerTabs.statsVisible ? '✓' : '✗'} visible, ${results.chatSettings.outerTabs.statsContent ? '✓' : '✗'} content`);

    console.log('\nInner File Tabs:');
    console.log(`  Standard: ${results.chatSettings.innerFileTabs.standardVisible ? '✓' : '✗'} visible, ${results.chatSettings.innerFileTabs.standardContent ? '✓' : '✗'} content`);
    console.log(`  Remote Storage: ${results.chatSettings.innerFileTabs.remoteStorageVisible ? '✓' : '✗'} visible, ${results.chatSettings.innerFileTabs.remoteStorageContent ? '✓' : '✗'} content`);

    console.log(`\nNo transfer-method choice: ${results.chatSettings.noTransferMethodChoice ? '✓ PASS' : '✗ FAIL'}`);

    console.log('\nSettings Toggle:');
    console.log(`  Auto-Accept Visible: ${results.chatSettings.settingsToggle.autoAcceptVisible ? '✓ PASS' : '✗ FAIL'}`);
    console.log(`  Auto-Accept Toggle Works: ${results.chatSettings.settingsToggle.autoAcceptToggleWorks ? '✓ PASS' : '✗ FAIL'}`);

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`OVERALL: ${chatSettingsPass ? '✓ PASS' : '✗ FAIL'}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

    await harness.finalize(chatSettingsPass, { results } as Record<string, any>);
    return chatSettingsPass;

  } catch (error) {
    console.error('\n❌ TEST ERROR:', error);
    throw error;
  } finally {
    // Close browser
    await context.close();
    await browser.close();
  }
}

// Run the test
runTestMain(runChatSettingsTest);
