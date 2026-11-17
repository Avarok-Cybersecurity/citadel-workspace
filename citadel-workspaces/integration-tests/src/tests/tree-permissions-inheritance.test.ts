/**
 * Tree Permissions Inheritance Integration Test
 *
 * Validates permission inheritance at arbitrary depth:
 *
 * 1. Permission Inheritance
 *    - Admin can edit nodes at all depths
 *    - Non-admin cannot create/delete nodes
 *    - EditTreeStructure permission required for tree mutations
 *
 * 2. Member Access at Deep Levels
 *    - Create admin account (first user)
 *    - Create non-admin account (second user)
 *    - Admin creates deep hierarchy
 *    - Non-admin should be able to view nodes at depth 5
 *    - Non-admin should NOT be able to edit structure
 *
 * 3. ManageNodeTypes Permission
 *    - Admin can create custom node types
 *    - Non-admin cannot create custom node types
 *
 * Test Setup:
 * - Create two accounts: admin (first user) and member (second user)
 * - Admin creates workspace and hierarchy
 * - Switch between users to test permission boundaries
 */

import type { Page, Browser, BrowserContext } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  createIsolatedContexts,
  TestHarness,
  runTestMain,
  // Tree helpers
  createNodeViaProtocol,
  deleteNodeViaProtocol,
  getWorkspaceRootId,
  createDeepHierarchy,
  createNodeType,
  getTreeStructure,
  listNodeTypes,
  verifyNodeExists,
  getNodeViaProtocol,
  type DiagnosticsHandle,
  type CreateNodeResult,
  type DeleteNodeResult,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Setup
  adminAccountCreated: boolean;
  memberAccountCreated: boolean;
  adminWorkspaceLoaded: boolean;
  memberWorkspaceLoaded: boolean;

  // Permission Inheritance Tests
  adminCanCreateOffice: boolean;
  adminCanCreateRoom: boolean;
  adminCanCreateDeepHierarchy: boolean;
  adminCanEditAtAllDepths: boolean;
  adminCanDeleteNodes: boolean;

  // Non-Admin Access Tests
  memberCanViewNodes: boolean;
  memberCannotCreateNode: boolean;
  /** The member's rejected create left nothing behind, as seen by the admin. */
  memberCreateHadNoEffect: boolean;
  memberCannotDeleteNode: boolean;
  /** The member's rejected delete left the node intact, as seen by the admin. */
  memberDeleteHadNoEffect: boolean;
  memberCanViewDeepNodes: boolean;

  // ManageNodeTypes Permission Tests
  adminCanCreateNodeType: boolean;
  /** The type the admin created is visible through ListNodeTypes. */
  adminNodeTypeListed: boolean;
  memberCannotCreateNodeType: boolean;
}

interface UserContext {
  page: Page;
  context: BrowserContext;
  username: string;
  diagnostics: DiagnosticsHandle | null;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `tree_perm_admin_${timestamp}`;
const MEMBER_USER = `tree_perm_member_${timestamp}`;
const DEFAULT_PASSWORD = 'test12345';

// Test node names
const TEST_OFFICE_NAME = `TestOffice_${timestamp}`;
const TEST_ROOM_NAME = `TestRoom_${timestamp}`;
const CUSTOM_NODE_TYPE_NAME = `CustomType_${timestamp}`;

// Store created node IDs
let workspaceRootId: string | null = null;
let testOfficeId: string | null = null;
let testRoomId: string | null = null;
let deepHierarchyIds: string[] = [];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Attempt to create a node and capture the result (success or permission error)
 */
async function attemptCreateNode(
  page: Page,
  parentId: string | null,
  entityType: { Child: string },
  name: string,
  description: string
): Promise<{ success: boolean; error?: string }> {
  console.log(`  Attempting to create node: ${name}`);

  const result: CreateNodeResult = await createNodeViaProtocol(
    page,
    parentId,
    entityType,
    name,
    description
  );

  if (result.success) {
    console.log(`    Node created successfully: ${result.nodeId}`);
    return { success: true };
  } else {
    console.log(`    Node creation failed: ${result.error}`);
    return { success: false, error: result.error };
  }
}

/**
 * Attempt to delete a node and capture the result
 */
async function attemptDeleteNode(
  page: Page,
  nodeId: string,
  cascade: boolean
): Promise<{ success: boolean; error?: string }> {
  console.log(`  Attempting to delete node: ${nodeId}`);

  const result: DeleteNodeResult = await deleteNodeViaProtocol(page, nodeId, cascade);

  if (result.success) {
    console.log(`    Node deleted successfully`);
    return { success: true };
  } else {
    console.log(`    Node deletion failed: ${result.error}`);
    return { success: false, error: result.error };
  }
}

/**
 * Attempt to create a custom node type
 */
async function attemptCreateNodeType(
  page: Page,
  name: string,
  displayName: string,
  allowedParents: string[]
): Promise<{ success: boolean; error?: string }> {
  console.log(`  Attempting to create node type: ${name}`);

  try {
    const result = await createNodeType(page, name, displayName, allowedParents);

    if (result) {
      console.log(`    Node type created successfully`);
      return { success: true };
    } else {
      console.log(`    Node type creation failed`);
      return { success: false, error: 'Unknown error' };
    }
  } catch (error) {
    console.log(`    Node type creation exception: ${error}`);
    return { success: false, error: String(error) };
  }
}

/**
 * Check if error message indicates a permission denied error
 */
function isPermissionDeniedError(error?: string): boolean {
  if (!error) return false;
  const permissionIndicators = [
    'permission',
    'denied',
    'unauthorized',
    'forbidden',
    'not allowed',
    'access denied',
    'insufficient',
  ];
  const lowerError = error.toLowerCase();
  return permissionIndicators.some(indicator => lowerError.includes(indicator));
}

/**
 * Verify that user can view nodes in the tree (read-only access)
 */
async function verifyCanViewNodes(
  page: Page,
  nodeIds: string[]
): Promise<boolean> {
  console.log(`  Verifying view access to ${nodeIds.length} nodes`);

  let accessibleCount = 0;
  for (const nodeId of nodeIds) {
    const node = await getNodeViaProtocol(page, nodeId);
    if (node) {
      accessibleCount++;
    }
  }

  const canViewAll = accessibleCount === nodeIds.length;
  console.log(`    Accessible: ${accessibleCount}/${nodeIds.length} - ${canViewAll ? 'PASS' : 'PARTIAL'}`);
  return canViewAll;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE PERMISSIONS INHERITANCE TEST',
    reportFileName: 'TREE_PERMISSIONS_INHERITANCE_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Member User: ${MEMBER_USER}`);
  console.log('');

  const results: TestResults = {
    // Setup
    adminAccountCreated: false,
    memberAccountCreated: false,
    adminWorkspaceLoaded: false,
    memberWorkspaceLoaded: false,

    // Permission Inheritance Tests
    adminCanCreateOffice: false,
    adminCanCreateRoom: false,
    adminCanCreateDeepHierarchy: false,
    adminCanEditAtAllDepths: false,
    adminCanDeleteNodes: false,

    // Non-Admin Access Tests
    memberCanViewNodes: false,
    memberCannotCreateNode: false,
    memberCreateHadNoEffect: false,
    memberCannotDeleteNode: false,
    memberDeleteHadNoEffect: false,
    memberCanViewDeepNodes: false,

    // ManageNodeTypes Permission Tests
    adminCanCreateNodeType: false,
    adminNodeTypeListed: false,
    memberCannotCreateNodeType: false,
  };

  let browser: Browser | null = null;
  let adminContext: UserContext | null = null;
  let memberContext: UserContext | null = null;

  try {

    // Create browser with isolated contexts for admin and member
    const browserSetup = await createBrowser();
    browser = browserSetup.browser;

    const contexts = await createIsolatedContexts(browser, 2);

    // Setup admin context
    const adminPage = await contexts[0].newPage();
    adminContext = {
      page: adminPage,
      context: contexts[0],
      username: ADMIN_USER,
      diagnostics: await startDiagnostics(adminPage),
    };

    // Setup member context
    const memberPage = await contexts[1].newPage();
    memberContext = {
      page: memberPage,
      context: contexts[1],
      username: MEMBER_USER,
      diagnostics: await startDiagnostics(memberPage),
    };

    // ========================================================================
    // STEP 1: Create Admin Account (First User = Admin)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 1: Create Admin Account');
    console.log('-'.repeat(50));

    results.adminAccountCreated = await createAccount(adminContext.page, ADMIN_USER, {
      isFirstUser: true,
      password: DEFAULT_PASSWORD,
    });

    if (!results.adminAccountCreated) {
      throw new Error('Failed to create admin account');
    }

    // waitForWorkspaceLoaded returns whether the sidebar ever appeared and does
    // not throw on timeout, so discarding it and assigning `true` produced a
    // result that could only print PASS.
    results.adminWorkspaceLoaded = await waitForWorkspaceLoaded(adminContext.page);
    await takeScreenshot(adminContext.page, `${ADMIN_USER}_admin_ready`);

    // Get workspace root ID
    workspaceRootId = await getWorkspaceRootId(adminContext.page);
    if (!workspaceRootId) {
      throw new Error('Could not determine workspace root ID');
    }
    console.log(`  Workspace root ID: ${workspaceRootId}`);

    // ========================================================================
    // STEP 2: Create Member Account (Second User = Member)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Create Member Account');
    console.log('-'.repeat(50));

    results.memberAccountCreated = await createAccount(memberContext.page, MEMBER_USER, {
      isFirstUser: false,
      password: DEFAULT_PASSWORD,
    });

    if (!results.memberAccountCreated) {
      throw new Error('Failed to create member account');
    }

    results.memberWorkspaceLoaded = await waitForWorkspaceLoaded(memberContext.page);
    await takeScreenshot(memberContext.page, `${MEMBER_USER}_member_ready`);

    // ========================================================================
    // STEP 3: Admin Creates Office (Test Admin Permissions)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Admin Creates Office');
    console.log('-'.repeat(50));

    const officeResult = await attemptCreateNode(
      adminContext.page,
      workspaceRootId,
      { Child: 'Office' },
      TEST_OFFICE_NAME,
      'Test office created by admin'
    );

    results.adminCanCreateOffice = officeResult.success;

    if (officeResult.success) {
      // Get the actual office ID from tree structure
      const tree = await getTreeStructure(adminContext.page);
      if (tree) {
        const officeNode = tree.children.find(
          c => c.node.name === TEST_OFFICE_NAME
        );
        if (officeNode) {
          testOfficeId = officeNode.node.id;
          console.log(`  Office ID: ${testOfficeId}`);
        }
      }
    }

    await takeScreenshot(adminContext.page, `${ADMIN_USER}_office_created`);

    // ========================================================================
    // STEP 4: Admin Creates Room Under Office
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Admin Creates Room');
    console.log('-'.repeat(50));

    if (testOfficeId) {
      const roomResult = await attemptCreateNode(
        adminContext.page,
        testOfficeId,
        { Child: 'Room' },
        TEST_ROOM_NAME,
        'Test room created by admin'
      );

      results.adminCanCreateRoom = roomResult.success;

      if (roomResult.success) {
        // Get the actual room ID
        const officeNode = await getNodeViaProtocol(adminContext.page, testOfficeId);
        if (officeNode && officeNode.children.length > 0) {
          testRoomId = officeNode.children[0];
          console.log(`  Room ID: ${testRoomId}`);
        }
      }
    }

    await takeScreenshot(adminContext.page, `${ADMIN_USER}_room_created`);

    // ========================================================================
    // STEP 5: Admin Creates Deep Hierarchy (Depth 5)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Admin Creates Deep Hierarchy');
    console.log('-'.repeat(50));

    // Create a deep hierarchy starting from workspace root
    // This nests Office -> Room -> Room -> Room -> Room (the default schema lets rooms hold rooms)
    deepHierarchyIds = await createDeepHierarchy(
      adminContext.page,
      5, // 5 levels deep
      workspaceRootId,
      'DeepLevel'
    );

    results.adminCanCreateDeepHierarchy = deepHierarchyIds.length === 5;
    console.log(`  Created ${deepHierarchyIds.length} levels`);

    // Verify admin can access all depths
    if (deepHierarchyIds.length > 0) {
      let allDepthsAccessible = true;
      for (let i = 0; i < deepHierarchyIds.length; i++) {
        const node = await getNodeViaProtocol(adminContext.page, deepHierarchyIds[i]);
        if (!node) {
          console.log(`    Could not access node at depth ${i + 1}`);
          allDepthsAccessible = false;
        } else {
          console.log(`    Depth ${i + 1}: ${node.name} (depth=${node.depth})`);
        }
      }
      results.adminCanEditAtAllDepths = allDepthsAccessible;
    }

    await takeScreenshot(adminContext.page, `${ADMIN_USER}_deep_hierarchy`);

    // ========================================================================
    // STEP 6: Admin Creates Custom Node Type
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: Admin Creates Custom Node Type');
    console.log('-'.repeat(50));

    const nodeTypeResult = await attemptCreateNodeType(
      adminContext.page,
      CUSTOM_NODE_TYPE_NAME,
      'Custom Test Type',
      ['Office', 'Room'] // Can be child of Office or Room
    );

    results.adminCanCreateNodeType = nodeTypeResult.success;

    // A count was being printed and dropped. The count on its own says
    // nothing — the schema always yields several built-in types. What the
    // step is claiming is that the type the admin just created is now part of
    // the workspace's type set, which is what ListNodeTypes is for.
    const nodeTypes = await listNodeTypes(adminContext.page);
    results.adminNodeTypeListed = nodeTypes.some(t => t.name === CUSTOM_NODE_TYPE_NAME);
    console.log(`  Node types: ${nodeTypes.map(t => t.name).join(', ')}`);
    console.log(`  New type listed: ${results.adminNodeTypeListed ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(adminContext.page, `${ADMIN_USER}_node_type_created`);

    // ========================================================================
    // STEP 7: Member Tries to View Nodes (Should Succeed)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: Member Views Nodes');
    console.log('-'.repeat(50));

    // Member should be able to view all nodes (read access)
    const nodesToCheck = [workspaceRootId];
    if (testOfficeId) nodesToCheck.push(testOfficeId);
    if (testRoomId) nodesToCheck.push(testRoomId);

    results.memberCanViewNodes = await verifyCanViewNodes(
      memberContext.page,
      nodesToCheck
    );

    // Check if member can view deep nodes
    if (deepHierarchyIds.length > 0) {
      results.memberCanViewDeepNodes = await verifyCanViewNodes(
        memberContext.page,
        deepHierarchyIds
      );
      console.log(`  Member can view deep nodes: ${results.memberCanViewDeepNodes}`);
    }

    await takeScreenshot(memberContext.page, `${MEMBER_USER}_view_nodes`);

    // ========================================================================
    // STEP 8: Member Tries to Create Node (Should Fail)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Member Tries to Create Node (Should Fail)');
    console.log('-'.repeat(50));

    const memberOfficeName = `MemberOffice_${timestamp}`;
    const memberCreateResult = await attemptCreateNode(
      memberContext.page,
      workspaceRootId,
      { Child: 'Office' },
      memberOfficeName,
      'Office attempted by member'
    );

    // The old form was `!success || isPermissionDeniedError(error)`. The right
    // half is dead — when `success` is true there is no error to inspect — so
    // it collapsed to "the request didn't succeed", and a dropped socket or the
    // helper's own 15s timeout counted as the permission system working. It has
    // to be refused, and refused *for the right reason*: the server answers
    // "Permission denied: EditTreeStructure required"
    // (async_node_ops.rs create_node).
    results.memberCannotCreateNode =
      !memberCreateResult.success && isPermissionDeniedError(memberCreateResult.error);

    console.log(`  Member create result: success=${memberCreateResult.success}, error=${memberCreateResult.error}`);
    console.log(`  Refused as a permission error: ${results.memberCannotCreateNode ? 'PASS' : 'FAIL'}`);

    // And confirm from the admin's session that nothing was actually written.
    // A refusal message with a node behind it would be the worst outcome of
    // all, and nothing here was checking for it.
    const treeAfterMemberCreate = await getTreeStructure(adminContext.page);
    const memberOfficeLeaked = treeAfterMemberCreate
      ? treeAfterMemberCreate.children.some(c => c.node.name === memberOfficeName)
      : true; // could not check — treat as not-verified rather than pass
    results.memberCreateHadNoEffect = !memberOfficeLeaked;
    console.log(`  Member's office absent from the tree: ${results.memberCreateHadNoEffect ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(memberContext.page, `${MEMBER_USER}_create_attempt`);

    // ========================================================================
    // STEP 9: Member Tries to Delete Node (Should Fail)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 9: Member Tries to Delete Node (Should Fail)');
    console.log('-'.repeat(50));

    if (testOfficeId) {
      const memberDeleteResult = await attemptDeleteNode(
        memberContext.page,
        testOfficeId,
        false
      );

      // Same tightening as the create case: a refusal, and specifically a
      // permission refusal, rather than "anything other than success".
      results.memberCannotDeleteNode =
        !memberDeleteResult.success && isPermissionDeniedError(memberDeleteResult.error);

      console.log(`  Member delete result: success=${memberDeleteResult.success}, error=${memberDeleteResult.error}`);
      console.log(`  Refused as a permission error: ${results.memberCannotDeleteNode ? 'PASS' : 'FAIL'}`);

      // This is the assertion with teeth — the office is still there when the
      // admin looks. It was computed and printed and then discarded, so a
      // member who could actually delete workspace structure while receiving
      // an error message would not have failed this test.
      results.memberDeleteHadNoEffect = await verifyNodeExists(adminContext.page, testOfficeId);
      console.log(`  Node still exists: ${results.memberDeleteHadNoEffect ? 'PASS' : 'FAIL'}`);
    } else {
      // Genuinely unreachable without an office, and an office the admin failed
      // to create is already a FAIL on adminCanCreateOffice — so leave these
      // false rather than claiming a pass we did not earn.
      console.log(`  Skipped - no office node available (adminCanCreateOffice will report the cause)`);
    }

    await takeScreenshot(memberContext.page, `${MEMBER_USER}_delete_attempt`);

    // ========================================================================
    // STEP 10: Member Tries to Create Custom Node Type (Should Fail)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 10: Member Tries to Create Node Type (Should Fail)');
    console.log('-'.repeat(50));

    const memberNodeTypeResult = await attemptCreateNodeType(
      memberContext.page,
      `MemberType_${timestamp}`,
      'Member Custom Type',
      ['Office']
    );

    // Member should NOT be able to create custom node types.
    //
    // Unlike the create/delete cases this one cannot insist on the error text:
    // `createNodeType` in tree-helpers reports only a boolean, so the server's
    // "Permission denied: Only admins can create custom node types" never
    // reaches us and `attemptCreateNodeType` substitutes 'Unknown error'.
    // Refusal is therefore all we can assert here. Threading the error string
    // out of that helper would be a lib change — see the report.
    results.memberCannotCreateNodeType = !memberNodeTypeResult.success;

    console.log(`  Member node type result: success=${memberNodeTypeResult.success}, error=${memberNodeTypeResult.error}`);
    console.log(`  Node type creation refused: ${results.memberCannotCreateNodeType ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(memberContext.page, `${MEMBER_USER}_node_type_attempt`);

    // ========================================================================
    // STEP 11: Admin Deletes Test Nodes (Verify Admin Delete Permission)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 11: Admin Deletes Test Nodes');
    console.log('-'.repeat(50));

    // Delete deep hierarchy nodes (deepest first to avoid cascade issues)
    let deletedCount = 0;
    for (let i = deepHierarchyIds.length - 1; i >= 0; i--) {
      const deleteResult = await attemptDeleteNode(
        adminContext.page,
        deepHierarchyIds[i],
        false
      );
      if (deleteResult.success) {
        deletedCount++;
      }
      await sleep(100); // Small delay between deletions
    }

    console.log(`  Deleted ${deletedCount}/${deepHierarchyIds.length} deep hierarchy nodes`);

    // Delete test office (with cascade since it has a room)
    let officeDeleted = false;
    if (testOfficeId) {
      const officeDeleteResult = await attemptDeleteNode(
        adminContext.page,
        testOfficeId,
        true // cascade delete
      );
      officeDeleted = officeDeleteResult.success;
      if (officeDeleted) {
        console.log(`  Deleted test office with cascade`);
      }
    }

    // `deletedCount > 0` passed as long as any one of six deletes worked, which
    // is not what "admin can delete nodes" means — an admin blocked at depth 3
    // would still have scored a pass off the depth-5 delete. Every delete the
    // admin issued has to have succeeded.
    results.adminCanDeleteNodes =
      deletedCount === deepHierarchyIds.length && (testOfficeId === null || officeDeleted);
    console.log(`  Admin deletes all succeeded: ${results.adminCanDeleteNodes ? 'PASS' : 'FAIL'}`);

    await takeScreenshot(adminContext.page, `${ADMIN_USER}_cleanup_complete`);

  } catch (error) {
    console.error('\n[TEST ERROR]', error);
    uxTracker.log('critical', 'functional', `Test crashed: ${error}`);

    if (adminContext?.page) {
      await takeScreenshot(adminContext.page, 'ERROR_admin_state');
    }
    if (memberContext?.page) {
      await takeScreenshot(memberContext.page, 'ERROR_member_state');
    }
  } finally {
    // Stop diagnostics
    if (adminContext?.diagnostics) {
      await adminContext.diagnostics.stop();
    }
    if (memberContext?.diagnostics) {
      await memberContext.diagnostics.stop();
    }

    // Print results
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    console.log('\nSetup:');
    console.log(`  Admin Account Created:       ${results.adminAccountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Account Created:      ${results.memberAccountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Workspace Loaded:      ${results.adminWorkspaceLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Workspace Loaded:     ${results.memberWorkspaceLoaded ? 'PASS' : 'FAIL'}`);

    console.log('\nAdmin Permission Tests:');
    console.log(`  Admin Can Create Office:     ${results.adminCanCreateOffice ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Can Create Room:       ${results.adminCanCreateRoom ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Can Create Hierarchy:  ${results.adminCanCreateDeepHierarchy ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Can Edit All Depths:   ${results.adminCanEditAtAllDepths ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Can Delete Nodes:      ${results.adminCanDeleteNodes ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Can Create Node Type:  ${results.adminCanCreateNodeType ? 'PASS' : 'FAIL'}`);
    console.log(`  Admin Node Type Listed:      ${results.adminNodeTypeListed ? 'PASS' : 'FAIL'}`);

    console.log('\nMember Access Tests:');
    console.log(`  Member Can View Nodes:       ${results.memberCanViewNodes ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Can View Deep Nodes:  ${results.memberCanViewDeepNodes ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Cannot Create Node:   ${results.memberCannotCreateNode ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Create Had No Effect: ${results.memberCreateHadNoEffect ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Cannot Delete Node:   ${results.memberCannotDeleteNode ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Delete Had No Effect: ${results.memberDeleteHadNoEffect ? 'PASS' : 'FAIL'}`);
    console.log(`  Member Cannot Create Type:   ${results.memberCannotCreateNodeType ? 'PASS' : 'FAIL'}`);

    // The admin half was gated on account setup and the two shallow creates
    // only, so a deep hierarchy the admin could not build, depths the admin
    // could not reach, deletes that failed, and a custom node type that never
    // appeared all printed FAIL against a green run.
    const criticalTests = [
      results.adminAccountCreated,
      results.memberAccountCreated,
      results.adminWorkspaceLoaded,
      results.memberWorkspaceLoaded,
      results.adminCanCreateOffice,
      results.adminCanCreateRoom,
      results.adminCanCreateDeepHierarchy,
      results.adminCanEditAtAllDepths,
      results.adminCanDeleteNodes,
      results.adminCanCreateNodeType,
      results.adminNodeTypeListed,
    ];

    // The member half is the security boundary this file exists to defend.
    // "Had no effect" matters more than "was refused": a refusal message over a
    // mutation that landed is the failure mode worth catching.
    const permissionTests = [
      results.memberCanViewNodes,
      results.memberCanViewDeepNodes,
      results.memberCannotCreateNode,
      results.memberCreateHadNoEffect,
      results.memberCannotDeleteNode,
      results.memberDeleteHadNoEffect,
      results.memberCannotCreateNodeType,
    ];

    const allCriticalPassed = criticalTests.every(Boolean);
    const allPermissionsPassed = permissionTests.every(Boolean);
    const overallPass = allCriticalPassed && allPermissionsPassed;

    console.log('\n' + '='.repeat(60));
    console.log(`CRITICAL TESTS: ${allCriticalPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`PERMISSION TESTS: ${allPermissionsPassed ? 'PASSED' : 'FAILED'}`);
    console.log(`OVERALL: ${overallPass ? 'TEST PASSED' : 'TEST FAILED'}`);
    console.log('='.repeat(60));

    if (browser) {
      await browser.close();
    }

    harness.finalize(overallPass, {
      ...results,
      testConfig: {
        adminUser: ADMIN_USER,
        memberUser: MEMBER_USER,
        workspaceRootId,
        testOfficeId,
        testRoomId,
        deepHierarchyDepth: deepHierarchyIds.length,
      },
    } as unknown as Record<string, any>);
    return overallPass;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
