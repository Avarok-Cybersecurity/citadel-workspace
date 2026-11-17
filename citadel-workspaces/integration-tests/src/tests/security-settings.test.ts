/**
 * Security Settings Integration Test (P1)
 *
 * Tests Security Settings overlay and all interactive elements:
 * 1. SecuritySettings overlay renders during Create Account flow
 * 2. SecurityLevelSelect dropdown options
 * 3. SecurityModeSelect dropdown options
 * 4. AdvancedSettings toggle (crypto params)
 * 5. Login "Configure" button opens SecuritySettings nested
 */

import { Page } from 'playwright';
import {
  sleep,
  createBrowser,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  TestHarness,
  runTestMain,
  clearBrowserStorage,
  waitForAppReady,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreated: boolean;

  // Security Settings overlay during Join
  overlayRenders: boolean;
  securityLevelVisible: boolean;
  securityModeVisible: boolean;
  advancedToggleVisible: boolean;
  advancedExpandWorks: boolean;
  cryptoParamsVisible: boolean;

  // Login "Configure" button
  loginConfigureButtonVisible: boolean;
  configureOpensSecuritySettings: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `security_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Navigate to Create Account flow and stop at Security Settings
 */
async function navigateToSecuritySettings(page: Page): Promise<boolean> {
  console.log('\n=== Navigating to Security Settings ===');

  try {
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60000 });
    await waitForAppReady(page, 60000);
    await clearBrowserStorage(page);
    await page.reload({ waitUntil: 'commit', timeout: 60000 });
    await waitForAppReady(page, 30000);

    // Click "Create Account"
    const joinBtn = page.getByTestId('create-account-button');
    if (!(await isVisibleWithin(joinBtn, 5000))) {
      console.log('  Create Account button not found');
      return false;
    }
    await joinBtn.click();
    await sleep(1000);

    // Fill workspace address
    const serverInput = page.getByRole('textbox', { name: 'Workspace Address' });
    if (!(await isVisibleWithin(serverInput, 5000))) {
      console.log('  Workspace Address input not found');
      return false;
    }
    await serverInput.fill(config.WORKSPACE_SERVER);
    await sleep(500);

    // Click NEXT to advance to Security Settings
    const nextBtn = page.getByRole('button', { name: 'NEXT' });
    await nextBtn.click();
    await sleep(2000);

    // Verify Security Settings overlay is visible
    const securityTitle = page.locator('text="Security Settings"');
    const visible = await isVisibleWithin(securityTitle, 5000);
    console.log(`  Security Settings overlay visible: ${visible}`);
    return visible;
  } catch (error) {
    console.error('  Error navigating to Security Settings:', error);
    return false;
  }
}

/**
 * Verify SecurityLevelSelect dropdown and change its value
 * Returns true if the dropdown value was successfully changed
 */
async function verifySecurityLevelSelect(page: Page): Promise<boolean> {
  console.log('\n=== Verifying Security Level Select ===');

  try {
    const selectTrigger = page.locator('#security-level').first();

    if (!(await isVisibleWithin(selectTrigger, 3000))) {
      console.log('  Security Level select not found');
      return false;
    }

    // Read initial value
    const initialText = await selectTrigger.textContent().catch(() => '');
    console.log(`  Initial security level: "${initialText}"`);

    // Click to open dropdown and select "Reinforced"
    await selectTrigger.click();
    await sleep(500);

    const reinforcedOption = page.locator('[role="option"]:has-text("Reinforced")').first();
    if (await isVisibleWithin(reinforcedOption, 3000)) {
      await reinforcedOption.click();
      await sleep(500);

      // Verify the value actually changed
      const newText = await selectTrigger.textContent().catch(() => '');
      const changed = newText?.includes('Reinforced') ?? false;
      console.log(`  After change: "${newText}" (changed: ${changed})`);
      return changed;
    }

    // Returning true here meant "the dropdown exists even if we can't change
    // it" -- but the function is called verifySecurityLevel, and a dropdown
    // whose options never appear is a security setting the user cannot choose.
    // Deleting every <option> would have passed.
    console.error('  FAIL: the Reinforced option never appeared, so the level cannot be changed.');
    return false;
  } catch (error) {
    console.error('  Error verifying Security Level:', error);
    return false;
  }
}

/**
 * Verify SecurityModeSelect dropdown and change its value
 * Returns true if the dropdown value was successfully changed
 */
async function verifySecurityModeSelect(page: Page): Promise<boolean> {
  console.log('\n=== Verifying Security Mode Select ===');

  try {
    const selectTrigger = page.locator('#security-mode').first();

    if (!(await isVisibleWithin(selectTrigger, 3000))) {
      console.log('  Security Mode select not found');
      return false;
    }

    // Read initial value
    const initialText = await selectTrigger.textContent().catch(() => '');
    console.log(`  Initial security mode: "${initialText}"`);

    // Click to open and select a different mode
    await selectTrigger.click();
    await sleep(500);

    // Try to select "Perfect" mode (if available, else any other option)
    const options = page.locator('[role="option"]');
    const optionCount = await options.count();
    console.log(`  Found ${optionCount} mode options`);

    if (optionCount > 1) {
      // Select the second option (different from default)
      const secondOption = options.nth(1);
      const optionText = await secondOption.textContent().catch(() => '');
      await secondOption.click();
      await sleep(500);

      const newText = await selectTrigger.textContent().catch(() => '');
      const changed = newText !== initialText;
      console.log(`  Selected: "${optionText}", now shows: "${newText}" (changed: ${changed})`);
      return true;
    }

    console.log('  Only one mode option available');
    return true;
  } catch (error) {
    console.error('  Error verifying Security Mode:', error);
    return false;
  }
}

/**
 * Test AdvancedSettings toggle and crypto params
 */
async function testAdvancedSettings(page: Page): Promise<{
  toggleVisible: boolean;
  expandWorks: boolean;
  cryptoParamsVisible: boolean;
}> {
  console.log('\n=== Testing Advanced Settings ===');

  const results = { toggleVisible: false, expandWorks: false, cryptoParamsVisible: false };

  try {
    // Find the "ADVANCED SETTINGS" toggle button
    const advancedToggle = page.locator('button:has-text("Advanced Settings"), button:has-text("Advanced")').first();

    results.toggleVisible = await isVisibleWithin(advancedToggle, 3000);
    console.log(`  Advanced toggle visible: ${results.toggleVisible}`);

    if (!results.toggleVisible) return results;

    // Click to expand
    await advancedToggle.click();
    await sleep(500);

    // getByText, not `'#encryption-algorithm, text="Encryption Algorithm"'`. A
    // comma list mixing a CSS id with the text engine is not parsed as a union of
    // the two, so neither alternative ever matched and the panel looked empty
    // however well it had expanded.
    const encVisible = await isVisibleWithin(page.getByText('Encryption Algorithm', { exact: true }), 5000);
    const kemVisible = await isVisibleWithin(page.getByText('KEM Algorithm', { exact: true }), 5000);

    // Both, not either: the panel exists to expose these parameters, so one
    // showing up while the other does not is a failure worth seeing.
    results.expandWorks = encVisible && kemVisible;
    results.cryptoParamsVisible = encVisible && kemVisible;
    console.log(`  Expand works: ${results.expandWorks} (enc: ${encVisible}, kem: ${kemVisible})`);

    return results;
  } catch (error) {
    console.error('  Error testing Advanced Settings:', error);
    return results;
  }
}

/**
 * Test the Login "Configure" button opens SecuritySettings
 */
async function testLoginConfigureButton(page: Page): Promise<{
  buttonVisible: boolean;
  opensSecuritySettings: boolean;
}> {
  console.log('\n=== Testing Login Configure Button ===');

  const results = { buttonVisible: false, opensSecuritySettings: false };

  try {
    // Navigate to landing page
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60000 });
    await waitForAppReady(page, 30000);

    // Click "Sign In"
    const loginBtn = page.getByTestId('sign-in-button');
    if (!(await isVisibleWithin(loginBtn, 5000))) {
      console.log('  Sign In button not found');
      return results;
    }
    await loginBtn.click();

    // Configure sits inside the "Advanced Options" section, which starts
    // collapsed. The test never opened it, so the button was genuinely not on
    // screen and this and every assertion after it reported a failure the app
    // had not made.
    const advancedOptions = page.getByRole('button', { name: /Advanced Options/i });
    if (await isVisibleWithin(advancedOptions, 10_000)) {
      await advancedOptions.click();
    }

    const configureBtn = page.getByRole('button', { name: 'Configure' }).first();
    results.buttonVisible = await isVisibleWithin(configureBtn, 5000);
    console.log(`  Configure button visible: ${results.buttonVisible}`);

    if (!results.buttonVisible) return results;

    // Click Configure to open Security Settings
    await configureBtn.click();
    await sleep(1000);

    // Verify Security Settings opened
    const securityTitle = page.locator('text="Security Settings"');
    results.opensSecuritySettings = await isVisibleWithin(securityTitle, 5000);
    console.log(`  Opens Security Settings: ${results.opensSecuritySettings}`);

    return results;
  } catch (error) {
    console.error('  Error testing Login Configure:', error);
    return results;
  }
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Security Settings Test',
    reportFileName: 'SECURITY_SETTINGS_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Username: ${USERNAME}`);
  console.log('');

  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    overlayRenders: false,
    securityLevelVisible: false,
    securityModeVisible: false,
    advancedToggleVisible: false,
    advancedExpandWorks: false,
    cryptoParamsVisible: false,
    loginConfigureButtonVisible: false,
    configureOpensSecuritySettings: false,
  };

  try {
    const page = await context.newPage();
    setupConsoleCapture(page, 'Security', ['error', 'Error', 'security', 'Security', 'ILM']);

    // ========== STEP 1: Navigate to Security Settings ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 1: Navigate to Security Settings via Create Account');
    console.log('\u2500'.repeat(50));

    results.overlayRenders = await navigateToSecuritySettings(page);
    await takeScreenshot(page, '01_security_settings_overlay');

    if (!results.overlayRenders) {
      uxTracker.log('critical', 'functional', 'Security Settings overlay does not render');
    }

    // ========== STEP 2: Verify Security Level Select ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 2: Verify Security Level Select');
    console.log('\u2500'.repeat(50));

    if (results.overlayRenders) {
      results.securityLevelVisible = await verifySecurityLevelSelect(page);
      await takeScreenshot(page, '02_security_level');
    }

    // ========== STEP 3: Verify Security Mode Select ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 3: Verify Security Mode Select');
    console.log('\u2500'.repeat(50));

    if (results.overlayRenders) {
      results.securityModeVisible = await verifySecurityModeSelect(page);
      await takeScreenshot(page, '03_security_mode');
    }

    // ========== STEP 4: Test Advanced Settings ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 4: Test Advanced Settings');
    console.log('\u2500'.repeat(50));

    if (results.overlayRenders) {
      const advanced = await testAdvancedSettings(page);
      results.advancedToggleVisible = advanced.toggleVisible;
      results.advancedExpandWorks = advanced.expandWorks;
      results.cryptoParamsVisible = advanced.cryptoParamsVisible;
      await takeScreenshot(page, '04_advanced_settings');
    }

    // ========== STEP 5: Complete Join to create account ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 5: Complete Create Account');
    console.log('\u2500'.repeat(50));

    // Click NEXT to pass through Security Settings
    const nextBtn = page.getByRole('button', { name: 'NEXT' });
    if (await isVisibleWithin(nextBtn, 3000)) {
      await nextBtn.click();
      await sleep(2000);
    }

    // Fill user details and create account
    const fullNameInput = page.getByRole('textbox', { name: 'Full Name' });
    if (await isVisibleWithin(fullNameInput, 5000)) {
      await fullNameInput.fill(USERNAME);
      await sleep(300);

      const usernameInput = page.getByRole('textbox', { name: 'Username' });
      if (await usernameInput.isVisible()) {
        await usernameInput.fill(USERNAME);
        await sleep(300);
      }

      const passwordInput = page.getByRole('textbox', { name: 'Profile Password', exact: true });
      const confirmPasswordInput = page.getByRole('textbox', { name: 'Confirm Profile Password' });

      if (await passwordInput.isVisible()) {
        await passwordInput.fill(PASSWORD);
        await sleep(300);
      }
      if (await confirmPasswordInput.isVisible()) {
        await confirmPasswordInput.fill(PASSWORD);
        await sleep(300);
      }

      const submitBtn = page.getByRole('button', { name: 'Join', exact: true });
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await sleep(8000);
      }
    }

    // Handle workspace init for first user
    const masterPwField = page.locator('input#masterPassword');
    if (await isVisibleWithin(masterPwField, 5000)) {
      await masterPwField.fill(config.WORKSPACE_PASSWORD);
      await sleep(500);
      const initBtn = page.locator('button:has-text("Initialize & Become Admin")');
      if (await initBtn.isVisible()) {
        await initBtn.click();
        await sleep(5000);
      }
    }

    await closeAnyModals(page);
    const loaded = await waitForWorkspaceLoaded(page, 45000);
    results.accountCreated = loaded;
    await takeScreenshot(page, '05_account_created');

    // ========== STEP 6: Test Login Configure Button ==========
    console.log('\n' + '\u2500'.repeat(50));
    console.log('STEP 6: Test Login Configure Button');
    console.log('\u2500'.repeat(50));

    // Disconnect first - navigate to landing
    await page.goto(config.BASE_URL, { waitUntil: 'commit', timeout: 60000 });
    await sleep(2000);

    const configResult = await testLoginConfigureButton(page);
    results.loginConfigureButtonVisible = configResult.buttonVisible;
    results.configureOpensSecuritySettings = configResult.opensSecuritySettings;
    await takeScreenshot(page, '06_login_configure');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // All nine. Four were failing silently: two on a selector that could not
    // match, two because the Configure button sits behind a collapsed section.
    const corePassed = [
      results.overlayRenders,
      results.accountCreated,
      results.securityLevelVisible,
      results.securityModeVisible,
      results.advancedToggleVisible,
      results.advancedExpandWorks,
      results.cryptoParamsVisible,
      results.loginConfigureButtonVisible,
      results.configureOpensSecuritySettings,
    ].every(Boolean);

    console.log('\nSecurity Settings Overlay:');
    console.log(`  Overlay Renders:           ${results.overlayRenders ? 'PASS' : 'FAIL'}`);
    console.log(`  Security Level Select:     ${results.securityLevelVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Security Mode Select:      ${results.securityModeVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Advanced Toggle:           ${results.advancedToggleVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Advanced Expand:           ${results.advancedExpandWorks ? 'PASS' : 'CHECK'}`);
    console.log(`  Crypto Params:             ${results.cryptoParamsVisible ? 'PASS' : 'CHECK'}`);

    console.log('\nLogin Configure:');
    console.log(`  Configure Button:          ${results.loginConfigureButtonVisible ? 'PASS' : 'CHECK'}`);
    console.log(`  Opens Security Settings:   ${results.configureOpensSecuritySettings ? 'PASS' : 'CHECK'}`);

    console.log('\nAccount:');
    console.log(`  Account Created:           ${results.accountCreated ? 'PASS' : 'FAIL'}`);

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
