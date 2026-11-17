/**
 * Tree Validator Integration Test
 *
 * Tests tree integrity validation through UI operations:
 * 1. Node Creation - Offices and rooms can be created
 * 2. Hierarchy Maintenance - Rooms appear under their parent office
 * 3. Cascade Delete - Deleting office deletes its rooms
 * 4. Node Verification - Nodes can be found/not found as expected
 *
 * Note: Protocol-level edge cases (cycle detection, orphan prevention) are
 * validated by the backend TreeValidator. This test validates the UI layer
 * properly uses the tree operations.
 */

import type { Page, Browser } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  TestHarness,
  runTestMain,
  // UI-based tree helpers
  getWorkspaceRootId,
  createOfficeViaUI,
  createRoomViaUI,
  navigateToOfficeViaUI,
  deleteNodeViaUI,
  nodeExistsInUI,
  nodeGoneFromUI,
  // Protocol reads — used only to verify what the UI actions actually did on
  // the server. The UI can only show you a name in a list; it cannot show you
  // which parent the server recorded.
  getNodeViaProtocol,
  getTreeStructure,
  type TreeNode,
  type DiagnosticsHandle,
} from '../lib/index.js';

/**
 * Find a node by name anywhere in a tree.
 *
 * `findNodeInTree` from the shared lib searches by id, and the UI helpers only
 * ever hand back names — the ids live in the `tree-node-<id>` testids, which is
 * a longer way round than just asking the server for the tree.
 */
function findNodeIdByName(tree: TreeNode, name: string): string | null {
  if (tree.node.name === name) return tree.node.id;
  for (const child of tree.children) {
    const found = findNodeIdByName(child, name);
    if (found) return found;
  }
  return null;
}

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Setup
  accountCreation: boolean;
  workspaceLoaded: boolean;
  /** The workspace root resolves to a real Workspace node on the server. */
  workspaceRootResolves: boolean;

  // Node Creation Tests
  officeCreated: boolean;
  roomCreated: boolean;
  roomUnderCorrectParent: boolean;

  // Node Verification Tests
  officeExistsAfterCreate: boolean;
  roomExistsAfterCreate: boolean;

  // Cascade Delete Tests
  officeDeletedWithCascade: boolean;
  roomDeletedByCascade: boolean;

  // Secondary Creation Tests (after delete)
  secondOfficeCreated: boolean;
  leafNodeDeletedWithoutCascade: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `tree_validator_${timestamp}`;
const TEST_OFFICE = `TestOffice_${timestamp}`;
const TEST_ROOM = `TestRoom_${timestamp}`;
const TEST_OFFICE_2 = `TestOffice2_${timestamp}`;

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE VALIDATOR INTEGRATION TEST',
    reportFileName: 'TREE_VALIDATOR_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    workspaceRootResolves: false,
    officeCreated: false,
    roomCreated: false,
    roomUnderCorrectParent: false,
    officeExistsAfterCreate: false,
    roomExistsAfterCreate: false,
    officeDeletedWithCascade: false,
    roomDeletedByCascade: false,
    secondOfficeCreated: false,
    leafNodeDeletedWithoutCascade: false,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;
  let diagnostics: DiagnosticsHandle | null = null;

  try {

    // Create browser
    const setup = await createBrowser();
    browser = setup.browser;
    page = await setup.context.newPage();

    // Start diagnostics
    diagnostics = await startDiagnostics(page);

    // ========================================================================
    // STEP 1: Create Admin Account
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 1: Create Admin Account');
    console.log('-'.repeat(50));

    results.accountCreation = await createAccount(page, ADMIN_USER, {
      isFirstUser: true,
    });

    if (!results.accountCreation) {
      throw new Error('Failed to create admin account');
    }

    // waitForWorkspaceLoaded returns whether the sidebar ever appeared; it does
    // not throw on timeout. Discarding it and assigning `true` made this a
    // result that could only ever print PASS, including on the run where the
    // workspace never loaded and everything after it failed for that reason.
    results.workspaceLoaded = await waitForWorkspaceLoaded(page);
    await takeScreenshot(page, `${ADMIN_USER}_admin_ready`);

    // ========================================================================
    // STEP 2: Get Workspace Root ID
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Get Workspace Root ID');
    console.log('-'.repeat(50));

    // `getWorkspaceRootId` cannot return null — it falls back to the
    // 'workspace-root' sentinel every server in this codebase understands. So
    // `!== null` asserted nothing and passed unconditionally. What is worth
    // asserting is that the id it hands back actually resolves to a Workspace
    // node on the server, which is what the rest of the test depends on.
    const workspaceRootId = await getWorkspaceRootId(page);
    console.log(`  Workspace root ID: ${workspaceRootId}`);
    const rootNode = workspaceRootId ? await getNodeViaProtocol(page, workspaceRootId) : null;
    results.workspaceRootResolves =
      rootNode !== null && rootNode.entity_type === 'Workspace' && rootNode.depth === 0;
    console.log(`  Workspace root resolves: ${results.workspaceRootResolves ? 'PASS' : 'FAIL'}`);

    // ========================================================================
    // STEP 3: Create Office Node
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Create Office Node');
    console.log('-'.repeat(50));

    const officeResult = await createOfficeViaUI(page, TEST_OFFICE, 'Test office description');
    results.officeCreated = officeResult.success;
    console.log(`  Office creation: ${results.officeCreated ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, `${ADMIN_USER}_office_created`);

    // ========================================================================
    // STEP 4: Verify Office Exists
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Verify Office Exists');
    console.log('-'.repeat(50));

    results.officeExistsAfterCreate = await nodeExistsInUI(page, TEST_OFFICE);
    console.log(`  Office exists: ${results.officeExistsAfterCreate ? 'PASS' : 'FAIL'}`);

    // ========================================================================
    // STEP 5: Navigate to Office and Create Room
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Navigate to Office and Create Room');
    console.log('-'.repeat(50));

    if (results.officeCreated) {
      const navigated = await navigateToOfficeViaUI(page, TEST_OFFICE);
      console.log(`  Navigation to office: ${navigated ? 'PASS' : 'FAIL'}`);

      if (navigated) {
        await sleep(1000);
        const roomResult = await createRoomViaUI(page, TEST_ROOM, 'Test room description', TEST_OFFICE);
        results.roomCreated = roomResult.success;
        console.log(`  Room creation: ${results.roomCreated ? 'PASS' : 'FAIL'}`);

        // Parentage is not something the sidebar can tell you. This assertion
        // used to be `nodeExistsInUI(TEST_ROOM)` — byte-for-byte the same call
        // as `roomExistsAfterCreate` two steps later — so a room created at the
        // workspace root instead of under the office would have passed it.
        // Ask the server what parent it actually recorded.
        const tree = await getTreeStructure(page);
        const officeId = tree ? findNodeIdByName(tree, TEST_OFFICE) : null;
        const roomId = tree ? findNodeIdByName(tree, TEST_ROOM) : null;
        if (officeId && roomId) {
          const roomNode = await getNodeViaProtocol(page, roomId);
          results.roomUnderCorrectParent =
            roomNode !== null && roomNode.parent_id === officeId;
          console.log(`  Room parent: ${roomNode?.parent_id} (expected office ${officeId})`);
        } else {
          console.log(`  Could not locate office/room in the server tree (office=${officeId}, room=${roomId})`);
        }
        console.log(`  Room under correct parent: ${results.roomUnderCorrectParent ? 'PASS' : 'FAIL'}`);
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_room_created`);

    // ========================================================================
    // STEP 6: Verify Room Exists
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: Verify Room Exists');
    console.log('-'.repeat(50));

    results.roomExistsAfterCreate = await nodeExistsInUI(page, TEST_ROOM);
    console.log(`  Room exists: ${results.roomExistsAfterCreate ? 'PASS' : 'FAIL'}`);

    // ========================================================================
    // STEP 7: Delete Office (Cascade Delete)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: Delete Office (Cascade Delete)');
    console.log('-'.repeat(50));

    if (results.officeCreated) {
      const deleteResult = await deleteNodeViaUI(page, TEST_OFFICE, 'Office');
      results.officeDeletedWithCascade = deleteResult.success;
      console.log(`  Office deleted: ${results.officeDeletedWithCascade ? 'PASS' : 'FAIL'}`);

      // Absence, asserted as absence. `!(await nodeExistsInUI(...))` waits the
      // full 10s appearance timeout for a node that is supposed to be gone;
      // nodeGoneFromUI waits for the opposite state and returns as soon as it
      // holds.
      results.roomDeletedByCascade = await nodeGoneFromUI(page, TEST_ROOM);
      console.log(`  Room deleted by cascade: ${results.roomDeletedByCascade ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_after_cascade_delete`);

    // ========================================================================
    // STEP 8: Create Second Office (Verify Tree Still Works)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Create Second Office (Verify Tree Still Works)');
    console.log('-'.repeat(50));

    const office2Result = await createOfficeViaUI(page, TEST_OFFICE_2, 'Second test office');
    results.secondOfficeCreated = office2Result.success;
    console.log(`  Second office created: ${results.secondOfficeCreated ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, `${ADMIN_USER}_second_office`);

    // ========================================================================
    // STEP 9: Delete Leaf Node (No Cascade Needed)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 9: Delete Leaf Node (No Cascade Needed)');
    console.log('-'.repeat(50));

    if (results.secondOfficeCreated) {
      // Office with no children should delete cleanly
      const deleteResult = await deleteNodeViaUI(page, TEST_OFFICE_2, 'Office');
      results.leafNodeDeletedWithoutCascade = deleteResult.success;
      console.log(`  Leaf node deleted: ${results.leafNodeDeletedWithoutCascade ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_final_state`);

  } catch (error) {
    console.error('\n[TEST ERROR]', error);
    uxTracker.log('critical', 'functional', `Test crashed: ${error}`);

    if (page) {
      await takeScreenshot(page, 'ERROR_state');
    }
  } finally {
    // Stop diagnostics
    if (diagnostics) {
      await diagnostics.stop();
    }

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    console.log('\nSetup:');
    console.log(`  Account Creation:           ${results.accountCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Loaded:           ${results.workspaceLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Root Resolves:    ${results.workspaceRootResolves ? 'PASS' : 'FAIL'}`);

    console.log('\nNode Creation:');
    console.log(`  Office Created:             ${results.officeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Created:               ${results.roomCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Under Correct Parent:  ${results.roomUnderCorrectParent ? 'PASS' : 'FAIL'}`);

    console.log('\nNode Verification:');
    console.log(`  Office Exists After Create: ${results.officeExistsAfterCreate ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Exists After Create:   ${results.roomExistsAfterCreate ? 'PASS' : 'FAIL'}`);

    console.log('\nCascade Delete:');
    console.log(`  Office Deleted With Cascade: ${results.officeDeletedWithCascade ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Deleted By Cascade:     ${results.roomDeletedByCascade ? 'PASS' : 'FAIL'}`);

    console.log('\nSecondary Tests:');
    console.log(`  Second Office Created:       ${results.secondOfficeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Leaf Node Deleted:           ${results.leafNodeDeletedWithoutCascade ? 'PASS' : 'FAIL'}`);

    // Every line this test prints above is now gated here. The old list read
    // six of the eleven results, so a room created under the wrong parent, an
    // office that vanished from the sidebar, or a leaf delete that silently
    // did nothing all printed FAIL and the run still exited green.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.workspaceRootResolves,
      results.officeCreated,
      results.roomCreated,
      results.roomUnderCorrectParent,
      results.officeExistsAfterCreate,
      results.roomExistsAfterCreate,
      results.officeDeletedWithCascade,
      results.roomDeletedByCascade,
      results.secondOfficeCreated,
      results.leafNodeDeletedWithoutCascade,
    ];

    const allCriticalPassed = criticalTests.every(Boolean);

    console.log('\n' + '='.repeat(60));
    console.log(`OVERALL: ${allCriticalPassed ? 'TEST PASSED' : 'TEST FAILED'}`);
    console.log('='.repeat(60));

    if (browser) {
      await browser.close();
    }

    harness.finalize(allCriticalPassed, results as unknown as Record<string, any>);
    return allCriticalPassed;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
