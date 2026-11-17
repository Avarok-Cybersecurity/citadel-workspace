/**
 * Tree Deep Hierarchy Integration Test
 *
 * Validates depth and performance of tree hierarchy operations:
 * 1. Depth Calculation - Verify nodes have correct depth values
 * 2. Deep Hierarchy Creation - Create multi-level trees and verify structure
 * 3. Max Depth Constraint - Test schema-enforced depth limits
 * 4. Wide Hierarchy - Test many siblings at same level
 * 5. GetTreeStructure Performance - Test max_depth truncation
 */

import type { Page, Browser } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  // Tree helpers
  createNodeViaProtocol,
  getTreeStructure,
  getWorkspaceRootId,
  createDeepHierarchy,
  createSiblingNodes,
  verifyNodeDepth,
  getNodeViaProtocol,
  countTreeNodes,
  listNodesViaProtocol,
  deleteNodeViaProtocol,
  getTreeSchema,
  updateTreeSchema,
  type DiagnosticsHandle,
  type TreeSchema,
  type TreeNode,
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

  // Depth Calculation Tests
  workspaceRootDepthZero: boolean;
  officeDepthOne: boolean;
  roomDepthTwo: boolean;
  customNodeDepthThree?: boolean;

  // Deep Hierarchy Tests
  deepHierarchyCreated: boolean;
  deepHierarchyDepthsCorrect: boolean;
  deepHierarchyTreeStructure: boolean;

  // Max Depth Constraint Tests
  // `undefined` means "not exercised" — see the SKIP handling below. The old
  // code set these to `true` when the schema could not be read, which printed
  // PASS for a test that never ran.
  maxDepthSchemaSet?: boolean;
  maxDepthPathBuilt?: boolean;
  maxDepthConstraintEnforced?: boolean;
  maxDepthErrorNamesDepth?: boolean;

  // Wide Hierarchy Tests
  wideHierarchyCreated: boolean;
  wideHierarchyListCorrect: boolean;
  wideHierarchyCascadeDelete: boolean;

  // Performance Tests
  treeStructureTruncation: boolean;
  treeStructureFullRetrieval: boolean;
  fullTreeDepthsValid: boolean;
}

/** Render an optional result: absent means the case was never reached. */
function report(value: boolean | undefined): string {
  if (value === undefined) return 'SKIP';
  return value ? 'PASS' : 'FAIL';
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `tree_depth_admin_${timestamp}`;

// Test constants
const DEEP_HIERARCHY_LEVELS = 10;
const WIDE_HIERARCHY_COUNT = 20;
const LARGE_TREE_NODE_COUNT = 50;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Recursively verify depths in a tree structure.
 */
function verifyTreeDepths(tree: TreeNode, expectedDepth: number = 0): boolean {
  if (tree.node.depth !== expectedDepth) {
    console.log(`  [DepthCheck] Node ${tree.node.id} has depth ${tree.node.depth}, expected ${expectedDepth}`);
    return false;
  }

  for (const child of tree.children) {
    if (!verifyTreeDepths(child, expectedDepth + 1)) {
      return false;
    }
  }

  return true;
}

/**
 * Get the maximum depth in a tree structure.
 */
function getMaxTreeDepth(tree: TreeNode): number {
  let maxDepth = tree.node.depth;
  for (const child of tree.children) {
    const childMax = getMaxTreeDepth(child);
    if (childMax > maxDepth) {
      maxDepth = childMax;
    }
  }
  return maxDepth;
}

/**
 * Count nodes at a specific depth in the tree.
 * @human-review Available for future use in detailed depth analysis
 */
function _countNodesAtDepth(tree: TreeNode, targetDepth: number): number {
  let count = 0;
  if (tree.node.depth === targetDepth) {
    count = 1;
  }
  for (const child of tree.children) {
    count += _countNodesAtDepth(child, targetDepth);
  }
  return count;
}

// Export for potential future use
void _countNodesAtDepth;

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE DEEP HIERARCHY INTEGRATION TEST',
    reportFileName: 'TREE_DEEP_HIERARCHY_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Deep Hierarchy Levels: ${DEEP_HIERARCHY_LEVELS}`);
  console.log(`Wide Hierarchy Count: ${WIDE_HIERARCHY_COUNT}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    workspaceRootDepthZero: false,
    officeDepthOne: false,
    roomDepthTwo: false,
    deepHierarchyCreated: false,
    deepHierarchyDepthsCorrect: false,
    deepHierarchyTreeStructure: false,
    wideHierarchyCreated: false,
    wideHierarchyListCorrect: false,
    wideHierarchyCascadeDelete: false,
    treeStructureTruncation: false,
    treeStructureFullRetrieval: false,
    fullTreeDepthsValid: false,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;
  let diagnostics: DiagnosticsHandle | null = null;

  // Track created nodes for cleanup
  const createdNodeIds: string[] = [];

  try {

    // Create browser
    const setup = await createBrowser();
    browser = setup.browser;
    page = await setup.context.newPage();

    // Start diagnostics
    diagnostics = await startDiagnostics(page);

    // ========================================================================
    // STEP 1: Create Admin Account (First User = Admin)
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

    // Get workspace root ID
    const workspaceRootId = await getWorkspaceRootId(page);
    if (!workspaceRootId) {
      throw new Error('Failed to get workspace root ID');
    }
    console.log(`  Workspace root ID: ${workspaceRootId}`);

    // ========================================================================
    // TEST 1: Depth Calculation
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 1: Depth Calculation');
    console.log('-'.repeat(50));

    // Test 1.1: Workspace root should be depth 0
    console.log('\n  1.1: Verifying workspace root depth = 0');
    results.workspaceRootDepthZero = await verifyNodeDepth(page, workspaceRootId, 0);

    // Test 1.2: Create office (depth 1)
    console.log('\n  1.2: Creating office node (expected depth = 1)');
    const officeResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `DepthTestOffice_${timestamp}`,
      'Office for depth testing'
    );
    if (officeResult.success && officeResult.nodeId) {
      createdNodeIds.push(officeResult.nodeId);
      results.officeDepthOne = await verifyNodeDepth(page, officeResult.nodeId, 1);
    }

    // Test 1.3: Create room under office (depth 2)
    console.log('\n  1.3: Creating room node (expected depth = 2)');
    if (officeResult.nodeId) {
      const roomResult = await createNodeViaProtocol(
        page,
        officeResult.nodeId,
        { Child: 'Room' },
        `DepthTestRoom_${timestamp}`,
        'Room for depth testing'
      );
      if (roomResult.success && roomResult.nodeId) {
        createdNodeIds.push(roomResult.nodeId);
        results.roomDepthTwo = await verifyNodeDepth(page, roomResult.nodeId, 2);

        // Test 1.4: Create custom node under room (depth 3)
        console.log('\n  1.4: Creating custom node under room (expected depth = 3)');
        const customResult = await createNodeViaProtocol(
          page,
          roomResult.nodeId,
          { Child: 'CustomNode' },
          `DepthTestCustom_${timestamp}`,
          'Custom node for depth testing'
        );
        if (customResult.success && customResult.nodeId) {
          createdNodeIds.push(customResult.nodeId);
          results.customNodeDepthThree = await verifyNodeDepth(page, customResult.nodeId, 3);
        } else {
          console.log(`  Custom node creation failed: ${customResult.error}`);
          console.log('  Custom node depth test excluded from pass/fail (schema may not support custom nodes)');
        }
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_depth_calculation`);

    // ========================================================================
    // TEST 2: Deep Hierarchy Creation
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 2: Deep Hierarchy Creation');
    console.log('-'.repeat(50));

    console.log(`\n  Creating ${DEEP_HIERARCHY_LEVELS}-level deep hierarchy...`);
    const deepNodeIds = await createDeepHierarchy(
      page,
      DEEP_HIERARCHY_LEVELS,
      workspaceRootId,
      'DeepLevel'
    );

    createdNodeIds.push(...deepNodeIds);
    results.deepHierarchyCreated = deepNodeIds.length === DEEP_HIERARCHY_LEVELS;
    console.log(`  Created ${deepNodeIds.length}/${DEEP_HIERARCHY_LEVELS} levels`);

    // Verify each node has correct depth
    console.log('\n  Verifying depths of all nodes in hierarchy...');
    let allDepthsCorrect = true;
    for (let i = 0; i < deepNodeIds.length; i++) {
      const expectedDepth = i + 1; // First node is depth 1 (child of workspace root)
      const depthCorrect = await verifyNodeDepth(page, deepNodeIds[i], expectedDepth);
      if (!depthCorrect) {
        allDepthsCorrect = false;
      }
    }
    results.deepHierarchyDepthsCorrect = allDepthsCorrect;

    // Verify GetTreeStructure returns all levels
    console.log('\n  Verifying GetTreeStructure returns all levels...');
    const fullTree = await getTreeStructure(page, workspaceRootId);
    if (fullTree) {
      const maxDepth = getMaxTreeDepth(fullTree);
      console.log(`  Tree max depth: ${maxDepth}`);
      results.deepHierarchyTreeStructure = maxDepth >= DEEP_HIERARCHY_LEVELS;
    }

    await takeScreenshot(page, `${ADMIN_USER}_deep_hierarchy`);

    // ========================================================================
    // TEST 3: Max Depth Constraint
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 3: Max Depth Constraint');
    console.log('-'.repeat(50));

    // Get current schema
    console.log('\n  Getting current tree schema...');
    const originalSchema = await getTreeSchema(page);

    if (originalSchema) {
      console.log(`  Current schema max_depth: ${originalSchema.max_depth}`);

      // Try to set max_depth to 5
      console.log('\n  Setting schema max_depth to 5...');
      const newSchema: TreeSchema = {
        ...originalSchema,
        max_depth: 5,
      };

      results.maxDepthSchemaSet = await updateTreeSchema(page, newSchema);
      console.log(`  Schema update: ${results.maxDepthSchemaSet ? 'SUCCESS' : 'FAILED'}`);

      if (results.maxDepthSchemaSet) {
        // Build an explicit chain down to depth 4.
        //
        // This used to try `listNodesViaProtocol(page, { depth: 4 })` first and
        // take element [0] as "a node at depth 4". ListNodes' `depth` is a
        // BFS *traversal* limit measured from the start nodes, not an absolute
        // depth filter (async_node_ops.rs list_nodes computes `base_depth` from
        // the start set), so with no parent_id it returns every root-level node
        // plus four levels below — and [0] is a depth-1 office. The subsequent
        // "create at depth 6" then actually created at depth 3, sailed past
        // max_depth:5, and the test blamed the server for not enforcing a limit
        // it had never been asked to enforce.
        const pathToDepth4 = await createDeepHierarchy(page, 4, workspaceRootId, 'MaxDepthPath');
        createdNodeIds.push(...pathToDepth4);
        const depth4ParentId = pathToDepth4.length === 4 ? pathToDepth4[3] : null;

        const depth4Node = depth4ParentId
          ? await getNodeViaProtocol(page, depth4ParentId)
          : null;
        results.maxDepthPathBuilt = depth4Node !== null && depth4Node.depth === 4;
        console.log(`  Parent chain reaches depth 4: ${report(results.maxDepthPathBuilt)} (actual depth ${depth4Node?.depth})`);

        // The child types come from the live schema: level names are the admin's to choose, and
        // under the default template a Room holds only Rooms.
        const depth5Type = depth4Node?.allowed_child_types?.[0];
        if (results.maxDepthPathBuilt && !depth5Type) {
          console.log('  The depth-4 node allows no child type; the limit cannot be reached');
          results.maxDepthConstraintEnforced = false;
        }
        if (depth4ParentId && results.maxDepthPathBuilt && depth5Type) {
          console.log(`\n  Creating ${depth5Type} at depth 5 (should succeed)...`);
          const depth5Result = await createNodeViaProtocol(
            page,
            depth4ParentId,
            { Child: depth5Type },
            `MaxDepthTest_${timestamp}`,
            'At the max_depth limit — should be accepted'
          );

          if (depth5Result.success && depth5Result.nodeId) {
            createdNodeIds.push(depth5Result.nodeId);
            // A type the parent allows, so that only the depth limit can refuse it.
            const depth6Type = (await getNodeViaProtocol(page, depth5Result.nodeId))?.allowed_child_types?.[0] ?? depth5Type;
            console.log(`\n  Attempting to create ${depth6Type} at depth 6 (should be rejected)...`);
            const depth6Result = await createNodeViaProtocol(
              page,
              depth5Result.nodeId,
              { Child: depth6Type },
              `TooDeepNode_${timestamp}`,
              'Should be rejected'
            );

            results.maxDepthConstraintEnforced = !depth6Result.success;
            if (depth6Result.success) {
              console.log('  WARNING: Node created at depth 6 despite max_depth:5');
              if (depth6Result.nodeId) {
                createdNodeIds.push(depth6Result.nodeId);
              }
            } else {
              console.log(`  Depth 6 creation rejected: ${depth6Result.error}`);
              // Insist the rejection is the depth rejection. Any other failure
              // (permissions, a dropped socket) would otherwise read as the
              // constraint working. The server's message is
              // "Node 'x' at depth N exceeds schema max_depth M".
              results.maxDepthErrorNamesDepth =
                depth6Result.error?.toLowerCase().includes('depth') ?? false;
              console.log(`  Error names the depth limit: ${report(results.maxDepthErrorNamesDepth)}`);
            }
          } else {
            // A create AT the limit must be accepted; if it is not, the limit
            // is off by one and the depth-6 case cannot be reached at all.
            console.log(`  Depth 5 creation unexpectedly rejected: ${depth5Result.error}`);
            results.maxDepthConstraintEnforced = false;
          }
        }

        // Restore original schema
        console.log('\n  Restoring original schema...');
        await updateTreeSchema(page, originalSchema);
      }
    } else {
      // Genuinely not exercised. Leaving these `undefined` reports SKIP; the
      // old code set them to `true`, which printed PASS for a test that had
      // not run and hid a broken GetTreeSchema completely.
      console.log('  WARNING: Could not get tree schema — max_depth cases SKIPPED');
    }

    await takeScreenshot(page, `${ADMIN_USER}_max_depth`);

    // ========================================================================
    // TEST 4: Wide Hierarchy
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 4: Wide Hierarchy');
    console.log('-'.repeat(50));

    // Create an office for the wide hierarchy test
    console.log('\n  Creating parent office for wide hierarchy test...');
    const wideOfficeResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      `WideTestOffice_${timestamp}`,
      'Office for wide hierarchy testing'
    );

    if (wideOfficeResult.success && wideOfficeResult.nodeId) {
      createdNodeIds.push(wideOfficeResult.nodeId);

      // Create 20 rooms under this office
      console.log(`\n  Creating ${WIDE_HIERARCHY_COUNT} sibling rooms...`);
      const siblingIds = await createSiblingNodes(
        page,
        wideOfficeResult.nodeId,
        { Child: 'Room' },
        WIDE_HIERARCHY_COUNT,
        'WideRoom'
      );

      createdNodeIds.push(...siblingIds);
      results.wideHierarchyCreated = siblingIds.length === WIDE_HIERARCHY_COUNT;
      console.log(`  Created ${siblingIds.length}/${WIDE_HIERARCHY_COUNT} rooms`);

      // Verify ListNodes returns all siblings
      console.log('\n  Verifying ListNodes returns all siblings...');
      const listedRooms = await listNodesViaProtocol(page, {
        parentId: wideOfficeResult.nodeId,
        entityTypes: [{ Child: 'Room' }],
      });
      // Exactly, not at-least: the office was created moments ago and holds
      // nothing but these rooms, so a count that drifts either way means the
      // parent/type filter is not doing what the request asked for.
      results.wideHierarchyListCorrect = listedRooms.length === WIDE_HIERARCHY_COUNT;
      console.log(`  ListNodes returned ${listedRooms.length} rooms (expected ${WIDE_HIERARCHY_COUNT})`);

      // Test cascade delete handles many children
      console.log('\n  Testing cascade delete with many children...');
      const deleteStartTime = Date.now();
      const deleteResult = await deleteNodeViaProtocol(page, wideOfficeResult.nodeId, true);
      const deleteTime = Date.now() - deleteStartTime;

      if (deleteResult.success) {
        console.log(`  Cascade delete completed in ${deleteTime}ms`);
        console.log(`  Children deleted: ${deleteResult.childrenDeleted?.length || 0}`);
        results.wideHierarchyCascadeDelete = true;
        // Remove from tracking since they're deleted
        const deletedIds = new Set([wideOfficeResult.nodeId, ...siblingIds]);
        for (let i = createdNodeIds.length - 1; i >= 0; i--) {
          if (deletedIds.has(createdNodeIds[i])) {
            createdNodeIds.splice(i, 1);
          }
        }
      } else {
        console.log(`  Cascade delete failed: ${deleteResult.error}`);
        results.wideHierarchyCascadeDelete = false;
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_wide_hierarchy`);

    // ========================================================================
    // TEST 5: GetTreeStructure Performance
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('TEST 5: GetTreeStructure Performance');
    console.log('-'.repeat(50));

    // Create a tree with 50+ nodes
    console.log(`\n  Creating large tree with ${LARGE_TREE_NODE_COUNT}+ nodes...`);

    // Create multiple offices with rooms
    const officeCount = 10;
    const roomsPerOffice = 5;
    let totalCreated = 0;

    for (let i = 0; i < officeCount && totalCreated < LARGE_TREE_NODE_COUNT; i++) {
      const officeRes = await createNodeViaProtocol(
        page,
        workspaceRootId,
        { Child: 'Office' },
        `PerfOffice_${i}_${timestamp}`,
        'Performance test office'
      );

      if (officeRes.success && officeRes.nodeId) {
        createdNodeIds.push(officeRes.nodeId);
        totalCreated++;

        for (let j = 0; j < roomsPerOffice && totalCreated < LARGE_TREE_NODE_COUNT; j++) {
          const roomRes = await createNodeViaProtocol(
            page,
            officeRes.nodeId,
            { Child: 'Room' },
            `PerfRoom_${i}_${j}_${timestamp}`,
            'Performance test room'
          );

          if (roomRes.success && roomRes.nodeId) {
            createdNodeIds.push(roomRes.nodeId);
            totalCreated++;
          }
        }
      }
    }

    console.log(`  Created ${totalCreated} nodes for performance test`);

    // Test GetTreeStructure with max_depth: 2 (truncation)
    console.log('\n  Testing GetTreeStructure with max_depth: 2 (truncation)...');
    const truncatedTreeStart = Date.now();
    const truncatedTree = await getTreeStructure(page, workspaceRootId, 2);
    const truncatedTime = Date.now() - truncatedTreeStart;

    let maxDepthInTruncated = -1;
    let truncatedCount = -1;
    if (truncatedTree) {
      maxDepthInTruncated = getMaxTreeDepth(truncatedTree);
      truncatedCount = countTreeNodes(truncatedTree);
      console.log(`  Truncated tree: ${truncatedCount} nodes, max depth: ${maxDepthInTruncated}`);
      console.log(`  Retrieval time: ${truncatedTime}ms`);
      results.treeStructureTruncation = maxDepthInTruncated <= 2;
    }

    // Test GetTreeStructure with no max_depth (full retrieval)
    console.log('\n  Testing GetTreeStructure with max_depth: null (full retrieval)...');
    const fullTreeStart = Date.now();
    const fullTreeResult = await getTreeStructure(page, workspaceRootId);
    const fullTime = Date.now() - fullTreeStart;

    if (fullTreeResult) {
      const fullCount = countTreeNodes(fullTreeResult);
      const fullMaxDepth = getMaxTreeDepth(fullTreeResult);
      console.log(`  Full tree: ${fullCount} nodes, max depth: ${fullMaxDepth}`);
      console.log(`  Retrieval time: ${fullTime}ms`);
      // `fullCount >= totalCreated` alone was near-vacuous: fullCount counts
      // every node the whole test file created, totalCreated only the ~50 from
      // this step, so it held even if truncation had silently applied. The
      // point of "full retrieval" is that it reaches past the truncated view,
      // so compare against that view directly.
      results.treeStructureFullRetrieval =
        fullCount >= totalCreated &&
        fullCount >= truncatedCount &&
        fullMaxDepth > maxDepthInTruncated;
      console.log(`  Full retrieval reaches past truncation (${fullMaxDepth} > ${maxDepthInTruncated}, ${fullCount} >= ${truncatedCount} nodes): ${results.treeStructureFullRetrieval ? 'PASS' : 'FAIL'}`);

      // A tree whose reported depths disagree with its own nesting is corrupt,
      // and every depth assertion elsewhere in this file is reading the same
      // field. This was computed and printed but never gated.
      results.fullTreeDepthsValid = verifyTreeDepths(fullTreeResult);
      console.log(`  All depths valid: ${results.fullTreeDepthsValid ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_performance_test`);

    // ========================================================================
    // CLEANUP
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('CLEANUP');
    console.log('-'.repeat(50));

    // Delete created nodes (reverse order to handle parent-child relationships)
    console.log(`  Cleaning up ${createdNodeIds.length} test nodes...`);
    for (let i = createdNodeIds.length - 1; i >= 0; i--) {
      await deleteNodeViaProtocol(page, createdNodeIds[i], true);
      await sleep(50);
    }

    await takeScreenshot(page, 'FINAL_cleanup');

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
    console.log(`  Account Creation:             ${results.accountCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Loaded:             ${results.workspaceLoaded ? 'PASS' : 'FAIL'}`);

    console.log('\nDepth Calculation Tests:');
    console.log(`  Workspace Root Depth 0:       ${results.workspaceRootDepthZero ? 'PASS' : 'FAIL'}`);
    console.log(`  Office Depth 1:               ${results.officeDepthOne ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Depth 2:                 ${results.roomDepthTwo ? 'PASS' : 'FAIL'}`);
    // Custom node types are not in the default schema, so this case is
    // genuinely optional — SKIP when the create was refused.
    console.log(`  Custom Node Depth 3:          ${report(results.customNodeDepthThree)}`);

    console.log('\nDeep Hierarchy Tests:');
    console.log(`  Deep Hierarchy Created:       ${results.deepHierarchyCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Depths Correct:               ${results.deepHierarchyDepthsCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`  Tree Structure Complete:      ${results.deepHierarchyTreeStructure ? 'PASS' : 'FAIL'}`);

    console.log('\nMax Depth Constraint Tests:');
    console.log(`  Schema Update:                ${report(results.maxDepthSchemaSet)}`);
    console.log(`  Depth-4 Path Built:           ${report(results.maxDepthPathBuilt)}`);
    console.log(`  Constraint Enforced:          ${report(results.maxDepthConstraintEnforced)}`);
    console.log(`  Error Names Depth:            ${report(results.maxDepthErrorNamesDepth)}`);

    console.log('\nWide Hierarchy Tests:');
    console.log(`  Wide Hierarchy Created:       ${results.wideHierarchyCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  ListNodes Correct:            ${results.wideHierarchyListCorrect ? 'PASS' : 'FAIL'}`);
    console.log(`  Cascade Delete:               ${results.wideHierarchyCascadeDelete ? 'PASS' : 'FAIL'}`);

    console.log('\nPerformance Tests:');
    console.log(`  Tree Truncation (max_depth):  ${results.treeStructureTruncation ? 'PASS' : 'FAIL'}`);
    console.log(`  Full Retrieval:               ${results.treeStructureFullRetrieval ? 'PASS' : 'FAIL'}`);
    console.log(`  Full Tree Depths Valid:       ${results.fullTreeDepthsValid ? 'PASS' : 'FAIL'}`);

    // Every result printed above is gated. The previous list read 7 of 16, so
    // an unenforced max_depth, a ListNodes filter returning the wrong set, a
    // cascade delete that failed on 20 children, and a truncation parameter
    // being ignored all printed FAIL while the run exited 0.
    //
    // `undefined` (never exercised) counts as not-a-failure: those cases print
    // SKIP and their reasons are stated where they are set.
    const notFailed = (v: boolean | undefined) => v !== false;

    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.workspaceRootDepthZero,
      results.officeDepthOne,
      results.roomDepthTwo,
      results.deepHierarchyCreated,
      results.deepHierarchyDepthsCorrect,
      results.deepHierarchyTreeStructure,
      results.wideHierarchyCreated,
      results.wideHierarchyListCorrect,
      results.wideHierarchyCascadeDelete,
      results.treeStructureTruncation,
      results.treeStructureFullRetrieval,
      results.fullTreeDepthsValid,
    ];

    const optionalTests = [
      results.customNodeDepthThree,
      results.maxDepthSchemaSet,
      results.maxDepthPathBuilt,
      results.maxDepthConstraintEnforced,
      results.maxDepthErrorNamesDepth,
    ];

    const allCriticalPassed = criticalTests.every(Boolean) && optionalTests.every(notFailed);
    const overallPass = allCriticalPassed;

    if (browser) {
      await browser.close();
    }

    await harness.finalize(overallPass, {
      ...results,
      metrics: {
        deepHierarchyLevels: DEEP_HIERARCHY_LEVELS,
        wideHierarchyCount: WIDE_HIERARCHY_COUNT,
        largeTreeNodeCount: LARGE_TREE_NODE_COUNT,
      },
    } as unknown as Record<string, any>);

    return overallPass;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
