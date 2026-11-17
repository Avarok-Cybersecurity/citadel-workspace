/**
 * Tree Cascade Delete Integration Test
 *
 * Tests the delete behavior of the tree hierarchy:
 * 1. Leaf Node Delete - Delete room with no children
 * 2. Cascade Delete - Delete office with children (cascade: true)
 * 3. Deep Cascade Delete - Delete node with 5-level deep descendants
 * 4. Non-Cascade Delete (Must Fail) - Attempt delete with children (cascade: false)
 * 5. Delete Workspace Root (Must Fail) - Workspace root cannot be deleted
 *
 * This test validates protocol-level delete operations via tree-helpers.
 */

import type { Page, Browser } from 'playwright';
import {
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  type DiagnosticsHandle,
  // Tree helpers
  createNodeViaProtocol,
  deleteNodeViaProtocol,
  getWorkspaceRootId,
  createDeepHierarchy,
  verifyNodeExists,
  verifyNodeDeleted,
  getNodeViaProtocol,
  createSiblingNodes,
  listNodesViaProtocol,
  // Test framework
  TestHarness,
  runTestMain,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Setup
  accountCreation: boolean;
  workspaceLoaded: boolean;
  /** The workspace root id resolves to a real Workspace node on the server. */
  workspaceRootResolves: boolean;

  // Test 1 — leaf delete
  leafNodeDelete: boolean;
  leafNodeGone: boolean;
  leafNodeParentUpdated: boolean;

  // Test 2 — cascade, single child
  cascadeDeleteSingleChild: boolean;
  cascadeSingleChildGone: boolean;
  cascadeSingleChildReported: boolean;

  // Test 3 — cascade, multiple children
  cascadeDeleteMultipleChildren: boolean;
  cascadeMultipleChildrenGone: boolean;
  cascadeDeleteCountCorrect: boolean;

  // Test 4 — deep cascade
  deepHierarchyBuilt: boolean;
  deepCascadeDelete: boolean;
  deepCascadeDescendantsGone: boolean;
  deepCascadeCountCorrect: boolean;
  workspaceStillExists: boolean;

  // Test 5 — non-cascade delete must be refused
  nonCascadeDeleteFailed: boolean;
  nonCascadeErrorNamesChildren: boolean;
  childrenStillExistAfterNonCascade: boolean;

  // Test 6 — root delete must be refused
  workspaceRootDeleteFailed: boolean;
  workspaceRootSurvivesDeleteAttempt: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `cascade_admin_${timestamp}`;

/** Levels the deep-cascade case builds. Named so the assertion and the log agree. */
const DEEP_CASCADE_LEVELS = 5;

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE CASCADE DELETE INTEGRATION TEST',
    reportFileName: 'TREE_CASCADE_DELETE_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    workspaceRootResolves: false,
    leafNodeDelete: false,
    leafNodeGone: false,
    leafNodeParentUpdated: false,
    cascadeDeleteSingleChild: false,
    cascadeSingleChildGone: false,
    cascadeSingleChildReported: false,
    cascadeDeleteMultipleChildren: false,
    cascadeMultipleChildrenGone: false,
    cascadeDeleteCountCorrect: false,
    deepHierarchyBuilt: false,
    deepCascadeDelete: false,
    deepCascadeDescendantsGone: false,
    deepCascadeCountCorrect: false,
    workspaceStillExists: false,
    nonCascadeDeleteFailed: false,
    nonCascadeErrorNamesChildren: false,
    childrenStillExistAfterNonCascade: false,
    workspaceRootDeleteFailed: false,
    workspaceRootSurvivesDeleteAttempt: false,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;
  let diagnostics: DiagnosticsHandle | null = null;
  let workspaceRootId: string | null = null;

  try {

    // Create browser
    const setup = await createBrowser();
    browser = setup.browser;
    page = await setup.context.newPage();

    // Start diagnostics
    diagnostics = await startDiagnostics(page);

    // ========================================================================
    // SETUP: Create Admin Account
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('SETUP: Create Admin Account');
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

    // `getWorkspaceRootId` falls back to the 'workspace-root' sentinel and so
    // can never return null — `!== null` was a gate that could not fail. The
    // meaningful question is whether that id resolves to a Workspace node on
    // the server, since every later step addresses nodes relative to it.
    workspaceRootId = await getWorkspaceRootId(page);
    console.log(`  Workspace root ID: ${workspaceRootId || 'NOT FOUND'}`);

    if (!workspaceRootId) {
      throw new Error('Failed to get workspace root ID');
    }

    const rootNode = await getNodeViaProtocol(page, workspaceRootId);
    results.workspaceRootResolves =
      rootNode !== null && rootNode.entity_type === 'Workspace' && rootNode.depth === 0;
    console.log(`  Workspace root resolves: ${results.workspaceRootResolves ? 'PASS' : 'FAIL'}`);

    // ========================================================================
    // TEST 1: Leaf Node Delete
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 1: Leaf Node Delete');
    console.log('-'.repeat(50));

    // Create an office
    const officeResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `TestOffice_Leaf_${timestamp}`,
      'Office for leaf delete test'
    );

    if (!officeResult.success || !officeResult.nodeId) {
      console.log('  ERROR: Failed to create test office');
    } else {
      const officeId = officeResult.nodeId;
      console.log(`  Created office: ${officeId}`);

      // Create a room (leaf node)
      const roomResult = await createNodeViaProtocol(
        page,
        officeId,
        { Child: 'Room' },
        `TestRoom_Leaf_${timestamp}`,
        'Leaf room to delete'
      );

      if (!roomResult.success || !roomResult.nodeId) {
        console.log('  ERROR: Failed to create test room');
      } else {
        const roomId = roomResult.nodeId;
        console.log(`  Created leaf room: ${roomId}`);

        // Delete the leaf room (no children)
        const deleteResult = await deleteNodeViaProtocol(page, roomId, false);
        results.leafNodeDelete = deleteResult.success;
        console.log(`  Leaf delete result: ${deleteResult.success ? 'SUCCESS' : 'FAILED'}`);

        if (deleteResult.success) {
          // A DeleteNode response that says "ok" is not evidence the node went
          // away; this re-reads it. It was computed and printed but never
          // gated, so a delete that acknowledged and did nothing passed.
          results.leafNodeGone = await verifyNodeDeleted(page, roomId);
          console.log(`  Room verified deleted: ${results.leafNodeGone ? 'PASS' : 'FAIL'}`);

          // Verify parent's children list is updated
          const parentNode = await getNodeViaProtocol(page, officeId);
          if (parentNode) {
            const childStillListed = parentNode.children.includes(roomId);
            results.leafNodeParentUpdated = !childStillListed;
            console.log(`  Parent children updated: ${!childStillListed}`);
          }
        }

        // Cleanup: delete the test office
        await deleteNodeViaProtocol(page, officeId, true);
      }
    }

    await takeScreenshot(page, 'test1_leaf_delete');

    // ========================================================================
    // TEST 2: Cascade Delete (Single Child)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 2: Cascade Delete (Single Child)');
    console.log('-'.repeat(50));

    // Create office with 1 room
    const office2Result = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `TestOffice_SingleChild_${timestamp}`,
      'Office with single child for cascade test'
    );

    if (office2Result.success && office2Result.nodeId) {
      const officeId = office2Result.nodeId;
      console.log(`  Created office: ${officeId}`);

      const room2Result = await createNodeViaProtocol(
        page,
        officeId,
        { Child: 'Room' },
        `TestRoom_SingleChild_${timestamp}`,
        'Single child room'
      );

      if (room2Result.success && room2Result.nodeId) {
        const roomId = room2Result.nodeId;
        console.log(`  Created room: ${roomId}`);

        // Delete office with cascade: true
        const deleteResult = await deleteNodeViaProtocol(page, officeId, true);
        results.cascadeDeleteSingleChild = deleteResult.success;
        console.log(`  Cascade delete (single child) result: ${deleteResult.success ? 'SUCCESS' : 'FAILED'}`);

        if (deleteResult.success) {
          // Both the parent and the child have to be gone for this to be a
          // cascade; checking only the parent would pass on a delete that
          // orphaned the room.
          const officeDeleted = await verifyNodeDeleted(page, officeId);
          const roomDeleted = await verifyNodeDeleted(page, roomId);
          results.cascadeSingleChildGone = officeDeleted && roomDeleted;
          console.log(`  Office deleted: ${officeDeleted}, Room deleted: ${roomDeleted}`);

          // The response is supposed to enumerate what it took with it. That
          // is the contract callers rely on to reconcile local state, so it is
          // an assertion, not a log line.
          results.cascadeSingleChildReported =
            deleteResult.childrenDeleted?.includes(roomId) ?? false;
          console.log(`  children_deleted: ${JSON.stringify(deleteResult.childrenDeleted)}`);
          console.log(`  children_deleted includes room: ${results.cascadeSingleChildReported ? 'PASS' : 'FAIL'}`);
        }
      }
    }

    await takeScreenshot(page, 'test2_cascade_single');

    // ========================================================================
    // TEST 3: Cascade Delete (Multiple Children)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 3: Cascade Delete (Multiple Children)');
    console.log('-'.repeat(50));

    // Create office with multiple rooms
    const office3Result = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `TestOffice_MultiChild_${timestamp}`,
      'Office with multiple children'
    );

    if (office3Result.success && office3Result.nodeId) {
      const officeId = office3Result.nodeId;
      console.log(`  Created office: ${officeId}`);

      // Create 3 rooms
      const roomIds = await createSiblingNodes(
        page,
        officeId,
        { Child: 'Room' },
        3,
        `Room_Multi_${timestamp}`
      );
      console.log(`  Created ${roomIds.length} rooms`);

      if (roomIds.length === 3) {
        // Delete office with cascade: true
        const deleteResult = await deleteNodeViaProtocol(page, officeId, true);
        results.cascadeDeleteMultipleChildren = deleteResult.success;
        console.log(`  Cascade delete (multiple children) result: ${deleteResult.success ? 'SUCCESS' : 'FAILED'}`);

        if (deleteResult.success) {
          // Verify all nodes deleted
          const officeDeleted = await verifyNodeDeleted(page, officeId);
          let allRoomsDeleted = true;
          for (const roomId of roomIds) {
            const roomDeleted = await verifyNodeDeleted(page, roomId);
            if (!roomDeleted) allRoomsDeleted = false;
          }
          results.cascadeMultipleChildrenGone = officeDeleted && allRoomsDeleted;
          console.log(`  Office deleted: ${officeDeleted}, All rooms deleted: ${allRoomsDeleted}`);

          // Verify deletion count
          const expectedCount = roomIds.length;
          const actualCount = deleteResult.childrenDeleted?.length || 0;
          results.cascadeDeleteCountCorrect = actualCount === expectedCount;
          console.log(`  Deletion count: expected=${expectedCount}, actual=${actualCount} - ${results.cascadeDeleteCountCorrect ? 'CORRECT' : 'INCORRECT'}`);
        }
      }
    }

    await takeScreenshot(page, 'test3_cascade_multiple');

    // ========================================================================
    // TEST 4: Deep Cascade Delete (5 Levels)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 4: Deep Cascade Delete (5 Levels)');
    console.log('-'.repeat(50));
    console.log('  Creating 5-level hierarchy: Workspace -> A -> B -> C -> D -> E');

    // Create a 5-level deep hierarchy
    // Note: Default schema may limit depth, but we try to create as deep as possible
    const deepNodeIds = await createDeepHierarchy(
      page,
      DEEP_CASCADE_LEVELS,
      workspaceRootId,
      `Deep_${timestamp}`
    );

    // Without this the rest of Test 4 is vacuous: if createDeepHierarchy gave
    // up after one node (it stops at the first schema rejection), "all
    // descendants deleted" and "count correct" are both trivially true over an
    // empty set, and the deep cascade goes untested while reporting PASS.
    results.deepHierarchyBuilt = deepNodeIds.length === DEEP_CASCADE_LEVELS;
    console.log(`  Created ${deepNodeIds.length}/${DEEP_CASCADE_LEVELS} nodes in hierarchy: ${results.deepHierarchyBuilt ? 'PASS' : 'FAIL'}`);

    if (deepNodeIds.length > 0) {
      const nodeA = deepNodeIds[0];
      const remainingNodes = deepNodeIds.slice(1);

      // (The "workspace exists before delete" probe that used to sit here was
      // dropped: `workspaceRootResolves` already asserts it at setup and
      // `workspaceStillExists` asserts it after the cascade, so a third
      // ungated print of the same fact added nothing.)

      // Delete node A with cascade
      const deleteResult = await deleteNodeViaProtocol(page, nodeA, true);
      results.deepCascadeDelete = deleteResult.success;
      console.log(`  Deep cascade delete result: ${deleteResult.success ? 'SUCCESS' : 'FAILED'}`);

      if (deleteResult.success) {
        // Verify A and all descendants deleted
        const nodeADeleted = await verifyNodeDeleted(page, nodeA);
        console.log(`  Node A deleted: ${nodeADeleted}`);

        let allDescendantsDeleted = true;
        for (const nodeId of remainingNodes) {
          const nodeDeleted = await verifyNodeDeleted(page, nodeId);
          if (!nodeDeleted) {
            console.log(`  WARNING: Node ${nodeId} still exists`);
            allDescendantsDeleted = false;
          }
        }
        // Nodes left behind by a deep cascade are exactly the failure this test
        // exists to catch — unreachable rows with a dangling parent_id. Both
        // halves were only being printed.
        results.deepCascadeDescendantsGone = nodeADeleted && allDescendantsDeleted;
        console.log(`  All descendants deleted: ${allDescendantsDeleted}`);

        // Verify deletion count
        const expectedCount = remainingNodes.length;
        const actualCount = deleteResult.childrenDeleted?.length || 0;
        results.deepCascadeCountCorrect = actualCount === expectedCount;
        console.log(`  Deep deletion count: expected=${expectedCount}, actual=${actualCount} - ${results.deepCascadeCountCorrect ? 'CORRECT' : 'INCORRECT'}`);

        // `listNodesViaProtocol` returns `response?.Nodes || []` — an array,
        // always, even when the request errored. `offices !== null` was
        // therefore true no matter what happened to the workspace, including
        // if the cascade had eaten the root.
        //
        // The root is a sentinel rather than a stored row, but GetNode
        // synthesises a Workspace node for it (async_node_ops.rs, get_node),
        // so it is directly checkable — and listing under it must still work.
        const rootAfter = await getNodeViaProtocol(page, workspaceRootId);
        const offices = await listNodesViaProtocol(page, {
          parentId: workspaceRootId,
          entityTypes: [{ Child: 'Office' }]
        });
        results.workspaceStillExists =
          rootAfter !== null && rootAfter.entity_type === 'Workspace' && Array.isArray(offices);
        console.log(`  Workspace root still resolves: ${rootAfter !== null}, offices listed: ${offices.length}`);
        console.log(`  Workspace still exists: ${results.workspaceStillExists ? 'PASS' : 'FAIL'}`);
      }
    }

    await takeScreenshot(page, 'test4_deep_cascade');

    // ========================================================================
    // TEST 5: Non-Cascade Delete (Must Fail)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 5: Non-Cascade Delete (Must Fail)');
    console.log('-'.repeat(50));

    // Create office with children
    const office5Result = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `TestOffice_NoCascade_${timestamp}`,
      'Office for non-cascade delete test'
    );

    if (office5Result.success && office5Result.nodeId) {
      const officeId = office5Result.nodeId;
      console.log(`  Created office: ${officeId}`);

      const roomResult = await createNodeViaProtocol(
        page,
        officeId,
        { Child: 'Room' },
        `TestRoom_NoCascade_${timestamp}`,
        'Room that should prevent parent deletion'
      );

      if (roomResult.success && roomResult.nodeId) {
        const roomId = roomResult.nodeId;
        console.log(`  Created room: ${roomId}`);

        // Attempt delete office with cascade: false (should fail)
        const deleteResult = await deleteNodeViaProtocol(page, officeId, false);
        results.nonCascadeDeleteFailed = !deleteResult.success;
        console.log(`  Non-cascade delete result: ${deleteResult.success ? 'SUCCESS (BAD)' : 'FAILED (EXPECTED)'}`);

        if (!deleteResult.success) {
          // The refusal has to be *the children* refusal, not any refusal — a
          // permission error or a timeout would otherwise be indistinguishable
          // from correct behaviour here. The server's message is
          // "Node '<id>' has N children. Use cascade=true to delete with
          // children." (async_node_ops.rs delete_node).
          results.nonCascadeErrorNamesChildren =
            deleteResult.error?.toLowerCase().includes('children') ?? false;
          console.log(`  Error message: ${deleteResult.error}`);
          console.log(`  Error names children: ${results.nonCascadeErrorNamesChildren ? 'PASS' : 'FAIL'}`);
        }

        // Verify office and children still exist
        const officeExists = await verifyNodeExists(page, officeId);
        const roomExists = await verifyNodeExists(page, roomId);
        results.childrenStillExistAfterNonCascade = officeExists && roomExists;
        console.log(`  Office still exists: ${officeExists}, Room still exists: ${roomExists}`);

        // Cleanup
        await deleteNodeViaProtocol(page, officeId, true);
      }
    }

    await takeScreenshot(page, 'test5_non_cascade_fail');

    // ========================================================================
    // TEST 6: Delete Workspace Root (Must Fail)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 6: Delete Workspace Root (Must Fail)');
    console.log('-'.repeat(50));

    // Attempt to delete workspace root
    const deleteRootResult = await deleteNodeViaProtocol(page, workspaceRootId, true);
    results.workspaceRootDeleteFailed = !deleteRootResult.success;
    console.log(`  Delete workspace root result: ${deleteRootResult.success ? 'SUCCESS (BAD)' : 'FAILED (EXPECTED)'}`);

    // The old "error mentions workspace/root" check matched on 'workspace' OR
    // 'root' — and the id 'workspace-root' is echoed back verbatim in every
    // possible error, so it could not fail and told us nothing. Dropped.
    //
    // Worth knowing when reading the log: the refusal arrives as
    // "Tree validation failed: Node 'workspace-root' not found", not as
    // CannotDeleteRoot. That is because the root is a sentinel that
    // validate_delete looks up in the stored-node map and misses
    // (tree_validator.rs). The outcome is right; the message is misleading.
    console.log(`  Error message: ${deleteRootResult.error}`);

    // This is the assertion that matters: whatever the message said, the root
    // is still there. It was previously printed and thrown away.
    results.workspaceRootSurvivesDeleteAttempt = await verifyNodeExists(page, workspaceRootId);
    console.log(`  Workspace root still exists: ${results.workspaceRootSurvivesDeleteAttempt ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(page, 'test6_root_delete_fail');

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

    console.log('\nTest 1 - Leaf Node Delete:');
    console.log(`  Leaf Delete Success:        ${results.leafNodeDelete ? 'PASS' : 'FAIL'}`);
    console.log(`  Leaf Node Actually Gone:    ${results.leafNodeGone ? 'PASS' : 'FAIL'}`);
    console.log(`  Parent Children Updated:    ${results.leafNodeParentUpdated ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 2 & 3 - Cascade Delete:');
    console.log(`  Single Child Cascade:       ${results.cascadeDeleteSingleChild ? 'PASS' : 'FAIL'}`);
    console.log(`  Single Child Subtree Gone:  ${results.cascadeSingleChildGone ? 'PASS' : 'FAIL'}`);
    console.log(`  Single Child Reported:      ${results.cascadeSingleChildReported ? 'PASS' : 'FAIL'}`);
    console.log(`  Multiple Children Cascade:  ${results.cascadeDeleteMultipleChildren ? 'PASS' : 'FAIL'}`);
    console.log(`  Multi Child Subtree Gone:   ${results.cascadeMultipleChildrenGone ? 'PASS' : 'FAIL'}`);
    console.log(`  Deletion Count Correct:     ${results.cascadeDeleteCountCorrect ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 4 - Deep Cascade Delete:');
    console.log(`  Deep Hierarchy Built:       ${results.deepHierarchyBuilt ? 'PASS' : 'FAIL'}`);
    console.log(`  Deep Cascade Success:       ${results.deepCascadeDelete ? 'PASS' : 'FAIL'}`);
    console.log(`  Deep Subtree Gone:          ${results.deepCascadeDescendantsGone ? 'PASS' : 'FAIL'}`);
    console.log(`  Deep Count Correct:         ${results.deepCascadeCountCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Still Exists:     ${results.workspaceStillExists ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 5 - Non-Cascade Delete (Must Fail):');
    console.log(`  Delete Blocked:             ${results.nonCascadeDeleteFailed ? 'PASS' : 'FAIL'}`);
    console.log(`  Error Names Children:       ${results.nonCascadeErrorNamesChildren ? 'PASS' : 'FAIL'}`);
    console.log(`  Children Still Exist:       ${results.childrenStillExistAfterNonCascade ? 'PASS' : 'FAIL'}`);

    console.log('\nTest 6 - Workspace Root Delete (Must Fail):');
    console.log(`  Root Delete Blocked:        ${results.workspaceRootDeleteFailed ? 'PASS' : 'FAIL'}`);
    console.log(`  Root Survived Attempt:      ${results.workspaceRootSurvivesDeleteAttempt ? 'PASS' : 'FAIL'}`);

    // Every result printed above is gated. The previous list read 9 of 14, so
    // an acknowledged-but-ineffective delete, a cascade that left orphans, or
    // a children_deleted list that under-reported all printed FAIL while the
    // run exited 0.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.workspaceRootResolves,
      results.leafNodeDelete,
      results.leafNodeGone,
      results.leafNodeParentUpdated,
      results.cascadeDeleteSingleChild,
      results.cascadeSingleChildGone,
      results.cascadeSingleChildReported,
      results.cascadeDeleteMultipleChildren,
      results.cascadeMultipleChildrenGone,
      results.cascadeDeleteCountCorrect,
      results.deepHierarchyBuilt,
      results.deepCascadeDelete,
      results.deepCascadeDescendantsGone,
      results.deepCascadeCountCorrect,
      results.workspaceStillExists,
      results.nonCascadeDeleteFailed,
      results.nonCascadeErrorNamesChildren,
      results.childrenStillExistAfterNonCascade,
      results.workspaceRootDeleteFailed,
      results.workspaceRootSurvivesDeleteAttempt,
    ];

    const allCriticalPassed = criticalTests.every(Boolean);
    const overallPass = allCriticalPassed;

    if (browser) {
      await browser.close();
    }

    await harness.finalize(overallPass, results as unknown as Record<string, any>);

    return overallPass;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
