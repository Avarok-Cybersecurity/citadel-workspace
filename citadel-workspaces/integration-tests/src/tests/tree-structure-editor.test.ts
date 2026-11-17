/**
 * Tree Structure Editor Integration Test
 *
 * Drives the hierarchy sidebar the way a user does — create, rename, delete —
 * and checks what the server actually recorded for each action:
 *
 * 1. Workspace root resolves and the tree loads
 * 2. Create a child node at depth 1 (Office) and confirm its depth
 * 3. Create a nested child at depth 2 (Room) and confirm its parent
 * 4. GetNode / ListNodes-with-filter / GetTreeStructure agree with the sidebar
 * 5. UpdateNode via the edit modal
 * 6. Delete via the sidebar, which always cascades — see STEP 11
 *
 * Where a claim cannot be seen in the DOM (depth, parentage, entity type) it is
 * read back over WorkspaceProtocol. The sidebar can only show you a name in a
 * list; it cannot show you which parent the server wrote down.
 */

import type { Page, Browser, Locator } from 'playwright';
import { waitForAdminRole } from '../lib/admin-role.js';
import {
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  TestHarness,
  runTestMain,
  isVisibleWithin,
  isHiddenWithin,
  // Protocol reads — verification only; every mutation below goes through the UI.
  getWorkspaceRootId,
  getTreeStructure,
  getNodeViaProtocol,
  listNodesViaProtocol,
  verifyNodeDepth,
  verifyNodeParent,
  pickChildTypeIfAsked,
  nodeExistsInUI,
  nodeGoneFromUI,
  navigateToNodeViaUI,
  openNodeMenu,
  revealNode,
  rootRow,
  selectRoot,
  type TreeNode,
  type DiagnosticsHandle,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Setup
  accountCreation: boolean;
  workspaceLoaded: boolean;
  isAdmin: boolean;

  // Tree Structure Tests
  initialTreeLoaded: boolean;
  officeNodeCreated: boolean;
  roomNodeCreated: boolean;
  nodeRetrieved: boolean;
  nodesListedWithFilter: boolean;
  fullTreeStructureLoaded: boolean;
  nodeUpdated: boolean;

  // Delete Operations
  /**
   * The sidebar's delete removes the node together with its children.
   *
   * There is no non-cascading delete in this UI: HierarchySidebar's
   * handleNodeDelete calls `WorkspaceService.deleteNode(node.id, true)`
   * unconditionally. The old `deleteWithoutCascadeFailed` result asserted the
   * opposite — that deleting a parent would be refused — and printed
   * "FAIL: Delete cascaded (unexpected for non-cascade delete)" when the app
   * did exactly what it is written to do. The non-cascading path is covered at
   * the protocol level in tree-cascade-delete.test.ts.
   */
  uiDeleteCascadesToChildren: boolean;
  deleteWithCascadeSucceeded: boolean;
  /** Nothing survives a parent's deletion with a dangling parent_id. */
  orphanNodePrevented: boolean;

  // Depth / relationship
  depthCalculatedCorrectly: boolean;
  parentChildRelationshipMaintained: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `tree_admin_${timestamp}`;

// Test node names
const TEST_OFFICE_NAME = `TestOffice_${timestamp}`;
const TEST_OFFICE_2_NAME = `TestOffice2_${timestamp}`;
const TEST_ROOM_NAME = `TestRoom_${timestamp}`;
const TEST_ROOM_2_NAME = `TestRoom2_${timestamp}`;
const TEMP_ROOM_NAME = `TempRoom_${timestamp}`;

// Store created node IDs. These are the real server ids read out of the
// `tree-node-<id>` testids, so they stay valid across a rename.
let workspaceRootId: string | null = null;
let testOfficeId: string | null = null;
let testOffice2Id: string | null = null;
let testRoomId: string | null = null;
let testRoom2Id: string | null = null;
let tempRoomId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/** The open modal. Every form lookup below is scoped to this. */
function dialog(page: Page): Locator {
  return page.locator('[role="dialog"]').first();
}

/**
 * Whether a node with this name is in the workspace. The sidebar is a focused
 * tree, so this reveals the node (selecting it) rather than looking for a row
 * that may simply be off screen.
 */
async function nodeExistsInSidebar(page: Page, nodeName: string, timeout = 5000): Promise<boolean> {
  return nodeExistsInUI(page, nodeName, timeout);
}

/**
 * Whether a node with this name has left the workspace, asked of the sidebar's
 * filter: in a focused tree most nodes have no row on screen, so a row's absence
 * would hold whether or not the node was deleted.
 *
 * Not `!(await nodeExistsInSidebar(...))`: that spends the whole appearance
 * timeout waiting for something that is never going to show up.
 */
async function nodeGoneFromSidebar(page: Page, nodeName: string, timeout = 8000): Promise<boolean> {
  return nodeGoneFromUI(page, nodeName, timeout);
}

/**
 * Fill and submit the node create/edit modal.
 *
 * Everything is scoped to `[role="dialog"]`: `input#name` and
 * `button:has-text("Create Office")` were page-wide, and the second also
 * assumed the submit label. EntityManagementModal builds that label from the
 * schema (`Create ${meta.label}`), so it changes with the entity type's
 * configured label — `button[type="submit"]` inside the dialog is the same
 * button without the guess.
 */
async function submitNodeForm(
  page: Page,
  values: { name?: string; description?: string }
): Promise<boolean> {
  const modal = dialog(page);
  if (!(await isVisibleWithin(modal, 5000))) {
    console.log('  WARNING: node modal did not open');
    return false;
  }

  if (values.name !== undefined) {
    const nameInput = modal.locator('input#name');
    if (!(await isVisibleWithin(nameInput, 3000))) {
      console.log('  WARNING: name input not found in modal');
      await page.keyboard.press('Escape');
      return false;
    }
    await nameInput.fill(values.name);
  }

  if (values.description !== undefined) {
    const descInput = modal.locator('textarea#description');
    if (await isVisibleWithin(descInput, 1000)) {
      await descInput.fill(values.description);
    }
  }

  const submitBtn = modal.locator('button[type="submit"]');
  if (!(await isVisibleWithin(submitBtn, 3000))) {
    console.log('  WARNING: submit button not found in modal');
    await page.keyboard.press('Escape');
    return false;
  }

  await submitBtn.click();

  // The modal closes on a successful submit and stays open on a validation or
  // request error, so its disappearance is the completion signal.
  return isHiddenWithin(modal, 15_000);
}

/**
 * Create a node through the sidebar and return the server id it was given.
 *
 * Under a parent the schema lets hold several types, the app asks which;
 * `nodeType` is the one picked there (pickChildTypeIfAsked). At the root,
 * where only one type is allowed, the app chooses and `nodeType` only labels
 * the log. The names are the default template's.
 */
async function createNodeViaUI(
  page: Page,
  nodeType: 'Office' | 'Room',
  name: string,
  description: string,
  parentName?: string
): Promise<string | null> {
  console.log(`\n  Creating ${nodeType} node: ${name}`);

  if (nodeType === 'Office') {
    // "+" adds inside the selected node: the root, for a top-level node. An
    // empty workspace has no root row; its add-root-node-button adds at the top.
    if ((await rootRow(page).isVisible()) && (await selectRoot(page)) === null) {
      console.log('  WARNING: could not select the workspace root');
      return null;
    }
    const addBtn = page
      .locator('[data-testid="add-node-button"], [data-testid="add-root-node-button"]')
      .first();
    if (!(await isVisibleWithin(addBtn, 10_000))) {
      console.log('  WARNING: Add node button not found');
      return null;
    }
    // The button is disabled until the tree schema arrives — it needs the
    // schema to know which child types are allowed — and clicking early only
    // raises a "schema is still loading" toast.
    await page
      .locator('[data-testid="add-node-button"]:not([disabled])')
      .waitFor({ state: 'visible', timeout: 30_000 })
      .catch(() => undefined);
    await addBtn.click();
  } else {
    const parentNodeId = parentName ? await openNodeMenu(page, parentName) : null;
    if (!parentNodeId) {
      console.log('  WARNING: parent node menu unreachable');
      return null;
    }
    const createChild = page.locator(`[data-testid="create-child-${parentNodeId}"]`);
    if (!(await isVisibleWithin(createChild, 5000))) {
      console.log('  WARNING: "Add Child" item missing from the parent menu');
      await page.keyboard.press('Escape');
      return null;
    }
    await createChild.click();
    await pickChildTypeIfAsked(page, nodeType);
  }

  if (!(await submitNodeForm(page, { name, description }))) {
    return null;
  }

  // The real server id, read from the revealed row's `tree-node-<id>` testid.
  const newNodeId = await revealNode(page, name, 15_000);
  if (!newNodeId) {
    console.log(`  WARNING: "${name}" never appeared in the sidebar`);
    return null;
  }
  console.log(`  Created node "${name}" with id: ${newNodeId}`);
  return newNodeId;
}

/** Delete a node through its ⋯ menu and confirm the alert dialog. */
async function deleteNodeViaUI(page: Page, nodeName: string): Promise<boolean> {
  console.log(`\n  Deleting: ${nodeName}`);

  const nodeId = await openNodeMenu(page, nodeName);
  if (!nodeId) return false;

  // The testid'd item rather than the visible label: the label is
  // `Delete ${typeName}` and typeName comes from the schema.
  const deleteOption = page.locator(`[data-testid="delete-node-${nodeId}"]`);
  if (!(await isVisibleWithin(deleteOption, 5000))) {
    console.log('  WARNING: Delete option not found');
    await page.keyboard.press('Escape');
    return false;
  }

  await deleteOption.click();

  const confirmBtn = page.locator('[role="alertdialog"] button:has-text("Delete")').first();
  if (!(await isVisibleWithin(confirmBtn, 5000))) {
    console.log('  WARNING: confirmation dialog not found');
    return false;
  }

  await confirmBtn.click();
  return nodeGoneFromSidebar(page, nodeName, 15_000);
}

/** Rename / re-describe a node through its edit modal. */
async function updateNodeViaUI(
  page: Page,
  nodeName: string,
  updates: { name?: string; description?: string }
): Promise<boolean> {
  console.log(`\n  Updating: ${nodeName}`);

  const nodeId = await openNodeMenu(page, nodeName);
  if (!nodeId) return false;

  const editOption = page.locator(`[data-testid="edit-node-${nodeId}"]`);
  if (!(await isVisibleWithin(editOption, 5000))) {
    console.log('  WARNING: Edit option not found');
    await page.keyboard.press('Escape');
    return false;
  }

  await editOption.click();
  return submitNodeForm(page, updates);
}

/** Find a node by id anywhere in a TreeStructure response. */
function findInTree(tree: TreeNode, nodeId: string): TreeNode | null {
  if (tree.node.id === nodeId) return tree;
  for (const child of tree.children) {
    const found = findInTree(child, nodeId);
    if (found) return found;
  }
  return null;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE STRUCTURE EDITOR INTEGRATION TEST',
    reportFileName: 'TREE_STRUCTURE_EDITOR_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Test Office: ${TEST_OFFICE_NAME}`);
  console.log(`Test Room: ${TEST_ROOM_NAME}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    isAdmin: false,
    initialTreeLoaded: false,
    officeNodeCreated: false,
    roomNodeCreated: false,
    nodeRetrieved: false,
    nodesListedWithFilter: false,
    fullTreeStructureLoaded: false,
    nodeUpdated: false,
    uiDeleteCascadesToChildren: false,
    deleteWithCascadeSucceeded: false,
    orphanNodePrevented: false,
    depthCalculatedCorrectly: false,
    parentChildRelationshipMaintained: false,
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
    await takeScreenshot(page, `${ADMIN_USER}_admin_ready`);

    // Admin status.
    //
    // This used to look for `text="ADMIN SETTINGS"`, which could not match
    // anything: the app renders "Admin Settings" (mixed case, and `text="…"`
    // is an exact case-sensitive match), and it renders it inside a node's ⋯
    // dropdown, which is closed. So this always reported false.
    //
    // TopBar puts `title="Workspace Administrator"` on the avatar button when
    // the user's role is Admin or Owner, and that is on screen from the moment
    // the workspace loads.
    // See waitForAdminRole for why this is not a 10s wall: the role trails the
    // workspace load, and two different failures used to share one FAIL.
    results.isAdmin = await waitForAdminRole(page);

    // ========================================================================
    // STEP 2: Get Initial Tree Structure (Verify Workspace Root)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Get Initial Tree Structure');
    console.log('-'.repeat(50));

    // The local getInitialTreeStructure this replaces probed
    // `window.__workspaceContext`, `[data-workspace-id]` and a
    // `currentWorkspace` storage key — none of which exist in the app — and
    // then fell back to the 'workspace-root' sentinel, so `!== null` was
    // always true and `initialTreeLoaded` could not fail.
    workspaceRootId = await getWorkspaceRootId(page);
    console.log(`  Workspace root ID: ${workspaceRootId}`);

    const rootNode = workspaceRootId ? await getNodeViaProtocol(page, workspaceRootId) : null;
    const initialTree = await getTreeStructure(page);
    results.initialTreeLoaded =
      rootNode !== null &&
      rootNode.entity_type === 'Workspace' &&
      rootNode.depth === 0 &&
      initialTree !== null;
    console.log(`  Initial tree loaded: ${results.initialTreeLoaded ? 'PASS' : 'FAIL'}`);

    if (!workspaceRootId) {
      throw new Error('Could not determine the workspace root id');
    }

    // ========================================================================
    // STEP 3: Create Office Node (Child at depth 1)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Create Office Node');
    console.log('-'.repeat(50));

    testOfficeId = await createNodeViaUI(page, 'Office', TEST_OFFICE_NAME, 'Test office description');
    results.officeNodeCreated = testOfficeId !== null;

    let officeDepthCorrect = false;
    if (testOfficeId) {
      // Depth is not visible in the DOM. The check this replaces looked for
      // `section:has-text("OFFICES")` and `section:has-text("ROOMS")` — the
      // sidebar has neither; it renders one SidebarGroup titled "HIERARCHY"
      // (HierarchySidebar passes title="HIERARCHY") with the whole tree inside
      // it. Those locators matched nothing, so this result was always FAIL.
      officeDepthCorrect = await verifyNodeDepth(page, testOfficeId, 1);
      console.log(`  Office depth is 1: ${officeDepthCorrect ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_office_created`);

    // ========================================================================
    // STEP 4: Create Room Node (Child at depth 2, under office)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Create Room Node Under Office');
    console.log('-'.repeat(50));

    let roomDepthCorrect = false;
    if (results.officeNodeCreated && testOfficeId) {
      await navigateToNodeViaUI(page, TEST_OFFICE_NAME);
      testRoomId = await createNodeViaUI(
        page,
        'Room',
        TEST_ROOM_NAME,
        'Test room description',
        TEST_OFFICE_NAME,
      );
      results.roomNodeCreated = testRoomId !== null;

      if (testRoomId) {
        roomDepthCorrect = await verifyNodeDepth(page, testRoomId, 2);
        console.log(`  Room depth is 2: ${roomDepthCorrect ? 'PASS' : 'FAIL'}`);

        // The old check here was `nodeExistsInSidebar(TEST_ROOM_NAME)` — the
        // room's presence somewhere in the list, which says nothing about its
        // parent. A room created at the workspace root would have passed it.
        results.parentChildRelationshipMaintained =
          await verifyNodeParent(page, testRoomId, testOfficeId);
        console.log(`  Room's parent is the office: ${results.parentChildRelationshipMaintained ? 'PASS' : 'FAIL'}`);
      }
    }

    results.depthCalculatedCorrectly = officeDepthCorrect && roomDepthCorrect;

    await takeScreenshot(page, `${ADMIN_USER}_room_created`);

    // ========================================================================
    // STEP 5: Get Single Node (GetNode)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Get Single Node');
    console.log('-'.repeat(50));

    if (testOfficeId) {
      const office = await getNodeViaProtocol(page, testOfficeId);
      results.nodeRetrieved =
        office !== null &&
        office.name === TEST_OFFICE_NAME &&
        typeof office.entity_type === 'object' &&
        office.entity_type.Child === 'Office';
      console.log(`  GetNode returned the office we created: ${results.nodeRetrieved ? 'PASS' : 'FAIL'}`);
    }

    // ========================================================================
    // STEP 6: List Nodes with Filter (ListNodes with entity_types)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: List Nodes with Filter');
    console.log('-'.repeat(50));

    // This step is named for ListNodes-with-entity_types, so exercise it. The
    // previous version looked for the office inside
    // `section:has-text("OFFICES")` — a section the app does not render — and
    // therefore never verified the filter at all.
    if (testOfficeId) {
      // No parentId: this step is about whether the entity_types filter works,
      // and scoping it to the workspace root made it return nothing at all.
      // The server synthesises a Workspace node for the 'workspace-root'
      // sentinel in GetNode but never stores one (get_all_nodes has no such
      // entry), so asking for that id's children matches no rows — the filter
      // was fine, the parent was a ghost.
      const offices = await listNodesViaProtocol(page, {
        entityTypes: [{ Child: 'Office' }],
      });
      const nonOfficeLeaked = offices.some(
        n => typeof n.entity_type !== 'object' || n.entity_type.Child !== 'Office'
      );
      results.nodesListedWithFilter =
        offices.some(n => n.id === testOfficeId) && !nonOfficeLeaked;
      console.log(`  ListNodes(entity_types=[Office]) returned ${offices.length} nodes`);
      console.log(`  Contains our office, and only Offices: ${results.nodesListedWithFilter ? 'PASS' : 'FAIL'}`);
    }

    // ========================================================================
    // STEP 7: Get Full Tree Structure (GetTreeStructure)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: Get Full Tree Structure');
    console.log('-'.repeat(50));

    if (testOfficeId && testRoomId) {
      const tree = await getTreeStructure(page);
      const officeInTree = tree ? findInTree(tree, testOfficeId) : null;
      // The room has to appear *under the office*, not merely somewhere in the
      // tree — that nesting is what GetTreeStructure is for.
      results.fullTreeStructureLoaded =
        officeInTree !== null && officeInTree.children.some(c => c.node.id === testRoomId);
      console.log(`  Room nested under office in GetTreeStructure: ${results.fullTreeStructureLoaded ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_tree_structure`);

    // ========================================================================
    // STEP 8: Update Node Properties (UpdateNode)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Update Node Properties');
    console.log('-'.repeat(50));

    const updatedOfficeName = `${TEST_OFFICE_NAME}_Updated`;
    if (testOfficeId) {
      const submitted = await updateNodeViaUI(page, TEST_OFFICE_NAME, {
        name: updatedOfficeName,
        description: 'Updated description',
      });

      // Read the node back by id rather than searching the sidebar for the new
      // name: the id survives the rename, and a name search would also match
      // the pre-rename name, since `TestOffice_<ts>_Updated` contains
      // `TestOffice_<ts>`.
      const office = submitted ? await getNodeViaProtocol(page, testOfficeId) : null;
      results.nodeUpdated =
        office !== null &&
        office.name === updatedOfficeName &&
        office.description === 'Updated description';
      console.log(`  Node renamed and re-described: ${results.nodeUpdated ? 'PASS' : 'FAIL'}`);
    }

    await takeScreenshot(page, `${ADMIN_USER}_node_updated`);

    // ========================================================================
    // STEP 9: Build a second subtree for the delete tests
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 9: Create Second Office and Rooms');
    console.log('-'.repeat(50));

    testOffice2Id = await createNodeViaUI(page, 'Office', TEST_OFFICE_2_NAME, 'Second test office');
    console.log(`  Second office created: ${testOffice2Id !== null}`);

    if (results.nodeUpdated) {
      await navigateToNodeViaUI(page, updatedOfficeName);
      testRoom2Id = await createNodeViaUI(
        page,
        'Room',
        TEST_ROOM_2_NAME,
        'Second test room',
        updatedOfficeName,
      );
      console.log(`  Second room created: ${testRoom2Id !== null}`);
    }

    // ========================================================================
    // STEP 10: MoveNode — SKIPPED
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 10: MoveNode — SKIPPED');
    console.log('-'.repeat(50));
    console.log("  The sidebar exposes no move affordance: TreeNodeItem's menu offers");
    console.log('  Edit, Admin Settings, Add Child, Set as Default and Delete, and there');
    console.log('  is no drag-and-drop. MoveNode is covered at the protocol level in');
    console.log('  tree-move-operations.test.ts.');

    // ========================================================================
    // STEP 11: Delete a node that has children (the UI always cascades)
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 11: Delete a Parent Node');
    console.log('-'.repeat(50));

    if (testOffice2Id) {
      const office2Id = testOffice2Id;
      await navigateToNodeViaUI(page, TEST_OFFICE_2_NAME);
      tempRoomId = await createNodeViaUI(
        page,
        'Room',
        TEMP_ROOM_NAME,
        'Temporary room',
        TEST_OFFICE_2_NAME,
      );

      if (tempRoomId) {
        const deleted = await deleteNodeViaUI(page, TEST_OFFICE_2_NAME);
        console.log(`  Office removed from the sidebar: ${deleted}`);

        // HierarchySidebar always passes cascade=true, so both the office and
        // its room must be gone. The result this replaces expected the delete
        // to be *refused* and logged a FAIL when it cascaded, i.e. it failed
        // the app for behaving as written.
        const officeGone = (await getNodeViaProtocol(page, office2Id)) === null;
        const tempRoomGone = (await getNodeViaProtocol(page, tempRoomId)) === null;
        results.uiDeleteCascadesToChildren = deleted && officeGone && tempRoomGone;
        console.log(`  Office gone: ${officeGone}, child room gone: ${tempRoomGone}`);
        console.log(`  UI delete cascades: ${results.uiDeleteCascadesToChildren ? 'PASS' : 'FAIL'}`);

        // An orphan is the specific bad outcome: parent deleted, child left
        // behind pointing at an id that no longer resolves.
        results.orphanNodePrevented = !(officeGone && !tempRoomGone);
        console.log(`  No orphaned child: ${results.orphanNodePrevented ? 'PASS' : 'FAIL'}`);

        if (officeGone) testOffice2Id = null;
      }
    }

    // ========================================================================
    // STEP 12: Cascade delete of the first office
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 12: Cascade Delete');
    console.log('-'.repeat(50));

    if (results.nodeUpdated && testOfficeId) {
      const officeId = testOfficeId;
      const deleted = await deleteNodeViaUI(page, updatedOfficeName);

      const officeGone = (await getNodeViaProtocol(page, officeId)) === null;
      const roomGone = testRoomId ? (await getNodeViaProtocol(page, testRoomId)) === null : true;
      const room2Gone = testRoom2Id ? (await getNodeViaProtocol(page, testRoom2Id)) === null : true;

      results.deleteWithCascadeSucceeded = deleted && officeGone && roomGone && room2Gone;
      console.log(`  Office deleted: ${officeGone}`);
      console.log(`  Both rooms deleted: ${roomGone && room2Gone}`);
      console.log(`  Cascade delete: ${results.deleteWithCascadeSucceeded ? 'PASS' : 'FAIL'}`);

      if (officeGone) testOfficeId = null;
    }

    await takeScreenshot(page, `${ADMIN_USER}_after_delete`);

    // ========================================================================
    // STEP 13: Cycle prevention — SKIPPED
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 13: Cycle Prevention — SKIPPED');
    console.log('-'.repeat(50));
    console.log('  A cycle can only be created by MoveNode, which this UI does not expose,');
    console.log('  so there is nothing to drive from here. This result used to be assigned');
    console.log('  `true` unconditionally with the comment "TreeValidator handles this" — a');
    console.log("  PASS printed for an assertion that was never made. TreeValidator's cycle");
    console.log('  and self-move rejections are exercised in tree-move-operations.test.ts.');

    // ========================================================================
    // CLEANUP
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('CLEANUP');
    console.log('-'.repeat(50));

    if (await nodeExistsInSidebar(page, TEST_OFFICE_2_NAME, 2000)) {
      await deleteNodeViaUI(page, TEST_OFFICE_2_NAME);
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

    console.log('\nCore Functionality:');
    console.log(`  Account Creation:           ${results.accountCreation ? 'PASS' : 'FAIL'}`);
    console.log(`  Workspace Loaded:           ${results.workspaceLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Is Admin:                   ${results.isAdmin ? 'PASS' : 'FAIL'}`);

    console.log('\nTree Structure Tests:');
    console.log(`  Initial Tree Loaded:        ${results.initialTreeLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Office Node Created:        ${results.officeNodeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Node Created:          ${results.roomNodeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Node Retrieved:             ${results.nodeRetrieved ? 'PASS' : 'FAIL'}`);
    console.log(`  Nodes Listed With Filter:   ${results.nodesListedWithFilter ? 'PASS' : 'FAIL'}`);
    console.log(`  Full Tree Structure:        ${results.fullTreeStructureLoaded ? 'PASS' : 'FAIL'}`);
    console.log(`  Node Updated:               ${results.nodeUpdated ? 'PASS' : 'FAIL'}`);

    console.log('\nDelete Operations:');
    console.log(`  UI Delete Cascades:         ${results.uiDeleteCascadesToChildren ? 'PASS' : 'FAIL'}`);
    console.log(`  Delete With Cascade:        ${results.deleteWithCascadeSucceeded ? 'PASS' : 'FAIL'}`);
    console.log(`  No Orphans Left Behind:     ${results.orphanNodePrevented ? 'PASS' : 'FAIL'}`);

    console.log('\nDepth/Relationship Tests:');
    console.log(`  Depth Calculated:           ${results.depthCalculatedCorrectly ? 'PASS' : 'FAIL'}`);
    console.log(`  Parent-Child Maintained:    ${results.parentChildRelationshipMaintained ? 'PASS' : 'FAIL'}`);

    console.log('\nSkipped (no UI affordance):');
    console.log('  MoveNode                    SKIP — no move control in the sidebar');
    console.log('  Cycle Prevention            SKIP — requires MoveNode');

    // Every result printed above is gated. The old list read four of them
    // (account, workspace, office created, room created), so wrong depths, a
    // room attached to the wrong parent, a rename that did not take, a filter
    // that returned the wrong set and a cascade that orphaned children all
    // printed FAIL against a run that exited 0.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.isAdmin,
      results.initialTreeLoaded,
      results.officeNodeCreated,
      results.roomNodeCreated,
      results.nodeRetrieved,
      results.nodesListedWithFilter,
      results.fullTreeStructureLoaded,
      results.nodeUpdated,
      results.uiDeleteCascadesToChildren,
      results.deleteWithCascadeSucceeded,
      results.orphanNodePrevented,
      results.depthCalculatedCorrectly,
      results.parentChildRelationshipMaintained,
    ];

    const overallPass = criticalTests.every(Boolean);

    console.log('\n' + '='.repeat(60));
    console.log(`OVERALL: ${overallPass ? 'TEST PASSED' : 'TEST FAILED'}`);
    console.log('='.repeat(60));

    if (browser) {
      await browser.close();
    }

    harness.finalize(overallPass, results as unknown as Record<string, any>);
    return overallPass;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
