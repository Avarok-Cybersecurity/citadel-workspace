/**
 * RE-VFS Server Integration Test
 *
 * Tests the RE-VFS server storage functionality (client-to-server):
 * 1. Create a single user account
 * 2. Navigate to File Manager
 * 3. Confirm it opened on Server Storage (the sidebar's destination)
 * 4. Verify default tree (Received Files, Sent Files)
 * 5. Create folder in server storage
 * 6. Verify folder exists
 * 7. Delete folder
 * 8. Verify folder is gone
 *
 * Unlike P2P RE-VFS, server storage:
 * - Requires only one user (no P2P registration)
 * - Stores encrypted files on the Citadel server
 * - Has no peer sync (local tree + server backend)
 */

import { Page } from 'playwright';
import {
  sleep,
  createSeparateBrowsers,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  TestHarness,
  runTestMain,
  isHiddenWithin,
  fmItem,
  openFileManagerFromSidebar,
  createFolder,
  deleteItem,
  refreshFiles,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: boolean;
  navigation: boolean;
  switchToServerMode: boolean;
  defaultTree: boolean;
  folderCreation: boolean;
  folderDeletion: boolean;
  deletionPersisted: boolean;
  fileUpload: boolean;
  fileVisible: boolean;
  fileDeletion: boolean;
}

// ============================================================================
// Config
// ============================================================================

const timestamp = Date.now();
const USERNAME = `revfs_server_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;
const FOLDER_NAME = 'server-docs';

// ============================================================================
// Helpers
// ============================================================================

async function navigateToFileManager(page: Page): Promise<boolean> {
  console.log('\n=== Navigating to File Manager ===');
  if (!await waitForWorkspaceLoaded(page, 30000)) {
    console.log('  Workspace not fully loaded');
    return false;
  }
  const opened: boolean = await openFileManagerFromSidebar(page);
  console.log(`  File manager opened: ${opened}`);
  return opened;
}

/** The storage switch says Server is the one open: its segment is pressed. */
async function serverStorageIsOpen(page: Page): Promise<boolean> {
  console.log('\n=== Checking Server Storage is open ===');
  const open: boolean = await isVisibleWithin(page.locator('[data-testid="storage-server"][aria-pressed="true"]'), 5000);
  console.log(`  Server Storage open: ${open}`);
  return open;
}

async function waitForTreeLoaded(page: Page, timeoutMs = 30000): Promise<boolean> {
  console.log('\n=== Waiting for VFS tree ===');
  const loaded: boolean = await isVisibleWithin(fmItem(page, 'Sent Files'), timeoutMs);
  console.log(`  Tree loaded: ${loaded}`);
  return loaded;
}

async function verifyDefaultFolders(page: Page): Promise<boolean> {
  console.log('\n=== Verifying default folders ===');
  const hasSent = await isVisibleWithin(fmItem(page, 'Sent Files'), 5000);
  const hasReceived = await isVisibleWithin(fmItem(page, 'Received Files'), 5000);
  console.log(`  Sent Files visible: ${hasSent}`);
  console.log(`  Received Files visible: ${hasReceived}`);
  return hasSent && hasReceived;
}

async function createServerFolder(page: Page, folderName: string): Promise<boolean> {
  console.log(`\n=== Creating folder "${folderName}" ===`);
  const exists: boolean = await createFolder(page, folderName);
  console.log(`  Folder "${folderName}" listed: ${exists}`);
  return exists;
}

async function deleteFolder(page: Page, folderName: string): Promise<boolean> {
  console.log(`\n=== Deleting folder "${folderName}" ===`);
  if (!await deleteItem(page, folderName)) {
    console.log('  Delete was not offered or not confirmed');
    return false;
  }
  // Waited for as a state: a list that had not re-rendered yet must not read as
  // "folder gone". This value gates results.folderDeletion.
  const gone: boolean = await isHiddenWithin(fmItem(page, folderName), 5000);
  console.log(`  Folder still listed: ${!gone}`);
  return gone;
}

/** The status strip names the open storage. */
async function verifyServerStorageIndicator(page: Page): Promise<boolean> {
  console.log('\n=== Verifying Server Storage indicator ===');
  const visible: boolean = await isVisibleWithin(page.getByTestId('vfs-status-strip').getByText(/Server Storage/), 5000);
  console.log(`  Server storage indicator visible: ${visible}`);
  return visible;
}

async function refreshTree(page: Page): Promise<void> {
  console.log('\n=== Refreshing tree ===');
  console.log(`  Clicked refresh button: ${await refreshFiles(page)}`);
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'RE-VFS Server Integration Test',
    reportFileName: 'REVFS_SERVER_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  console.log(`User: ${USERNAME}`);
  console.log('');

  const { pages, cleanup } = await createSeparateBrowsers(1);

  const results: TestResults = {
    accountCreation: false,
    navigation: false,
    switchToServerMode: false,
    defaultTree: false,
    folderCreation: false,
    folderDeletion: false,
    deletionPersisted: false,
    fileUpload: false,
    fileVisible: false,
    fileDeletion: false,
  };

  try {
    const page = pages[0];

    setupConsoleCapture(page, 'User', ['error', 'Error', 'revfs', '[revfs]', 'server', 'Server']);

    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('─'.repeat(50));

    results.accountCreation = await createAccount(page, USERNAME, {
      isFirstUser: true, password: PASSWORD, uxTracker: harness.uxTracker,
    });

    await takeScreenshot(page, '01_account_created');

    if (!results.accountCreation) {
      throw new Error('Account creation failed');
    }

    console.log('\n  Waiting 5s for session to establish...');
    await sleep(5000);

    // ========== STEP 2: Navigate to File Manager ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Navigate to File Manager');
    console.log('─'.repeat(50));

    await closeAnyModals(page);
    results.navigation = await navigateToFileManager(page);

    await takeScreenshot(page, '02_file_manager');

    if (!results.navigation) {
      throw new Error('Navigation failed');
    }

    // ========== STEP 3: Switch to Server Storage Mode ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Switch to Server Storage Mode');
    console.log('─'.repeat(50));

    // The sidebar opens Server Storage: nothing to switch, only to confirm.
    results.switchToServerMode = await serverStorageIsOpen(page);

    await takeScreenshot(page, '03_server_mode');

    // Verify server storage indicator is visible
    const indicatorVisible = await verifyServerStorageIndicator(page);
    console.log(`  Server storage indicator: ${indicatorVisible}`);

    // ========== STEP 4: Verify Default Tree ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Verify Default Tree');
    console.log('─'.repeat(50));

    const treeLoaded = await waitForTreeLoaded(page);
    if (treeLoaded) {
      results.defaultTree = await verifyDefaultFolders(page);
    }

    await takeScreenshot(page, '04_default_tree');

    // ========== STEP 5: Create Folder ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Create Folder');
    console.log('─'.repeat(50));

    if (treeLoaded) {
      results.folderCreation = await createServerFolder(page, FOLDER_NAME);
      await takeScreenshot(page, '05_folder_created');

      // Refresh to verify persistence
      await refreshTree(page);
      const stillThere = await isVisibleWithin(fmItem(page, FOLDER_NAME), 5000);
      console.log(`  Folder persisted after refresh: ${stillThere}`);
    }

    // ========== STEP 6: Delete Folder ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Delete Folder');
    console.log('─'.repeat(50));

    if (results.folderCreation) {
      results.folderDeletion = await deleteFolder(page, FOLDER_NAME);
      await takeScreenshot(page, '06_folder_deleted');

      // Refresh to verify deletion persisted
      await refreshTree(page);
      // isHiddenWithin, not isVisible({ timeout }): the latter is an immediate
      // snapshot (Playwright declares that option ignored), so a tree that had
      // simply not re-rendered yet read as "folder gone" and the deletion looked
      // persisted whether or not it was.
      //
      // The result is also RECORDED now. It was previously computed into a local
      // and logged, and nothing consumed it — the line "Folder deletion
      // persisted: false" could print while the test passed, which is the same
      // as not checking that deletion survives a refresh at all.
      results.deletionPersisted = await isHiddenWithin(
        fmItem(page, FOLDER_NAME),
        5000
      );
      console.log(`  Folder deletion persisted: ${results.deletionPersisted}`);
    }

    // ========== RESULTS ==========
    await takeScreenshot(page, 'FINAL');

    const corePassed =
      results.accountCreation &&
      results.navigation &&
      results.switchToServerMode &&
      results.defaultTree &&
      results.folderCreation &&
      results.folderDeletion &&
      results.deletionPersisted;

    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));
    console.log('\nCore Tests:');
    console.log(`  Account Creation:       ${results.accountCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Navigation:             ${results.navigation ? 'PASS' : 'FAIL'}`);
    console.log(`  Switch to Server Mode:  ${results.switchToServerMode ? 'PASS' : 'FAIL'}`);
    console.log(`  Default Tree:           ${results.defaultTree ? 'PASS' : 'FAIL'}`);
    console.log(`  Folder Creation:        ${results.folderCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Folder Deletion:        ${results.folderDeletion ? 'PASS' : 'FAIL'}`);
    console.log(`  Deletion Persisted:     ${results.deletionPersisted ? 'PASS' : 'FAIL'}`);

    harness.finalize(corePassed, results);


    return corePassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
