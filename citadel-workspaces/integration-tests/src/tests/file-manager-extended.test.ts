/**
 * File Manager Extended Integration Test (P8)
 *
 * Tests file manager edge cases and additional UI elements:
 * 1. Sort controls (the address bar's Name / Modified menu)
 * 2. The inspector: selecting an item opens its details beside the list
 *
 * FileUploadProgress / fileUploadService are not tested: neither the component
 * nor src/lib/file-upload-service.ts exists, so the dynamic import the test
 * once performed could only ever throw.
 */

import { Page } from 'playwright';
import {
  sleep,
  createBrowser,
  createIsolatedContexts,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  waitForAppReady,
  closeAnyModals,
  TestHarness,
  runTestMain,
  fmItem,
  openFileManagerFromSidebar,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: { user1: boolean; user2: boolean };
  p2pRegistered: boolean;
  fileManagerLoaded: boolean;

  // Sort controls
  sortControlVisible: boolean;
  sortChangeWorks: boolean;

  // Inspector
  inspectorOpens: boolean;

  // Error state modals (P8 extended)
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `files_ext_a_${timestamp}`;
const USER2 = `files_ext_b_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

async function navigateToFileManager(page: Page): Promise<boolean> {
  console.log('\n=== Navigating to File Manager ===');
  // The sidebar opens Server Storage, which needs only the C2S session: the rest
  // of this spec stays off the P2P handshake's critical path.
  if (!(await openFileManagerFromSidebar(page))) {
    const baseUrl = page.url().split('?')[0];
    await page.goto(`${baseUrl}?section=files`, { waitUntil: 'commit', timeout: 30000 });
    await waitForAppReady(page, 30000);
  }
  // Every seeded RE-VFS tree holds the protected "Sent Files" folder, so its row
  // is proof the browser itself rendered -- not the sidebar's own "Files" label.
  const loaded = await isVisibleWithin(fmItem(page, 'Sent Files'), 30000);
  console.log(`  File manager loaded: ${loaded}`);
  return loaded;
}

async function testSortControls(page: Page): Promise<{
  visible: boolean;
  changeWorks: boolean;
}> {
  console.log('\n=== Testing Sort Controls ===');
  const results = { visible: false, changeWorks: false };

  // The trigger's accessible name states the order in force ("Sort by Name,
  // ascending"), so waiting for the new name is the app confirming the sort
  // changed -- not merely that a menu item appeared.
  const sortTrigger = (field: string) => page.getByRole('button', { name: new RegExp(`^Sort by ${field},`) });

  results.visible = await isVisibleWithin(sortTrigger('Name'), 10000);
  console.log(`  Sort control visible: ${results.visible}`);
  if (!results.visible) return results;

  await sortTrigger('Name').click();
  const modifiedItem = page.getByRole('menuitem', { name: 'Modified' });
  if (!(await isVisibleWithin(modifiedItem, 5000))) {
    console.log('  Sort menu did not open');
    return results;
  }
  await modifiedItem.click();
  results.changeWorks = await isVisibleWithin(sortTrigger('Modified'), 5000);
  console.log(`  Sort change works: ${results.changeWorks}`);
  return results;
}

/**
 * One click selects an item and opens the inspector beside the list. A folder
 * will do: the seeded "Sent Files" is always there.
 */
async function testInspector(page: Page): Promise<boolean> {
  console.log('\n=== Testing the Inspector ===');
  await fmItem(page, 'Sent Files').click();
  const inspector = page.getByTestId('vfs-inspector');
  const opens: boolean = await isVisibleWithin(inspector, 5000)
    && await isVisibleWithin(inspector.getByText('Sent Files', { exact: true }).first(), 2000);
  console.log(`  Inspector opens on the selected item: ${opens}`);
  return opens;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'File Manager Extended Test',
    reportFileName: 'FILE_MANAGER_EXTENDED_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser } = await createBrowser();
  const [context1, context2] = await createIsolatedContexts(browser, 2);

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    p2pRegistered: false,
    fileManagerLoaded: false,
    sortControlVisible: false,
    sortChangeWorks: false,
    inspectorOpens: false,
  };

  try {
    const page1 = await context1.newPage();
    const page2 = await context2.newPage();
    setupConsoleCapture(page1, 'User1', ['error', 'Error', 'ILM']);
    setupConsoleCapture(page2, 'User2', ['error', 'Error', 'ILM']);

    // ========== STEP 1: Create Accounts & P2P ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Accounts & P2P Register');
    console.log('─'.repeat(50));

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

    // P2P registration is best-effort: the file manager opens on server storage,
    // so the rest of the spec does not depend on the handshake landing.
    results.p2pRegistered = await p2pRegister(page1, USER1, USER2);
    await sleep(3000);
    await acceptP2PRequest(page2, USER2, null, USER1);
    await sleep(5000);

    await closeAnyModals(page1);
    await waitForWorkspaceLoaded(page1, 30000);

    // ========== STEP 2: Navigate to File Manager ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Navigate to File Manager');
    console.log('─'.repeat(50));

    results.fileManagerLoaded = await navigateToFileManager(page1);
    await takeScreenshot(page1, '02_file_manager');

    // ========== STEP 3: Test Sort Controls ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Test Sort Controls');
    console.log('─'.repeat(50));

    if (results.fileManagerLoaded) {
      const sortResult = await testSortControls(page1);
      results.sortControlVisible = sortResult.visible;
      results.sortChangeWorks = sortResult.changeWorks;
      await takeScreenshot(page1, '03_sort_controls');
    }

    // ========== STEP 4: Test the Inspector ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Test the Inspector');
    console.log('─'.repeat(50));

    if (results.fileManagerLoaded) {
      results.inspectorOpens = await testInspector(page1);
      await takeScreenshot(page1, '04_inspector');
    }

    // ========== STEP 5: File Preview (skipped) ==========
    // FilePreviewDialog is the sidebar FILES section's dialog and it only opens
    // for a *completed incoming* file transfer (FilesSection filters
    // fileTransferService transfers on state === 'complete' && isIncoming).
    // This spec never performs a transfer, so the precondition does not exist —
    // the old version clicked a VFS grid item instead, which downloads a remote
    // file and opens no dialog at all. Covering this belongs in a spec that
    // actually sends a file (see file-transfer.test.ts).

    // STEP 6 and STEP 7 removed: they tested nothing about this product.
    //
    // Both located Vite's dev-server React URLs in performance entries,
    // dynamically imported StorageLimitModal / RevfsDisabledModal, and rendered
    // them into a detached root. That asserts a component can be imported and
    // mounted in isolation — not that the app ever shows it — and it only works
    // against a dev server, so it could never run on a production build.
    //
    // Both modals are state-dependent (storage limit reached; revfs disabled)
    // and this spec cannot produce either state. Reaching them for real needs a
    // fixture that can, which does not exist yet. Better absent than green.
    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Everything gated here is single-user and deterministic: account creation,
    // in-app navigation, and client-side rendering. p2pRegistered is the one
    // exception — it is a two-party handshake, and the file manager opens on
    // server storage without it, so it is reported but not gated.
    const corePassed =
      results.accountCreation.user1 &&
      results.accountCreation.user2 &&
      results.fileManagerLoaded &&
      results.sortControlVisible &&
      results.sortChangeWorks &&
      results.inspectorOpens;

    console.log(`\n  User1 Created:             ${results.accountCreation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User2 Created:             ${results.accountCreation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Registered:            ${results.p2pRegistered ? 'PASS' : 'CHECK'}  (not gated: P2P handshake timing)`);
    console.log(`  File Manager Loaded:       ${results.fileManagerLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Sort Control:              ${results.sortControlVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Sort Change:               ${results.sortChangeWorks ? 'PASS' : 'FAIL'}`);
    console.log(`  Inspector:                 ${results.inspectorOpens ? 'PASS' : 'FAIL'}`);
    console.log('  File Preview:              SKIP (needs a completed incoming transfer; this spec sends no files)');

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
