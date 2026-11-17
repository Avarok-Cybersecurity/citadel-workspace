/**
 * Tree Move Operations Integration Test
 *
 * Tests move/reparent operations in the generalized tree hierarchy:
 * 1. Basic Move Operations
 *    - Move office to be sibling of another office
 *    - Move room to different office
 *    - Verify old parent's children list updated
 *
 * 2. Move with Descendants
 *    - Move office containing rooms
 *    - Verify all descendants retain relative structure
 *    - Verify depth recalculated for all descendants
 *
 * 3. Depth Recalculation
 *    - Create hierarchy: workspace -> office -> room
 *    - Move room directly under workspace (depth 2 -> 1)
 *    - Verify depth changed
 *
 * 4. Invalid Moves (Must Reject)
 *    - Move node to itself
 *    - Move node to its descendant (cycle)
 *    - Move workspace root (not allowed)
 *    - Move to non-existent parent
 *
 * 5. Response Validation
 *    - NodeMoved response includes old_parent_id and new_parent_id
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
  moveNodeViaProtocol,
  getNodeViaProtocol,
  getWorkspaceRootId,
  verifyNodeDepth,
  verifyNodeParent,
  getTreeStructure,
  findNodeInTree,
  getDescendantIds,
  type DiagnosticsHandle,
  // Test framework
  TestHarness,
  runTestMain,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * `?: boolean` marks a case whose precondition the default schema does not
 * allow us to set up. Those report SKIP and are excluded from the gate; the
 * reason is stated where each is (not) assigned. Everything else is required.
 *
 * The previous version expressed SKIP by writing `true` into the result, so
 * "the schema refused, therefore we never tested this" printed as PASS.
 */
interface TestResults {
  // Setup
  accountCreation: boolean;
  workspaceLoaded: boolean;
  /** The workspace root id resolves to a real Workspace node on the server. */
  workspaceRootResolves: boolean;

  // Basic Move Operations
  /** Requires an office nested under another office — not possible by default. */
  officeMoveToSibling?: boolean;
  siblingsShareParentAndDepth?: boolean;
  roomMoveToDifferentOffice: boolean;
  movedNodeParentUpdated: boolean;
  oldParentChildrenUpdated: boolean;
  newParentChildrenUpdated: boolean;

  // Move with Descendants — all require Office-under-Office nesting.
  officeWithDescendantsMoved?: boolean;
  descendantsRetainStructure?: boolean;
  descendantsDepthRecalculated?: boolean;

  // Depth Recalculation
  deepRoomInitialDepth: boolean;
  /** Requires Room directly under Workspace — not possible by default. */
  depthDecreasedCorrectly?: boolean;
  depthIncreasedCorrectly?: boolean;
  /** Either the move recalculated depth, or the schema refused it for the
   *  documented reason. Always evaluated. */
  schemaRefusedOrDepthRecalculated: boolean;

  // Invalid Moves (all should fail/be rejected)
  moveToSelfRejected: boolean;
  moveToCycleRejected: boolean;
  moveWorkspaceRootRejected: boolean;
  moveToNonExistentRejected: boolean;

  // Response Validation
  responsesContainOldParentId: boolean;
  responsesContainNewParentId: boolean;
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
const ADMIN_USER = `tree_move_admin_${timestamp}`;

// Test node names
const OFFICE_A_NAME = `OfficeA_${timestamp}`;
const OFFICE_B_NAME = `OfficeB_${timestamp}`;
const ROOM_A1_NAME = `RoomA1_${timestamp}`;
const ROOM_A2_NAME = `RoomA2_${timestamp}`;
const ROOM_B1_NAME = `RoomB1_${timestamp}`;
const OFFICE_DEEP_NAME = `OfficeDeep_${timestamp}`;
const ROOM_DEEP_NAME = `RoomDeep_${timestamp}`;

// Store created node IDs
let workspaceRootId: string | null = null;
let officeAId: string | null = null;
let officeBId: string | null = null;
let roomA1Id: string | null = null;
let roomA2Id: string | null = null;
let roomB1Id: string | null = null;
let officeDeepId: string | null = null;
let roomDeepId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify that a parent's children list contains (or doesn't contain) a node
 */
async function verifyParentChildren(
  page: Page,
  parentId: string,
  childId: string,
  shouldContain: boolean
): Promise<boolean> {
  const parent = await getNodeViaProtocol(page, parentId);
  if (!parent) {
    console.log(`  [Verify] Parent ${parentId} not found`);
    return false;
  }

  const contains = parent.children.includes(childId);
  const matches = contains === shouldContain;

  console.log(
    `  [Verify] Parent ${parentId} children ${shouldContain ? 'contains' : 'does not contain'} ${childId}: ${matches ? 'PASS' : 'FAIL'}`
  );

  if (!matches) {
    console.log(`    Parent children: [${parent.children.join(', ')}]`);
  }

  return matches;
}

/**
 * Get all depths of descendants from a tree node
 */
function getDescendantDepths(tree: ReturnType<typeof findNodeInTree>): Map<string, number> {
  const depths = new Map<string, number>();
  if (!tree) return depths;

  function traverse(node: NonNullable<typeof tree>) {
    depths.set(node.node.id, node.node.depth);
    for (const child of node.children) {
      traverse(child);
    }
  }

  traverse(tree);
  return depths;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE MOVE OPERATIONS INTEGRATION TEST',
    reportFileName: 'TREE_MOVE_OPERATIONS_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log('');

  const results: TestResults = {
    // Setup
    accountCreation: false,
    workspaceLoaded: false,
    workspaceRootResolves: false,

    // Basic Move Operations
    roomMoveToDifferentOffice: false,
    movedNodeParentUpdated: false,
    oldParentChildrenUpdated: false,
    newParentChildrenUpdated: false,

    // Depth Recalculation
    deepRoomInitialDepth: false,
    schemaRefusedOrDepthRecalculated: false,

    // Invalid Moves
    moveToSelfRejected: false,
    moveToCycleRejected: false,
    moveWorkspaceRootRejected: false,
    moveToNonExistentRejected: false,

    // Response Validation
    responsesContainOldParentId: false,
    responsesContainNewParentId: false,
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
    await takeScreenshot(page, `${ADMIN_USER}_ready`);

    // `getWorkspaceRootId` falls back to the 'workspace-root' sentinel, so
    // `!== null` was a gate that could not fail. Assert instead that the id
    // resolves to a Workspace node — every move in this file is expressed
    // relative to it.
    workspaceRootId = await getWorkspaceRootId(page);
    console.log(`  Workspace root ID: ${workspaceRootId || 'NOT FOUND'}`);

    if (!workspaceRootId) {
      throw new Error('Failed to find workspace root ID');
    }

    const rootNode = await getNodeViaProtocol(page, workspaceRootId);
    results.workspaceRootResolves =
      rootNode !== null && rootNode.entity_type === 'Workspace' && rootNode.depth === 0;
    console.log(`  Workspace root resolves: ${results.workspaceRootResolves ? 'PASS' : 'FAIL'}`);

    // ========================================================================
    // STEP 2: Create Test Hierarchy
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Create Test Hierarchy');
    console.log('-'.repeat(50));

    // Create Office A
    const officeAResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      OFFICE_A_NAME,
      'Office A for move tests'
    );
    officeAId = officeAResult.nodeId || null;
    console.log(`  Created Office A: ${officeAId ? 'SUCCESS' : 'FAILED'}`);

    // Create Office B
    const officeBResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      OFFICE_B_NAME,
      'Office B for move tests'
    );
    officeBId = officeBResult.nodeId || null;
    console.log(`  Created Office B: ${officeBId ? 'SUCCESS' : 'FAILED'}`);

    // Create Rooms under Office A
    if (officeAId) {
      const roomA1Result = await createNodeViaProtocol(
        page,
        officeAId,
        { Child: 'Room' },
        ROOM_A1_NAME,
        'Room A1 under Office A'
      );
      roomA1Id = roomA1Result.nodeId || null;
      console.log(`  Created Room A1: ${roomA1Id ? 'SUCCESS' : 'FAILED'}`);

      const roomA2Result = await createNodeViaProtocol(
        page,
        officeAId,
        { Child: 'Room' },
        ROOM_A2_NAME,
        'Room A2 under Office A'
      );
      roomA2Id = roomA2Result.nodeId || null;
      console.log(`  Created Room A2: ${roomA2Id ? 'SUCCESS' : 'FAILED'}`);
    }

    // Create Room under Office B
    if (officeBId) {
      const roomB1Result = await createNodeViaProtocol(
        page,
        officeBId,
        { Child: 'Room' },
        ROOM_B1_NAME,
        'Room B1 under Office B'
      );
      roomB1Id = roomB1Result.nodeId || null;
      console.log(`  Created Room B1: ${roomB1Id ? 'SUCCESS' : 'FAILED'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_hierarchy_created`);
    await sleep(500);

    // ========================================================================
    // STEP 3: Test Basic Move - Room to Different Office
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Test Basic Move - Room to Different Office');
    console.log('-'.repeat(50));

    if (roomA1Id && officeAId && officeBId) {
      console.log(`  Moving Room A1 (${roomA1Id}) from Office A to Office B...`);

      const moveResult = await moveNodeViaProtocol(page, roomA1Id, officeBId);

      if (moveResult.success) {
        console.log(`  Move succeeded!`);
        results.roomMoveToDifferentOffice = true;

        // Verify response contains old and new parent IDs
        results.responsesContainOldParentId = moveResult.oldParentId === officeAId;
        results.responsesContainNewParentId = moveResult.newParentId === officeBId;

        console.log(`  Response old_parent_id: ${moveResult.oldParentId} (expected: ${officeAId}) - ${results.responsesContainOldParentId ? 'PASS' : 'FAIL'}`);
        console.log(`  Response new_parent_id: ${moveResult.newParentId} (expected: ${officeBId}) - ${results.responsesContainNewParentId ? 'PASS' : 'FAIL'}`);

        // Verify parent changed
        results.oldParentChildrenUpdated = await verifyParentChildren(
          page,
          officeAId,
          roomA1Id,
          false // Should NOT contain
        );

        results.newParentChildrenUpdated = await verifyParentChildren(
          page,
          officeBId,
          roomA1Id,
          true // Should contain
        );

        // The node's own parent_id has to agree with the two children lists.
        // This was computed and printed and then dropped on the floor — a move
        // that fixed up both parents' children arrays but left the child
        // pointing at its old parent would have passed the whole step.
        results.movedNodeParentUpdated = await verifyNodeParent(page, roomA1Id, officeBId);
        console.log(`  Node parent_id updated: ${results.movedNodeParentUpdated ? 'PASS' : 'FAIL'}`);
      } else {
        console.log(`  Move FAILED: ${moveResult.error}`);
        uxTracker.log('major', 'functional', `Room move failed: ${moveResult.error}`);
      }
    } else {
      console.log(`  SKIPPED: Required nodes not created`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_room_moved`);

    // ========================================================================
    // STEP 4: Test Depth Recalculation on Move
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Test Depth Recalculation on Move');
    console.log('-'.repeat(50));

    // Create a deeper hierarchy for depth testing
    if (workspaceRootId) {
      const officeDeepResult = await createNodeViaProtocol(
        page,
        workspaceRootId,
        { Child: 'Office' },
        OFFICE_DEEP_NAME,
        'Deep office for depth tests'
      );
      officeDeepId = officeDeepResult.nodeId || null;
      console.log(`  Created Office Deep: ${officeDeepId ? 'SUCCESS' : 'FAILED'}`);

      if (officeDeepId) {
        const roomDeepResult = await createNodeViaProtocol(
          page,
          officeDeepId,
          { Child: 'Room' },
          ROOM_DEEP_NAME,
          'Deep room for depth tests'
        );
        roomDeepId = roomDeepResult.nodeId || null;
        console.log(`  Created Room Deep: ${roomDeepId ? 'SUCCESS' : 'FAILED'}`);

        // Verify initial depth (Room under Office = depth 2)
        if (roomDeepId) {
          // Ungated before. If the room did not start at depth 2 the whole
          // "depth changed correctly" story below is measured from the wrong
          // baseline, so this is a precondition worth failing on.
          results.deepRoomInitialDepth = await verifyNodeDepth(page, roomDeepId, 2);
          console.log(`  Initial Room depth (2): ${results.deepRoomInitialDepth ? 'PASS' : 'FAIL'}`);

          // NOTE: Moving room directly under workspace violates the default schema
          // (Workspace → Office → Room). This is expected to fail with schema validation.
          // Depth recalculation is tested implicitly when moving rooms between offices.
          console.log(`  Moving Room Deep directly under workspace...`);
          console.log(`  NOTE: This SHOULD fail - default schema only allows Room under Office`);
          const moveToRootResult = await moveNodeViaProtocol(page, roomDeepId, workspaceRootId);

          if (moveToRootResult.success) {
            // The schema allowed it, so the depth must actually have changed.
            const newNode = await getNodeViaProtocol(page, roomDeepId);
            results.depthDecreasedCorrectly = newNode?.depth === 1;
            console.log(`  New depth after move: ${newNode?.depth} (expected: 1) - ${report(results.depthDecreasedCorrectly)}`);

            console.log(`  Moving Room Deep back under Office Deep...`);
            const moveBackResult = await moveNodeViaProtocol(page, roomDeepId, officeDeepId!);
            const nodeAfterMoveBack = moveBackResult.success
              ? await getNodeViaProtocol(page, roomDeepId)
              : null;
            results.depthIncreasedCorrectly = nodeAfterMoveBack?.depth === 2;
            console.log(`  Depth after move back: ${nodeAfterMoveBack?.depth} (expected: 2) - ${report(results.depthIncreasedCorrectly)}`);

            results.schemaRefusedOrDepthRecalculated =
              results.depthDecreasedCorrectly === true && results.depthIncreasedCorrectly === true;
          } else {
            // The default schema is Workspace → Office → Room, so a Room
            // directly under the workspace is a legitimate refusal and the
            // depth-change pair genuinely cannot be exercised here — they stay
            // undefined and print SKIP.
            //
            // Previously all three were set to `true` on this path, which meant
            // "the schema refused" and "depth recalculation works" were
            // indistinguishable in the output, and an unexpected failure (a
            // permission error, a timeout) also left them at `false` with no
            // way to tell it apart from a real depth bug.
            const isSchemaViolation =
              moveToRootResult.error?.includes('not allowed under parent type') ?? false;
            results.schemaRefusedOrDepthRecalculated = isSchemaViolation;
            if (isSchemaViolation) {
              console.log(`  Move correctly rejected by schema: ${moveToRootResult.error}`);
              console.log(`  SKIP: depth-change pair needs a schema that allows Room under Workspace`);
            } else {
              console.log(`  Move FAILED for a reason other than the schema: ${moveToRootResult.error}`);
              uxTracker.log('major', 'functional', `Unexpected MoveNode failure: ${moveToRootResult.error}`);
            }
          }
        }
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_depth_tests`);

    // ========================================================================
    // STEP 5: Test Move with Descendants
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Test Move with Descendants');
    console.log('-'.repeat(50));

    // Office A still has Room A2, move Office A under Office B
    // NOTE: This tests nesting Office under Office, which the default schema doesn't allow.
    // The default schema only permits: Workspace → Office → Room
    if (officeAId && officeBId && roomA2Id) {
      // Get tree structure before move
      const treeBefore = await getTreeStructure(page);
      const officeABefore = treeBefore ? findNodeInTree(treeBefore, officeAId) : null;
      const descendantsBefore = officeABefore ? getDescendantIds(officeABefore) : [];
      const depthsBefore = officeABefore ? getDescendantDepths(officeABefore) : new Map();

      console.log(`  Office A descendants before move: [${descendantsBefore.join(', ')}]`);
      console.log(`  Room A2 depth before move: ${depthsBefore.get(roomA2Id) || 'unknown'}`);

      // Move Office A under Office B (becomes nested office)
      console.log(`  Moving Office A (with Room A2) under Office B...`);
      console.log(`  NOTE: This SHOULD fail - default schema only allows Office under Workspace`);
      const moveOfficeResult = await moveNodeViaProtocol(page, officeAId, officeBId);

      if (moveOfficeResult.success) {
        // If schema allowed this move, verify descendants
        results.officeWithDescendantsMoved = true;
        console.log(`  Office move succeeded`);

        const treeAfter = await getTreeStructure(page);
        const officeAAfter = treeAfter ? findNodeInTree(treeAfter, officeAId) : null;

        if (officeAAfter) {
          const descendantsAfter = getDescendantIds(officeAAfter);
          results.descendantsRetainStructure = descendantsBefore.every((id) =>
            descendantsAfter.includes(id)
          );
          console.log(`  Descendants retained: ${results.descendantsRetainStructure ? 'PASS' : 'FAIL'}`);

          const officeANode = await getNodeViaProtocol(page, officeAId);
          const roomA2Node = await getNodeViaProtocol(page, roomA2Id);

          if (officeANode && roomA2Node) {
            const officeADepthCorrect = officeANode.depth === 2;
            const roomA2DepthCorrect = roomA2Node.depth === 3;
            results.descendantsDepthRecalculated = officeADepthCorrect && roomA2DepthCorrect;
            console.log(`  Office A new depth: ${officeANode.depth} (expected: 2) - ${officeADepthCorrect ? 'PASS' : 'FAIL'}`);
            console.log(`  Room A2 new depth: ${roomA2Node.depth} (expected: 3) - ${roomA2DepthCorrect ? 'PASS' : 'FAIL'}`);
          }
        }
      } else {
        // Office-under-Office is not in the default schema, so this whole case
        // is unreachable here and stays undefined (SKIP) rather than being
        // written `true`, which is what previously made a refused move
        // indistinguishable from a verified one in the summary.
        const isSchemaViolation =
          moveOfficeResult.error?.includes('not allowed under parent type') ?? false;
        if (isSchemaViolation) {
          console.log(`  Move correctly rejected by schema: ${moveOfficeResult.error}`);
          console.log(`  SKIP: office-nesting cases need a schema that allows Office under Office`);
        } else {
          // A failure that is NOT the schema refusal is a real failure, and it
          // has to be able to fail the run.
          console.log(`  Office move FAILED for a reason other than the schema: ${moveOfficeResult.error}`);
          results.officeWithDescendantsMoved = false;
          uxTracker.log('major', 'functional', `Office nesting move failed unexpectedly: ${moveOfficeResult.error}`);
        }
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_descendants_moved`);

    // ========================================================================
    // STEP 6: Test Invalid Moves - Move to Self
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: Test Invalid Moves');
    console.log('-'.repeat(50));

    // Test: Move node to itself (should fail)
    if (officeBId) {
      console.log(`  Testing move Office B to itself...`);
      const moveToSelfResult = await moveNodeViaProtocol(page, officeBId, officeBId);

      results.moveToSelfRejected = !moveToSelfResult.success;
      console.log(`  Move to self rejected: ${results.moveToSelfRejected ? 'PASS' : 'FAIL'}`);
      if (!results.moveToSelfRejected) {
        console.log(`    ERROR: Move to self should have been rejected!`);
        uxTracker.log('critical', 'functional', 'Move to self was not rejected');
      } else {
        console.log(`    Error message: ${moveToSelfResult.error}`);
      }
    }

    // Test: Move node to its descendant (cycle detection)
    if (officeBId && roomB1Id) {
      // Room B1 is under Office B, so moving Office B under Room B1 would create a cycle
      console.log(`  Testing move Office B to its child Room B1 (cycle)...`);
      const moveToCycleResult = await moveNodeViaProtocol(page, officeBId, roomB1Id);

      results.moveToCycleRejected = !moveToCycleResult.success;
      console.log(`  Move to cycle rejected: ${results.moveToCycleRejected ? 'PASS' : 'FAIL'}`);
      if (!results.moveToCycleRejected) {
        console.log(`    ERROR: Cycle-creating move should have been rejected!`);
        uxTracker.log('critical', 'functional', 'Cycle-creating move was not rejected');
      } else {
        console.log(`    Error message: ${moveToCycleResult.error}`);
      }
    }

    // Test: Move workspace root (should fail)
    if (workspaceRootId && officeBId) {
      console.log(`  Testing move workspace root under an office...`);
      const moveRootResult = await moveNodeViaProtocol(page, workspaceRootId, officeBId);

      results.moveWorkspaceRootRejected = !moveRootResult.success;
      console.log(`  Move workspace root rejected: ${results.moveWorkspaceRootRejected ? 'PASS' : 'FAIL'}`);
      if (!results.moveWorkspaceRootRejected) {
        console.log(`    ERROR: Moving workspace root should have been rejected!`);
        uxTracker.log('critical', 'functional', 'Moving workspace root was not rejected');
      } else {
        console.log(`    Error message: ${moveRootResult.error}`);
      }
    }

    // Test: Move to non-existent parent
    if (officeBId) {
      const fakeParentId = 'non-existent-parent-id-12345';
      console.log(`  Testing move to non-existent parent...`);
      const moveToFakeResult = await moveNodeViaProtocol(page, officeBId, fakeParentId);

      results.moveToNonExistentRejected = !moveToFakeResult.success;
      console.log(`  Move to non-existent rejected: ${results.moveToNonExistentRejected ? 'PASS' : 'FAIL'}`);
      if (!results.moveToNonExistentRejected) {
        console.log(`    ERROR: Move to non-existent parent should have been rejected!`);
        uxTracker.log('critical', 'functional', 'Move to non-existent parent was not rejected');
      } else {
        console.log(`    Error message: ${moveToFakeResult.error}`);
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_invalid_moves_tested`);

    // ========================================================================
    // STEP 7: Test Office Move to be Sibling
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: Test Office Move to be Sibling');
    console.log('-'.repeat(50));

    // If Office A was moved under Office B earlier, move it back to workspace root
    // to test sibling positioning
    if (officeAId && workspaceRootId) {
      const currentOfficeA = await getNodeViaProtocol(page, officeAId);
      if (currentOfficeA && currentOfficeA.parent_id !== workspaceRootId) {
        console.log(`  Moving Office A back to workspace root (sibling of Office B)...`);
        const moveSiblingResult = await moveNodeViaProtocol(page, officeAId, workspaceRootId);

        results.officeMoveToSibling = moveSiblingResult.success;
        if (moveSiblingResult.success) {
          console.log(`  Office sibling move succeeded`);

          // "Sibling" means same parent AND same depth. Both were printed and
          // neither was recorded, so a move that reparented correctly but left
          // a stale depth would have reported a clean sibling move.
          const officeAAfter = await getNodeViaProtocol(page, officeAId);
          const officeBAfter = await getNodeViaProtocol(page, officeBId!);
          results.siblingsShareParentAndDepth =
            officeAAfter !== null &&
            officeBAfter !== null &&
            officeAAfter.parent_id === officeBAfter.parent_id &&
            officeAAfter.depth === officeBAfter.depth;
          console.log(`  Office A: parent=${officeAAfter?.parent_id} depth=${officeAAfter?.depth}`);
          console.log(`  Office B: parent=${officeBAfter?.parent_id} depth=${officeBAfter?.depth}`);
          console.log(`  Same parent and depth: ${report(results.siblingsShareParentAndDepth)}`);
        } else {
          console.log(`  Office sibling move FAILED: ${moveSiblingResult.error}`);
        }
      } else {
        // Nothing was moved, so nothing was tested. Under the default schema
        // Office A can never leave the workspace root (Step 5's move is
        // refused), so this branch is always the one taken — which is why
        // recording it as a pass, as the old code did, meant this result was
        // permanently green without a single MoveNode having been issued.
        console.log(`  SKIP: Office A never left the workspace root, so there was no sibling move to verify`);
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_sibling_move`);

    // ========================================================================
    // STEP 8: Final Tree Structure Verification
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Final Tree Structure Verification');
    console.log('-'.repeat(50));

    const finalTree = await getTreeStructure(page);
    if (finalTree) {
      console.log(`  Final tree root: ${finalTree.node.name}`);
      console.log(`  Direct children: ${finalTree.children.length}`);

      // Log the tree structure using a recursive arrow function
      type TreeNodeType = NonNullable<typeof finalTree>;
      const logTree = (node: TreeNodeType, indent: string = ''): void => {
        const entityType =
          typeof node.node.entity_type === 'string'
            ? node.node.entity_type
            : node.node.entity_type.Child;
        console.log(`  ${indent}[${entityType}] ${node.node.name} (depth: ${node.node.depth})`);
        for (const child of node.children) {
          logTree(child, indent + '  ');
        }
      };

      logTree(finalTree);
    }

    await takeScreenshot(page, 'FINAL_tree_structure');

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

    console.log('\nBasic Move Operations:');
    console.log(`  Office Move to Sibling:     ${report(results.officeMoveToSibling)}`);
    console.log(`  Siblings Share Parent/Depth:${report(results.siblingsShareParentAndDepth)}`);
    console.log(`  Room Move to Diff Office:   ${results.roomMoveToDifferentOffice ? 'PASS' : 'FAIL'}`);
    console.log(`  Moved Node Parent Updated:  ${results.movedNodeParentUpdated ? 'PASS' : 'FAIL'}`);
    console.log(`  Old Parent Updated:         ${results.oldParentChildrenUpdated ? 'PASS' : 'FAIL'}`);
    console.log(`  New Parent Updated:         ${results.newParentChildrenUpdated ? 'PASS' : 'FAIL'}`);

    console.log('\nMove with Descendants:');
    console.log(`  Office+Descendants Moved:   ${report(results.officeWithDescendantsMoved)}`);
    console.log(`  Descendants Retained:       ${report(results.descendantsRetainStructure)}`);
    console.log(`  Depths Recalculated:        ${report(results.descendantsDepthRecalculated)}`);

    console.log('\nDepth Recalculation:');
    console.log(`  Initial Room Depth:         ${results.deepRoomInitialDepth ? 'PASS' : 'FAIL'}`);
    console.log(`  Schema Refused or Recalced: ${results.schemaRefusedOrDepthRecalculated ? 'PASS' : 'FAIL'}`);
    console.log(`  Depth Decreased:            ${report(results.depthDecreasedCorrectly)}`);
    console.log(`  Depth Increased:            ${report(results.depthIncreasedCorrectly)}`);

    console.log('\nInvalid Moves (Should Reject):');
    console.log(`  Move to Self Rejected:      ${results.moveToSelfRejected ? 'PASS' : 'FAIL'}`);
    console.log(`  Move to Cycle Rejected:     ${results.moveToCycleRejected ? 'PASS' : 'FAIL'}`);
    console.log(`  Move Root Rejected:         ${results.moveWorkspaceRootRejected ? 'PASS' : 'FAIL'}`);
    console.log(`  Move to Nonexistent Reject: ${results.moveToNonExistentRejected ? 'PASS' : 'FAIL'}`);

    console.log('\nResponse Validation:');
    console.log(`  Contains old_parent_id:     ${results.responsesContainOldParentId ? 'PASS' : 'FAIL'}`);
    console.log(`  Contains new_parent_id:     ${results.responsesContainNewParentId ? 'PASS' : 'FAIL'}`);

    // Every non-SKIP result printed above is gated. The old list omitted the
    // moved node's own parent_id and both halves of the NodeMoved response
    // contract, so a MoveNode that reported the wrong old/new parent — the one
    // thing "Response Validation" exists to check — could not fail the run.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.workspaceRootResolves,
      results.roomMoveToDifferentOffice,
      results.movedNodeParentUpdated,
      results.oldParentChildrenUpdated,
      results.newParentChildrenUpdated,
      results.deepRoomInitialDepth,
      results.schemaRefusedOrDepthRecalculated,
      results.moveToSelfRejected,
      results.moveToCycleRejected,
      results.moveWorkspaceRootRejected,
      results.moveToNonExistentRejected,
      results.responsesContainOldParentId,
      results.responsesContainNewParentId,
    ];

    // Cases the default schema will not let us set up print SKIP and are
    // excluded — but if one of them did run and disagreed, it still fails.
    const notFailed = (v: boolean | undefined) => v !== false;
    const optionalTests = [
      results.officeMoveToSibling,
      results.siblingsShareParentAndDepth,
      results.officeWithDescendantsMoved,
      results.descendantsRetainStructure,
      results.descendantsDepthRecalculated,
      results.depthDecreasedCorrectly,
      results.depthIncreasedCorrectly,
    ];

    const allCriticalPassed = criticalTests.every(Boolean) && optionalTests.every(notFailed);
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
