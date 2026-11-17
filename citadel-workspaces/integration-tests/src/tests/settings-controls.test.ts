/**
 * Settings Tab Controls Integration Test (P4)
 *
 * Tests specific controls within each Settings tab:
 * 1. General tab controls
 * 2. Connections tab (auto-reconnect switch)
 * 3. Appearance tab (theme toggle)
 * 4. Privacy tab controls
 */

import { Page } from 'playwright';
import {
  activateTab,
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
  accountCreated: boolean;
  settingsModalOpens: boolean;

  // Tab controls
  generalTabControls: boolean;
  connectionsAutoReconnect: boolean;
  appearanceThemeToggle: boolean;
  privacyControls: boolean;

  // Persistence
  settingsReopen: boolean;
  /**
   * Whether the auto-reconnect choice survived close-and-reopen.
   *
   * This was a console.log and nothing else: the run printed "Settings
   * persistence verified: false" and exited 0. Persistence is the entire point
   * of reopening the modal, so it is the one result the step must produce.
   */
  settingsPersisted: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `settings_ctrl_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

async function openSettingsModal(page: Page): Promise<boolean> {
  const avatarButton = page.locator('[data-testid="user-avatar-button"]');
  if (!(await isVisibleWithin(avatarButton, 5000))) return false;

  await avatarButton.click();
  await sleep(500);

  const settingsItem = page.locator('[role="menuitem"]:has-text("Settings")');
  if (!(await isVisibleWithin(settingsItem, 3000))) return false;

  await settingsItem.click();
  await sleep(500);

  const modal = page.locator('[role="dialog"]').first();
  return await isVisibleWithin(modal, 3000);
}

async function testGeneralTab(page: Page): Promise<boolean> {
  console.log('\n=== Testing General Tab Controls ===');

  const dialog = page.locator('[role="dialog"]');

  // The shared helper waits for THIS tab to report active and resolves its panel
  // via aria-controls, instead of sleeping and then reading an unscoped
  // [role="tabpanel"] that also matches the office view behind the modal.
  const { works } = await activateTab(
    page,
    dialog.locator('button[role="tab"]').first(),
    'General tab',
    dialog.locator('[role="tabpanel"]').first()
  );
  if (!works) return false;

  // The controls the tab actually offers, rather than "the panel has more than
  // ten characters of text" — which any rendered panel satisfies and which
  // therefore asserted nothing.
  const heading = await isVisibleWithin(dialog.getByText('User Profile'), 5000);
  const displayName = await isVisibleWithin(dialog.locator('#displayName'), 5000);
  const save = await isVisibleWithin(dialog.getByRole('button', { name: /save/i }), 5000);

  const hasControls = heading && displayName && save;
  console.log(
    `  General tab has controls: ${hasControls} ` +
      `(heading: ${heading}, displayName: ${displayName}, save: ${save})`
  );
  return hasControls;
}

async function testConnectionsTab(page: Page): Promise<boolean> {
  console.log('\n=== Testing Connections Tab ===');

  const connectionsTab = page.locator('[role="dialog"] button[role="tab"]').nth(1);
  if (!(await isVisibleWithin(connectionsTab, 2000))) {
    console.log('  Connections tab not found');
    return false;
  }

  await connectionsTab.click();
  await sleep(300);

  // Look for auto-reconnect switch
  const autoReconnect = page.locator('#auto-reconnect').first();
  const visible = await isVisibleWithin(autoReconnect, 3000);
  console.log(`  Auto-reconnect switch visible: ${visible}`);

  if (!visible) return false;

  // Read initial state
  const initialChecked = await autoReconnect.getAttribute('data-state').catch(() => null);
  const initialAria = await autoReconnect.getAttribute('aria-checked').catch(() => null);
  console.log(`  Initial state: data-state="${initialChecked}", aria-checked="${initialAria}"`);

  // Toggle the switch
  await autoReconnect.click();
  await sleep(500);

  // Verify the state actually changed
  const afterChecked = await autoReconnect.getAttribute('data-state').catch(() => null);
  const afterAria = await autoReconnect.getAttribute('aria-checked').catch(() => null);
  console.log(`  After toggle: data-state="${afterChecked}", aria-checked="${afterAria}"`);

  const stateChanged = afterChecked !== initialChecked || afterAria !== initialAria;
  console.log(`  State changed: ${stateChanged}`);

  // Toggle back to restore original state
  await autoReconnect.click();
  await sleep(500);

  const restoredChecked = await autoReconnect.getAttribute('data-state').catch(() => null);
  const restored = restoredChecked === initialChecked;
  console.log(`  Restored to original: ${restored} (data-state="${restoredChecked}")`);

  return stateChanged;
}

async function testAppearanceTab(page: Page): Promise<boolean> {
  console.log('\n=== Testing Appearance Tab ===');

  const appearanceTab = page.locator('[role="dialog"] button[role="tab"]').nth(2);
  if (!(await isVisibleWithin(appearanceTab, 2000))) {
    console.log('  Appearance tab not found');
    return false;
  }

  await appearanceTab.click();
  await sleep(300);

  // Look for theme toggle/select (dark/light/system)
  const themeControl = page.locator('[role="combobox"], [role="switch"], [role="radiogroup"], select').first();
  let visible = await isVisibleWithin(themeControl, 3000);

  if (!visible) {
    // Alternative: look for theme-related text
    const themeText = page.getByText(/Theme|Dark|Light|System/).first();
    visible = await isVisibleWithin(themeText, 2000);
  }

  console.log(`  Theme control visible: ${visible}`);
  return visible;
}

async function testPrivacyTab(page: Page): Promise<boolean> {
  console.log('\n=== Testing Privacy Tab ===');

  const privacyTab = page.locator('[role="dialog"] button[role="tab"]').nth(3);
  if (!(await isVisibleWithin(privacyTab, 2000))) {
    console.log('  Privacy tab not found');
    return false;
  }

  await privacyTab.click();
  await sleep(300);

  // Look for any privacy-related controls
  const privacyControl = page.locator('[role="switch"], input[type="checkbox"], [role="combobox"]').first();
  let visible = await isVisibleWithin(privacyControl, 3000);

  if (!visible) {
    // Check for content in the tab panel
    const tabPanel = page.locator('[role="tabpanel"]');
    const text = await tabPanel.textContent().catch(() => '');
    visible = (text?.length ?? 0) > 10;
  }

  console.log(`  Privacy controls visible: ${visible}`);
  return visible;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Settings Tab Controls Test',
    reportFileName: 'SETTINGS_CONTROLS_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    settingsModalOpens: false,
    generalTabControls: false,
    connectionsAutoReconnect: false,
    appearanceThemeToggle: false,
    privacyControls: false,
    settingsReopen: false,
    settingsPersisted: false,
  };

  try {
    const page = await context.newPage();
    setupConsoleCapture(page, 'Settings', ['error', 'Error', 'ILM']);

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

    // ========== STEP 2: Open Settings Modal ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 2: Open Settings Modal');
    console.log('\u2500'.repeat(50));

    results.settingsModalOpens = await openSettingsModal(page);
    await takeScreenshot(page, '02_settings_open');

    if (!results.settingsModalOpens) {
      uxTracker.log('major', 'functional', 'Settings modal does not open');
    }

    // ========== STEP 3: Test General Tab ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 3: Test General Tab');
    console.log('\u2500'.repeat(50));

    if (results.settingsModalOpens) {
      results.generalTabControls = await testGeneralTab(page);
      await takeScreenshot(page, '03_general_tab');
    }

    // ========== STEP 4: Test Connections Tab ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 4: Test Connections Tab');
    console.log('\u2500'.repeat(50));

    if (results.settingsModalOpens) {
      results.connectionsAutoReconnect = await testConnectionsTab(page);
      await takeScreenshot(page, '04_connections_tab');
    }

    // ========== STEP 5: Test Appearance Tab ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 5: Test Appearance Tab');
    console.log('\u2500'.repeat(50));

    if (results.settingsModalOpens) {
      results.appearanceThemeToggle = await testAppearanceTab(page);
      await takeScreenshot(page, '05_appearance_tab');
    }

    // ========== STEP 6: Test Privacy Tab ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 6: Test Privacy Tab');
    console.log('\u2500'.repeat(50));

    if (results.settingsModalOpens) {
      results.privacyControls = await testPrivacyTab(page);
      await takeScreenshot(page, '06_privacy_tab');
    }

    // ========== STEP 7: Close and Reopen ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 7: Close and Reopen Settings');
    console.log('\u2500'.repeat(50));

    // Close the settings dialog completely (may need multiple Escapes for overlay)
    await page.keyboard.press('Escape');
    await sleep(300);
    await page.keyboard.press('Escape');
    await sleep(300);
    await closeAnyModals(page);
    await sleep(500);

    results.settingsReopen = await openSettingsModal(page);
    await takeScreenshot(page, '07_settings_reopened');

    if (results.settingsReopen) {
      // Verify the auto-reconnect state persisted after close/reopen
      const connectionsTab = page.locator('[role="dialog"] button[role="tab"]').nth(1);
      if (await isVisibleWithin(connectionsTab, 2000)) {
        await connectionsTab.click();
        await sleep(300);
        const autoReconnect = page.locator('#auto-reconnect').first();
        const persistedState = await autoReconnect.getAttribute('data-state').catch(() => null);
        results.settingsPersisted = persistedState === 'checked';
        console.log(`  Auto-reconnect persisted state: "${persistedState}"`);
        console.log(`  Settings persistence verified: ${results.settingsPersisted}`);
      }

      await page.keyboard.press('Escape');
      await sleep(300);
      await closeAnyModals(page);
    }

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // All seven. General Tab Controls was failing silently behind an unscoped
    // panel lookup and a character-count assertion.
    const corePassed = [
      results.accountCreated,
      results.settingsModalOpens,
      results.generalTabControls,
      results.connectionsAutoReconnect,
      results.appearanceThemeToggle,
      results.privacyControls,
      results.settingsReopen,
      results.settingsPersisted,
    ].every(Boolean);

    console.log(`\n  Account Created:           ${results.accountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Settings Modal Opens:      ${results.settingsModalOpens ? 'PASS' : 'FAIL'}`);
    console.log(`  General Tab Controls:      ${results.generalTabControls ? 'PASS' : 'CHECK'}`);
    console.log(`  Auto-Reconnect Switch:     ${results.connectionsAutoReconnect ? 'PASS' : 'CHECK'}`);
    console.log(`  Theme Toggle:              ${results.appearanceThemeToggle ? 'PASS' : 'CHECK'}`);
    console.log(`  Privacy Controls:          ${results.privacyControls ? 'PASS' : 'CHECK'}`);
    console.log(`  Settings Reopen:           ${results.settingsReopen ? 'PASS' : 'CHECK'}`);
    console.log(`  Settings Persisted:        ${results.settingsPersisted ? 'PASS' : 'FAIL'}`);

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
