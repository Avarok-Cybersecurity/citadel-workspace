/**
 * File Manager Integration Test
 *
 * Comprehensive tests for the File Manager (RE-VFS) UI:
 * 1. Create two accounts and P2P register
 * 2. Navigate to File Manager (?section=files)
 * 3. Verify the P2P side offers no peers (before P2P setup)
 * 4. Verify tree loading after P2P connection
 * 5. Verify default folders (Sent Files, Received Files)
 * 6. Folder operations: create, navigate, sync, delete
 * 7. Context menu operations
 * 8. Breadcrumb navigation
 * 9. Peer synchronization verification
 */

import { Page } from 'playwright';
import {
  isHiddenWithin,
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  TestHarness,
  runTestMain,
  fmItem,
  openFileManagerFromSidebar,
  openPeerStorage,
  peerMenuOffersNobody,
  createFolder,
  openFolderItem,
  goToRoot,
  refreshFiles,
  openItemMenu,
  deleteItem,
  chooseFromNewMenu,
} from '../lib/index.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: { alice: boolean; bob: boolean };
  noPeersState: boolean;
  p2pSetup: { registered: boolean; accepted: boolean };
  navigation: { aliceToFileManager: boolean; bobToFileManager: boolean };
  treeLoading: { aliceTreeLoaded: boolean; bobTreeLoaded: boolean };
  defaultFolders: { aliceSeesFolders: boolean; bobSeesFolders: boolean };
  folderOperations: {
    createFolder: boolean;
    navigateIntoFolder: boolean;
    breadcrumbNavigation: boolean;
    syncFolder: boolean;
    deleteFolder: boolean;
    peerSeesChanges: boolean;
    /** The folder disappearing from the PEER after deletion, not just locally. */
    peerSeesFolderRemoved: boolean;
  };
  fileOperations: {
    uploadFile: boolean;
    fileVisible: boolean;
    peerSeesFile: boolean;
    deleteFile: boolean;
    fileRemoved: boolean;
    peerSeesFileRemoved: boolean;
  };
  contextMenu: {
    openContextMenu: boolean;
    /** The folder's own menu offers Open. */
    hasOpen: boolean;
    hasDelete: boolean;
  };
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ALICE = `fm_alice_${timestamp}`;
const BOB = `fm_bob_${timestamp}`;
const TEST_FOLDER = 'test-folder';
const TEST_FILE_NAME = 'test-document.txt';
const TEST_FILE_CONTENT = 'Hello, RE-VFS! This is a test file.';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Open the file manager from the sidebar, which lands on Server Storage, then --
 * when `peer` is given -- that peer's shared storage through the P2P menu. The
 * file manager no longer picks a peer for you, so a spec says whose files it means.
 */
async function navigateToFileManager(page: Page, label: string, peer: string | null): Promise<boolean> {
  console.log(`\n=== ${label}: Navigating to File Manager${peer ? ` (shared with ${peer})` : ''} ===`);
  try {
    if (!await waitForWorkspaceLoaded(page, 30000)) {
      console.log('  Workspace not fully loaded');
      return false;
    }
    await closeAnyModals(page);
    if (!await openFileManagerFromSidebar(page)) {
      console.log('  File manager did not open from the sidebar');
      return false;
    }
    if (peer === null) return true;
    const opened: boolean = await openPeerStorage(page, peer);
    console.log(`  Opened storage shared with ${peer}: ${opened}`);
    return opened;
  } catch (error) {
    console.error(`  Error navigating: ${error}`);
    return false;
  }
}

/**
 * Before registration the P2P side has nobody to share with, and says so.
 */
async function checkNoPeersState(page: Page, label: string): Promise<boolean> {
  console.log(`\n=== ${label}: Checking the P2P menu offers no peers ===`);
  const nobody: boolean = await peerMenuOffersNobody(page);
  console.log(`  "No peers yet" offered: ${nobody}`);
  return nobody;
}

/**
 * Wait for the VFS tree to load: its default Sent Files folder is listed.
 */
async function waitForTreeLoaded(page: Page, label: string, timeoutMs = 30000): Promise<boolean> {
  console.log(`\n=== ${label}: Waiting for VFS tree to load ===`);
  const loaded: boolean = await isVisibleWithin(fmItem(page, 'Sent Files'), timeoutMs);
  if (!loaded && await page.getByText('File System Error').isVisible().catch(() => false)) {
    console.log('  Error: File System Error displayed');
  }
  console.log(`  Tree loaded: ${loaded}`);
  return loaded;
}

/**
 * Verify default folders exist
 */
async function verifyDefaultFolders(page: Page, label: string): Promise<boolean> {
  console.log(`\n=== ${label}: Verifying default folders ===`);
  const hasSent = await isVisibleWithin(fmItem(page, 'Sent Files'), 5000);
  const hasReceived = await isVisibleWithin(fmItem(page, 'Received Files'), 5000);
  console.log(`  Sent Files: ${hasSent}, Received Files: ${hasReceived}`);
  return hasSent && hasReceived;
}

/**
 * Create a folder through the New menu
 */
async function createFolderViaToolbar(page: Page, label: string, folderName: string): Promise<boolean> {
  console.log(`\n=== ${label}: Creating folder "${folderName}" ===`);
  const visible: boolean = await createFolder(page, folderName);
  console.log(`  Folder "${folderName}" listed: ${visible}`);
  return visible;
}

/**
 * Open a folder (double-click: a single click selects it)
 */
async function navigateIntoFolder(page: Page, label: string, folderName: string): Promise<boolean> {
  console.log(`\n=== ${label}: Navigating into folder "${folderName}" ===`);
  const inside: boolean = await openFolderItem(page, folderName);
  console.log(`  Address bar names the folder: ${inside}`);
  return inside;
}

/**
 * Back to the top level by the Root crumb. A breadcrumb that was already at the
 * top cannot pass by staying there: Up must have been enabled first.
 */
async function navigateViaBreadcrumb(page: Page, label: string): Promise<boolean> {
  console.log(`\n=== ${label}: Navigating via breadcrumb to Root ===`);
  const { wasDeeper, atRoot } = await goToRoot(page);
  console.log(`  Back at root: ${atRoot} (was in a folder: ${wasDeeper})`);
  return wasDeeper && atRoot;
}

/**
 * Click the address bar's refresh ("Sync with peer" in shared storage)
 */
async function clickSyncButton(page: Page, label: string): Promise<boolean> {
  console.log(`\n=== ${label}: Clicking Sync button ===`);
  const clicked: boolean = await refreshFiles(page);
  console.log(`  Sync clicked: ${clicked}`);
  return clicked;
}

/**
 * Open the context menu on a folder: it offers Open and Delete.
 */
async function openContextMenu(page: Page, label: string, folderName: string): Promise<{ opened: boolean; hasOpen: boolean; hasDelete: boolean }> {
  console.log(`\n=== ${label}: Opening context menu on "${folderName}" ===`);
  const menu = await openItemMenu(page, folderName);
  if (menu === null) {
    console.log('  Menu did not open');
    return { opened: false, hasOpen: false, hasDelete: false };
  }
  const hasOpen: boolean = await isVisibleWithin(menu.getByRole('menuitem', { name: 'Open', exact: true }), 1000);
  const hasDelete: boolean = await isVisibleWithin(menu.getByTestId('vfs-delete'), 1000);
  console.log(`  Open: ${hasOpen}, Delete: ${hasDelete}`);
  await page.keyboard.press('Escape');
  await isHiddenWithin(menu, 3000);
  return { opened: true, hasOpen, hasDelete };
}

/**
 * Delete a folder via context menu
 */
async function deleteFolderViaContextMenu(page: Page, label: string, folderName: string): Promise<boolean> {
  console.log(`\n=== ${label}: Deleting folder "${folderName}" ===`);
  if (!await deleteItem(page, folderName)) {
    console.log('  Delete was not offered or not confirmed');
    return false;
  }
  // Fifteen seconds, measured rather than guessed: `revfsService.rmdir` takes a
  // per-peer serial lock and queues behind the previous step's peer ack and its
  // orphaned-byte sweep -- the deletion was seen starting 7.8s after the confirm.
  const gone: boolean = await isHiddenWithin(fmItem(page, folderName), 15_000);
  console.log(`  Folder deleted from the list: ${gone}`);
  return gone;
}

/**
 * Verify peer sees folder changes after sync (with retry)
 */
async function verifyPeerSeesChanges(page: Page, label: string, folderName: string, shouldExist: boolean): Promise<boolean> {
  console.log(`\n=== ${label}: Sync and check folder "${folderName}" (expect ${shouldExist ? 'present' : 'absent'}) ===`);

  // Wait for the state we expect, rather than sleeping and sampling once.
  //
  // Each attempt used to sleep and then call isVisible({ timeout }), which does
  // not wait at all — so whether propagation was seen came down to whether it
  // happened to land inside a fixed 4/5/6 second sleep. That is why this was
  // flaky in BOTH directions: one run the folder had not arrived yet, the next
  // run it had not gone away yet, and neither was a product failure.
  //
  // isHiddenWithin for the absent case: waiting for something to appear and
  // waiting for it to go away are different questions, and using the presence
  // helper for both would report "not there yet" as success.
  const target = () => fmItem(page, folderName);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickSyncButton(page, label);

    const result = shouldExist
      ? await isVisibleWithin(target(), 15_000)
      : await isHiddenWithin(target(), 15_000);

    console.log(`  Attempt ${attempt}: expected ${shouldExist ? 'visible' : 'hidden'}: ${result ? 'PASS' : 'retry...'}`);
    if (result) return true;
  }

  const finalVisible = await isVisibleWithin(fmItem(page, folderName), 2000);
  const finalResult = shouldExist ? finalVisible : !finalVisible;
  console.log(`  Final result: Folder visible: ${finalVisible}, expected ${shouldExist ? 'visible' : 'hidden'}: ${finalResult ? 'PASS' : 'FAIL'}`);

  if (!finalResult && !shouldExist) {
    // getByText matches the whole page, so a name left in a breadcrumb or a
    // toast looks identical to a row that never went away. Report where it
    // actually is, so this says which.
    const where = await page.evaluate((name) => {
      const out: string[] = [];
      for (const el of Array.from(document.querySelectorAll('*'))) {
        if (el.children.length) continue;
        if ((el.textContent || '').trim() !== name) continue;
        const path: string[] = [];
        for (let e: Element | null = el; e && path.length < 5; e = e.parentElement) {
          path.push(`${e.tagName.toLowerCase()}${e.getAttribute('data-testid') ? `[${e.getAttribute('data-testid')}]` : ''}`);
        }
        out.push(path.join(' < '));
      }
      return out;
    }, folderName);
    console.log(`  STILL-PRESENT AT: ${JSON.stringify(where)}`);
  }

  return finalResult;
}

// ============================================================================
// File Operation Helper Functions
// ============================================================================

/**
 * Upload a file into the open folder through New > Upload files.
 * The caller has already opened `targetDir`; the file is looked for there.
 */
async function uploadFileViaToolbar(page: Page, label: string, fileName: string, content: string): Promise<boolean> {
  console.log(`\n=== ${label}: Uploading file "${fileName}" ===`);
  try {
    // Armed BEFORE the click or the event races us. The no-op catch marks an
    // abandoned wait handled: an unhandled rejection takes the whole node
    // process down and the spec reports NO VERDICT.
    const fileChooserPromise = page.waitForEvent('filechooser', { timeout: 10000 });
    fileChooserPromise.catch(() => undefined);
    if (!await chooseFromNewMenu(page, 'upload')) {
      console.log('  Upload files was not offered');
      return false;
    }
    const fileChooser = await fileChooserPromise;
    const buffer = Buffer.from(content, 'utf-8');
    await fileChooser.setFiles({ name: fileName, mimeType: 'text/plain', buffer });
    console.log(`  Set file: ${fileName} (${buffer.length} bytes)`);
    const fileVisible: boolean = await isVisibleWithin(fmItem(page, fileName), 10000);
    console.log(`  File "${fileName}" listed: ${fileVisible}`);
    return fileVisible;
  } catch (error) {
    console.error(`  Error uploading file: ${error}`);
    return false;
  }
}

/**
 * Verify a file is listed in the open folder
 */
async function verifyFileVisible(page: Page, label: string, fileName: string): Promise<boolean> {
  console.log(`\n=== ${label}: Verifying file "${fileName}" is visible ===`);
  const visible: boolean = await isVisibleWithin(fmItem(page, fileName), 5000);
  console.log(`  File visible: ${visible}`);
  return visible;
}

/**
 * Delete a file via context menu
 */
async function deleteFileViaContextMenu(page: Page, label: string, fileName: string): Promise<boolean> {
  console.log(`\n=== ${label}: Deleting file "${fileName}" ===`);
  if (!await deleteItem(page, fileName)) {
    console.log('  Delete was not offered or not confirmed');
    return false;
  }
  const gone: boolean = await isHiddenWithin(fmItem(page, fileName), 6000);
  console.log(`  File deleted: ${gone}`);
  return gone;
}

/**
 * Verify peer sees file changes after sync
 */
async function verifyPeerSeesFile(
  page: Page,
  label: string,
  fileName: string,
  shouldExist: boolean
): Promise<boolean> {
  console.log(`\n=== ${label}: Sync and check file "${fileName}" (expect ${shouldExist ? 'present' : 'absent'}) ===`);

  for (let attempt = 1; attempt <= 3; attempt++) {
    await clickSyncButton(page, label);

    // The two directions need opposite treatment, and a blanket
    // "replace the sleeps with waits" sweep would flatten them.
    //
    // Waiting for a file to APPEAR needs no fixed delay at all:
    // `isVisibleWithin` polls, so it returns the moment the file lands and no
    // later than its timeout. Sleeping first and then polling spends the sleep
    // every time and buys nothing.
    //
    // Confirming a file is ABSENT needs exactly that delay: one that has not
    // arrived yet looks identical to one that is gone, so without a settle
    // period the negative is not evidence. Same total patience either way --
    // the difference is that the positive case can finish early.
    const settle: number = 3000 + attempt * 1000;
    if (!shouldExist) await sleep(settle);

    const visible = await isVisibleWithin(
      fmItem(page, fileName),
      shouldExist ? settle + 5000 : 5000,
    );
    const result = shouldExist ? visible : !visible;

    console.log(`  Attempt ${attempt}: File visible: ${visible}, expected ${shouldExist ? 'visible' : 'hidden'}: ${result ? 'PASS' : 'retry...'}`);

    if (result) {
      return true;
    }

    if (attempt < 3) {
      console.log(`  Retrying sync...`);
    }
  }

  const finalVisible = await isVisibleWithin(fmItem(page, fileName), 2000);
  const finalResult = shouldExist ? finalVisible : !finalVisible;
  console.log(`  Final result: File visible: ${finalVisible}, expected ${shouldExist ? 'visible' : 'hidden'}: ${finalResult ? 'PASS' : 'FAIL'}`);
  return finalResult;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'File Manager Integration Test',
    reportFileName: 'FILE_MANAGER_TEST_REPORT.json',
    metadata: { alice: ALICE, bob: BOB },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`User 1 (Alice): ${ALICE}`);
  console.log(`User 2 (Bob): ${BOB}`);
  console.log('');

  const { pages, cleanup } = await createSeparateBrowsers(2);
  const page1 = pages[0];
  const page2 = pages[1];

  const results: TestResults = {
    accountCreation: { alice: false, bob: false },
    noPeersState: false,
    p2pSetup: { registered: false, accepted: false },
    navigation: { aliceToFileManager: false, bobToFileManager: false },
    treeLoading: { aliceTreeLoaded: false, bobTreeLoaded: false },
    defaultFolders: { aliceSeesFolders: false, bobSeesFolders: false },
    folderOperations: {
      createFolder: false,
      navigateIntoFolder: false,
      breadcrumbNavigation: false,
      syncFolder: false,
      deleteFolder: false,
      peerSeesChanges: false,
      peerSeesFolderRemoved: false,
    },
    fileOperations: {
      uploadFile: false,
      fileVisible: false,
      peerSeesFile: false,
      deleteFile: false,
      fileRemoved: false,
      peerSeesFileRemoved: false,
    },
    contextMenu: {
      openContextMenu: false,
      hasOpen: false,
      hasDelete: false,
    },
  };

  try {
    setupConsoleCapture(page1, 'Alice', ['error', 'Error', 'revfs', 'RE-VFS', 'ILM']);
    setupConsoleCapture(page2, 'Bob', ['error', 'Error', 'revfs', 'RE-VFS', 'ILM']);

    // ========== STEP 1: Create accounts ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Account Creation');
    console.log('─'.repeat(50));

    results.accountCreation.alice = await createAccount(page1, ALICE, { isFirstUser: true, uxTracker });
    await takeScreenshot(page1, '01_alice_created');

    results.accountCreation.bob = await createAccount(page2, BOB, { isFirstUser: false, uxTracker });
    await takeScreenshot(page2, '01_bob_created');

    console.log('\n  Waiting 5s for sessions to establish...');
    await sleep(5000);

    // ========== STEP 2: File Manager - No Peers State (BEFORE any P2P activity) ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: File Manager - No Peers State');
    console.log('─'.repeat(50));

    // Before any P2P registration the P2P side has nobody to offer.
    results.navigation.aliceToFileManager = await navigateToFileManager(page1, 'Alice', null);
    results.noPeersState = await checkNoPeersState(page1, 'Alice');
    await takeScreenshot(page1, '02_no_peers_state');

    // Navigate Alice back to workspace for P2P registration
    console.log('\n  Navigating Alice back to workspace...');
    // `workspace-button` and `sidebar-workspace` were in this union and the app
    // has never rendered either, so the text matcher was doing all of the work.
    // It is left alone deliberately: CI shows it matching and the click
    // working, and `has-text` is a SUBSTRING match, so "Configure Workspace"
    // and "Join New Workspace" are both candidates for `.first()`. Which one it
    // actually hits needs a run to observe, and guessing at a replacement here
    // would trade a selector that works for one that might not.
    const workspaceBtn = page1.locator('button:has-text("Workspace")');
    if (await workspaceBtn.first().isVisible().catch(() => false)) {
      await workspaceBtn.first().click();
      console.log('  Clicked Workspace sidebar button');
    } else {
      await page1.goBack();
      console.log('  Used goBack() to return to workspace');
    }
    await waitForWorkspaceLoaded(page1, 30000);

    // ========== STEP 3: P2P Registration ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: P2P Registration');
    console.log('─'.repeat(50));

    await closeAnyModals(page1);
    results.p2pSetup.registered = await p2pRegister(page1, ALICE, BOB, { uxTracker });
    await takeScreenshot(page1, '03_p2p_registered');

    // CRITICAL: Close any modals that might be blocking (Peer Discovery modal)
    console.log('  Closing any modals after P2P registration...');
    await closeAnyModals(page1);
    await sleep(1000);

    // ========== STEP 4: Accept P2P Request ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Accept P2P Request');
    console.log('─'.repeat(50));

    await sleep(3000);
    results.p2pSetup.accepted = await acceptP2PRequest(page2, BOB, uxTracker, ALICE);
    await takeScreenshot(page2, '04_p2p_accepted');

    // CRITICAL: Close any modals that might be blocking (Pending Requests modal)
    console.log('  Closing any modals after P2P acceptance...');
    await closeAnyModals(page2);
    await sleep(1000);

    console.log('\n  Waiting 5s for P2P connection...');
    await sleep(5000);

    // ========== STEP 5: File Manager - Tree Loading ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: File Manager - Tree Loading');
    console.log('─'.repeat(50));

    // Alice needs to navigate to File Manager (should now show tree since P2P is connected)
    // Close any remaining modals first
    await closeAnyModals(page1);
    results.navigation.aliceToFileManager = await navigateToFileManager(page1, 'Alice', BOB);
    results.treeLoading.aliceTreeLoaded = await waitForTreeLoaded(page1, 'Alice', 30000);
    await takeScreenshot(page1, '05_alice_tree_loaded');

    // Bob needs to go to File Manager (should now show tree since P2P is connected)
    results.navigation.bobToFileManager = await navigateToFileManager(page2, 'Bob', ALICE);
    results.treeLoading.bobTreeLoaded = await waitForTreeLoaded(page2, 'Bob', 30000);
    await takeScreenshot(page2, '05_bob_tree_loaded');

    // ========== STEP 6: Verify Default Folders ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Verify Default Folders');
    console.log('─'.repeat(50));

    results.defaultFolders.aliceSeesFolders = await verifyDefaultFolders(page1, 'Alice');
    results.defaultFolders.bobSeesFolders = await verifyDefaultFolders(page2, 'Bob');

    // ========== STEP 7: Folder Operations ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Folder Operations');
    console.log('─'.repeat(50));

    results.folderOperations.createFolder = await createFolderViaToolbar(page1, 'Alice', TEST_FOLDER);
    await takeScreenshot(page1, '07_folder_created');

    if (results.folderOperations.createFolder) {
      results.folderOperations.navigateIntoFolder = await navigateIntoFolder(page1, 'Alice', TEST_FOLDER);
      await takeScreenshot(page1, '07_in_folder');
    }

    results.folderOperations.breadcrumbNavigation = await navigateViaBreadcrumb(page1, 'Alice');
    await takeScreenshot(page1, '07_breadcrumb');

    results.folderOperations.syncFolder = await clickSyncButton(page1, 'Alice');
    results.folderOperations.peerSeesChanges = await verifyPeerSeesChanges(page2, 'Bob', TEST_FOLDER, true);
    await takeScreenshot(page2, '07_bob_sees_folder');

    // ========== STEP 8: Context Menu ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 8: Context Menu');
    console.log('─'.repeat(50));

    const contextResult = await openContextMenu(page1, 'Alice', TEST_FOLDER);
    results.contextMenu.openContextMenu = contextResult.opened;
    results.contextMenu.hasOpen = contextResult.hasOpen;
    results.contextMenu.hasDelete = contextResult.hasDelete;
    await takeScreenshot(page1, '08_context_menu');

    // ========== STEP 9: File Operations - Upload ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 9: File Operations - Upload');
    console.log('─'.repeat(50));

    // Upload into test-folder, opened first so the upload has a known destination.
    results.fileOperations.uploadFile = await navigateIntoFolder(page1, 'Alice', TEST_FOLDER)
      && await uploadFileViaToolbar(page1, 'Alice', TEST_FILE_NAME, TEST_FILE_CONTENT);
    await takeScreenshot(page1, '09_file_uploaded');

    // Verify file is visible on Alice's side
    results.fileOperations.fileVisible = await verifyFileVisible(page1, 'Alice', TEST_FILE_NAME);

    // Bob also needs to navigate to test-folder to see the file
    await navigateIntoFolder(page2, 'Bob', TEST_FOLDER);

    // Sync and verify Bob sees the file
    results.fileOperations.peerSeesFile = await verifyPeerSeesFile(page2, 'Bob', TEST_FILE_NAME, true);
    await takeScreenshot(page2, '09_bob_sees_file');

    // ========== STEP 10: File Operations - Delete ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 10: File Operations - Delete');
    console.log('─'.repeat(50));

    // Delete the file
    results.fileOperations.deleteFile = await deleteFileViaContextMenu(page1, 'Alice', TEST_FILE_NAME);
    await takeScreenshot(page1, '10_file_deleted');

    // Verify file is removed on Alice's side
    results.fileOperations.fileRemoved = !await verifyFileVisible(page1, 'Alice', TEST_FILE_NAME);

    // Sync and verify Bob sees the file is gone.
    //
    // Only meaningful if Bob ever saw it. `verifyPeerSeesFile(..., false)`
    // returns true when the name is absent, and a file that never arrived is
    // absent too -- so on the run that found this, "Peer Sees File: FAIL" was
    // followed by "Peer Sees File Removed: PASS", and the second line carried
    // no information at all. A check that cannot fail in the state that matters
    // is worse than a missing one, because it reads as evidence.
    results.fileOperations.peerSeesFileRemoved = results.fileOperations.peerSeesFile
      ? await verifyPeerSeesFile(page2, 'Bob', TEST_FILE_NAME, false)
      : false;
    if (!results.fileOperations.peerSeesFile) {
      console.log(
        '  Skipped the removal check: Bob never saw the file, so its absence proves nothing.',
      );
    }
    await takeScreenshot(page2, '10_bob_file_gone');

    // ========== STEP 11: Delete Folder ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 11: Delete Folder');
    console.log('─'.repeat(50));

    // Both are still inside test-folder: the folder is listed, and so can be
    // deleted or be seen gone, only from the level that holds it. Without this
    // Bob's "absent" would hold inside the folder whether or not it was deleted.
    await navigateViaBreadcrumb(page1, 'Alice');
    await navigateViaBreadcrumb(page2, 'Bob');
    results.folderOperations.deleteFolder = await deleteFolderViaContextMenu(page1, 'Alice', TEST_FOLDER);
    await takeScreenshot(page1, '09_folder_deleted');

    results.folderOperations.peerSeesFolderRemoved =
      await verifyPeerSeesChanges(page2, 'Bob', TEST_FOLDER, false);
    await takeScreenshot(page2, '09_bob_folder_gone');

    await takeScreenshot(page1, 'FINAL_alice');
    await takeScreenshot(page2, 'FINAL_bob');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    const allPassed =
      results.accountCreation.alice &&
      results.accountCreation.bob &&
      results.noPeersState &&
      results.p2pSetup.registered &&
      results.p2pSetup.accepted &&
      results.treeLoading.aliceTreeLoaded &&
      results.treeLoading.bobTreeLoaded &&
      results.defaultFolders.aliceSeesFolders &&
      results.defaultFolders.bobSeesFolders &&
      results.folderOperations.createFolder &&
      results.folderOperations.navigateIntoFolder &&
      results.folderOperations.breadcrumbNavigation &&
      results.folderOperations.deleteFolder &&
      results.fileOperations.uploadFile &&
      results.fileOperations.fileVisible &&
      results.fileOperations.deleteFile &&
      results.fileOperations.fileRemoved &&
      results.contextMenu.openContextMenu &&
      // Peer propagation is the whole point of a peer-to-peer filesystem, and
      // none of it was gated: a folder could fail to reach Bob, or a file could
      // fail to disappear from Bob, and this spec still reported PASS. These two
      // hold reliably once the checks actually wait.
      results.folderOperations.peerSeesChanges &&
      results.fileOperations.peerSeesFileRemoved &&
      // Bob reaching the file manager at all, and seeing a file Alice uploaded.
      // Both were computed and left out of the gate.
      results.navigation.bobToFileManager &&
      results.fileOperations.peerSeesFile;
      // peerSeesFolderRemoved is deliberately NOT gated — see the note where it
      // is reported.

    // CHECK is advisory and FAIL is fatal, and three criteria that decide the
    // run printed CHECK. The last run reported PASS on every visible line and
    // then "OVERALL: TEST FAILED", which tells a reader nothing: the run had in
    // fact failed on "Peer Sees File", printed as CHECK. Anything `allPassed`
    // reads says FAIL when it is false; only genuinely ungated observations
    // stay CHECK.
    console.log('\nAccount Creation:');
    console.log(`  Alice:                     ${results.accountCreation.alice ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob:                       ${results.accountCreation.bob ? 'PASS' : 'FAIL'}`);

    console.log('\nFile Manager States:');
    console.log(`  No Peers State:            ${results.noPeersState ? 'PASS' : 'FAIL'}`);

    console.log('\nP2P Setup:');
    console.log(`  Registered:                ${results.p2pSetup.registered ? 'PASS' : 'FAIL'}`);
    console.log(`  Accepted:                  ${results.p2pSetup.accepted ? 'PASS' : 'FAIL'}`);

    console.log('\nTree Loading:');
    console.log(`  Alice Tree Loaded:         ${results.treeLoading.aliceTreeLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Tree Loaded:           ${results.treeLoading.bobTreeLoaded ? 'PASS' : 'FAIL'}`);

    console.log('\nDefault Folders:');
    console.log(`  Alice Sees Folders:        ${results.defaultFolders.aliceSeesFolders ? 'PASS' : 'FAIL'}`);
    console.log(`  Bob Sees Folders:          ${results.defaultFolders.bobSeesFolders ? 'PASS' : 'FAIL'}`);

    console.log('\nFolder Operations:');
    console.log(`  Create Folder:             ${results.folderOperations.createFolder ? 'PASS' : 'FAIL'}`);
    console.log(`  Navigate Into Folder:      ${results.folderOperations.navigateIntoFolder ? 'PASS' : 'FAIL'}`);
    console.log(`  Breadcrumb Navigation:     ${results.folderOperations.breadcrumbNavigation ? 'PASS' : 'FAIL'}`);
    console.log(`  Sync Folder:               ${results.folderOperations.syncFolder ? 'PASS' : 'CHECK'}`);
    console.log(`  Delete Folder:             ${results.folderOperations.deleteFolder ? 'PASS' : 'FAIL'}`);
    // KNOWN GAP, not a flake and not a test bug. Reproduced on consecutive runs
    // once the check actually waits (it used to sleep and sample once, which is
    // what hid this). Deleting a folder does not reach the peer, while deleting
    // a FILE does — peerSeesFileRemoved passes in the same runs.
    //
    // Two things point at the cause. In one run Alice emitted no Rmdir at all,
    // only SyncResponse traffic; serverRmdir (revfs-dir-ops.ts:98) computes the
    // operation and throws it away — `const [newTree] = treeRmdir(...)` — where
    // peerRmdir keeps it and calls sendAndAwaitAck. And because mergeTrees is a
    // union that only ever adds, a removal that is missed once can never be
    // recovered by a later sync: the peer's copy wins every time.
    //
    // Left ungated rather than made to pass: whether directory deletion is meant
    // to propagate in server-backed mode is a product decision about revfs
    // semantics, not something to settle from a test.
    console.log(`  Peer Sees Folder Removed:  ${results.folderOperations.peerSeesFolderRemoved ? 'PASS' : 'KNOWN GAP (see note above)'}`);
    console.log(`  Peer Sees Changes:         ${results.folderOperations.peerSeesChanges ? 'PASS' : 'FAIL'}`);

    console.log('\nFile Operations:');
    console.log(`  Upload File:               ${results.fileOperations.uploadFile ? 'PASS' : 'FAIL'}`);
    console.log(`  File Visible:              ${results.fileOperations.fileVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Peer Sees File:            ${results.fileOperations.peerSeesFile ? 'PASS' : 'FAIL'}`);
    console.log(`  Delete File:               ${results.fileOperations.deleteFile ? 'PASS' : 'FAIL'}`);
    console.log(`  File Removed:              ${results.fileOperations.fileRemoved ? 'PASS' : 'FAIL'}`);
    console.log(
      `  Peer Sees File Removed:    ${
        results.fileOperations.peerSeesFileRemoved
          ? 'PASS'
          : results.fileOperations.peerSeesFile
            ? 'FAIL'
            : 'NOT CHECKED (the peer never saw the file)'
      }`,
    );

    // Gated, and never printed: a run could fail on this alone and the report
    // showed nothing but passes above a bare "OVERALL: TEST FAILED".
    console.log('\nNavigation:');
    console.log(`  Bob Reaches File Manager:  ${results.navigation.bobToFileManager ? 'PASS' : 'FAIL'}`);

    console.log('\nContext Menu:');
    console.log(`  Open Context Menu:         ${results.contextMenu.openContextMenu ? 'PASS' : 'FAIL'}`);
    console.log(`  Open Option:               ${results.contextMenu.hasOpen ? 'PASS' : 'CHECK'}`);
    console.log(`  Delete Option:             ${results.contextMenu.hasDelete ? 'PASS' : 'CHECK'}`);

    harness.finalize(allPassed, results);


    return allPassed;

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
