/**
 * Hierarchy Navigation Integration Test
 *
 * Validates deep hierarchy creation and sidebar navigation:
 * 1. Create custom node types: Alpha, Beta, Charlie, Delta, Epsilon
 * 2. Update tree schema for 5-level nesting
 * 3. Create nodes at each level via protocol
 * 4. Verify correct depth values
 * 5. Navigate sidebar at each level
 * 6. Verify expand/collapse behavior
 * 7. Test UI-based node creation at each level
 */

import type { Page, Browser } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  waitForTreeDataLoaded,
  startDiagnostics,
  // Tree helpers
  createNodeViaProtocol,
  getTreeStructure,
  getWorkspaceRootId,
  verifyNodeDepth,
  countTreeNodes,
  deleteNodeViaProtocol,
  getTreeSchema,
  updateTreeSchema,
  createNodeType,
  nodeExistsInUI,
  navigateToNodeViaUI,
  treeRow,
  isHiddenWithin,
  type DiagnosticsHandle,
  type TreeSchema,
  type TreeNode,
  // Test framework
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { isVisibleWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  // Setup
  accountCreation: boolean;
  workspaceLoaded: boolean;

  // Custom Node Types
  alphaTypeCreated: boolean;
  betaTypeCreated: boolean;
  charlieTypeCreated: boolean;
  deltaTypeCreated: boolean;
  epsilonTypeCreated: boolean;
  schemaUpdated: boolean;

  // Hierarchy Creation
  alphaNodeCreated: boolean;
  betaNodeCreated: boolean;
  charlieNodeCreated: boolean;
  deltaNodeCreated: boolean;
  epsilonNodeCreated: boolean;

  // Depth Verification
  alphaDepthCorrect: boolean;
  betaDepthCorrect: boolean;
  charlieDepthCorrect: boolean;
  deltaDepthCorrect: boolean;
  epsilonDepthCorrect: boolean;
  treeStructureValid: boolean;

  // Sidebar Navigation
  allNodesVisibleInSidebar: boolean;
  alphaNavigation: boolean;
  betaNavigation: boolean;
  charlieNavigation: boolean;
  deltaNavigation: boolean;
  epsilonNavigation: boolean;

  // Expand/Collapse
  collapseHidesChildren: boolean;
  expandShowsChildren: boolean;

  // Sibling Nodes
  siblingNodesCreated: boolean;
  siblingNodesVisible: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `hierarchy_nav_${timestamp}`;

const LEVEL_NAMES = ['Alpha', 'Beta', 'Charlie', 'Delta', 'Epsilon'] as const;
type LevelName = typeof LEVEL_NAMES[number];

// ============================================================================
// Helper Functions
// ============================================================================

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

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'HIERARCHY NAVIGATION INTEGRATION TEST',
    reportFileName: 'HIERARCHY_NAVIGATION_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Levels: ${LEVEL_NAMES.join(' → ')}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    alphaTypeCreated: false,
    betaTypeCreated: false,
    charlieTypeCreated: false,
    deltaTypeCreated: false,
    epsilonTypeCreated: false,
    schemaUpdated: false,
    alphaNodeCreated: false,
    betaNodeCreated: false,
    charlieNodeCreated: false,
    deltaNodeCreated: false,
    epsilonNodeCreated: false,
    alphaDepthCorrect: false,
    betaDepthCorrect: false,
    charlieDepthCorrect: false,
    deltaDepthCorrect: false,
    epsilonDepthCorrect: false,
    treeStructureValid: false,
    allNodesVisibleInSidebar: false,
    alphaNavigation: false,
    betaNavigation: false,
    charlieNavigation: false,
    deltaNavigation: false,
    epsilonNavigation: false,
    collapseHidesChildren: false,
    expandShowsChildren: false,
    siblingNodesCreated: false,
    siblingNodesVisible: false,
  };

  let browser: Browser | null = null;
  let page: Page | null = null;
  let diagnostics: DiagnosticsHandle | null = null;

  const createdNodeIds: string[] = [];

  try {
    const setup = await createBrowser();
    browser = setup.browser;
    page = await setup.context.newPage();
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

    // waitForWorkspaceLoaded reports whether the workspace actually finished
    // loading. Assigning `true` unconditionally recorded a PASS even when it
    // timed out, and every later failure then looked unexplained.
    results.workspaceLoaded = await waitForWorkspaceLoaded(page);
    await takeScreenshot(page, `${ADMIN_USER}_ready`);

    const workspaceRootId = await getWorkspaceRootId(page);
    if (!workspaceRootId) {
      throw new Error('Failed to get workspace root ID');
    }
    console.log(`  Workspace root ID: ${workspaceRootId}`);

    // ========================================================================
    // STEP 2: Create Custom Node Types
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Create Custom Node Types');
    console.log('-'.repeat(50));

    // Create each level's node type
    const typeResults: Record<LevelName, boolean> = {
      Alpha: false,
      Beta: false,
      Charlie: false,
      Delta: false,
      Epsilon: false,
    };

    for (const name of LEVEL_NAMES) {
      const parentType = LEVEL_NAMES.indexOf(name) === 0
        ? 'Workspace'
        : LEVEL_NAMES[LEVEL_NAMES.indexOf(name) - 1];

      console.log(`\n  Creating node type "${name}" (parent: ${parentType})...`);
      typeResults[name] = await createNodeType(
        page,
        name,
        `${name} Level`,
        [parentType],
        undefined
      );
      console.log(`  ${name}: ${typeResults[name] ? 'SUCCESS' : 'FAILED'}`);
      await sleep(200);
    }

    results.alphaTypeCreated = typeResults.Alpha;
    results.betaTypeCreated = typeResults.Beta;
    results.charlieTypeCreated = typeResults.Charlie;
    results.deltaTypeCreated = typeResults.Delta;
    results.epsilonTypeCreated = typeResults.Epsilon;

    // ========================================================================
    // STEP 3: Update Tree Schema
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Update Tree Schema');
    console.log('-'.repeat(50));

    const currentSchema = await getTreeSchema(page);
    if (currentSchema) {
      const newSchema: TreeSchema = {
        ...currentSchema,
        max_depth: 6,
        rules: [
          // Keep existing rules for Office/Room
          ...currentSchema.rules,
          // Add our custom level rules
          { parent_type: 'Workspace', allowed_child_types: [...(currentSchema.rules.find(r => r.parent_type === 'Workspace')?.allowed_child_types || []), 'Alpha'] },
          { parent_type: 'Alpha', allowed_child_types: ['Beta'] },
          { parent_type: 'Beta', allowed_child_types: ['Charlie'] },
          { parent_type: 'Charlie', allowed_child_types: ['Delta'] },
          { parent_type: 'Delta', allowed_child_types: ['Epsilon'] },
          { parent_type: 'Epsilon', allowed_child_types: [] },
        ].reduce((acc, rule) => {
          // Deduplicate rules by parent_type, merging allowed_child_types
          const existing = acc.find(r => r.parent_type === rule.parent_type);
          if (existing) {
            const mergedTypes = new Set([...existing.allowed_child_types, ...rule.allowed_child_types]);
            existing.allowed_child_types = [...mergedTypes];
          } else {
            acc.push({ ...rule });
          }
          return acc;
        }, [] as Array<{ parent_type: string; allowed_child_types: string[] }>),
      };

      console.log('  Updating schema with 5-level hierarchy rules...');
      console.log('  Rules:', JSON.stringify(newSchema.rules, null, 2));
      results.schemaUpdated = await updateTreeSchema(page, newSchema);
      console.log(`  Schema update: ${results.schemaUpdated ? 'SUCCESS' : 'FAILED'}`);
      await sleep(500);
    } else {
      console.log('  WARNING: Could not get tree schema');
    }

    // ========================================================================
    // STEP 4: Create 5-Level Hierarchy
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Create 5-Level Hierarchy');
    console.log('-'.repeat(50));

    const nodeIds: Record<LevelName, string | null> = {
      Alpha: null,
      Beta: null,
      Charlie: null,
      Delta: null,
      Epsilon: null,
    };

    let parentId = workspaceRootId;
    for (let i = 0; i < LEVEL_NAMES.length; i++) {
      const levelName = LEVEL_NAMES[i];
      const nodeName = `${levelName}_${timestamp}`;
      const entityType = { Child: levelName };

      console.log(`\n  Creating ${levelName} node (depth ${i + 1})...`);
      const result = await createNodeViaProtocol(
        page,
        parentId,
        entityType,
        nodeName,
        `${levelName} level node for hierarchy navigation test`
      );

      if (result.success && result.nodeId) {
        nodeIds[levelName] = result.nodeId;
        createdNodeIds.push(result.nodeId);
        parentId = result.nodeId;
        console.log(`  ${levelName}: ${result.nodeId} (depth ${i + 1})`);
      } else {
        console.log(`  ${levelName} FAILED: ${result.error}`);
        break;
      }

      await sleep(200);
    }

    results.alphaNodeCreated = nodeIds.Alpha !== null;
    results.betaNodeCreated = nodeIds.Beta !== null;
    results.charlieNodeCreated = nodeIds.Charlie !== null;
    results.deltaNodeCreated = nodeIds.Delta !== null;
    results.epsilonNodeCreated = nodeIds.Epsilon !== null;

    // ========================================================================
    // STEP 5: Verify Depths
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Verify Depths');
    console.log('-'.repeat(50));

    for (let i = 0; i < LEVEL_NAMES.length; i++) {
      const levelName = LEVEL_NAMES[i];
      const nodeId = nodeIds[levelName];
      if (nodeId) {
        const expectedDepth = i + 1;
        const correct = await verifyNodeDepth(page, nodeId, expectedDepth);
        const key = `${levelName.toLowerCase()}DepthCorrect` as keyof TestResults;
        (results as unknown as Record<string, boolean>)[key] = correct;
      }
    }

    // Verify full tree structure
    console.log('\n  Verifying full tree structure...');
    const fullTree = await getTreeStructure(page, workspaceRootId);
    if (fullTree) {
      const maxDepth = getMaxTreeDepth(fullTree);
      const totalNodes = countTreeNodes(fullTree);
      console.log(`  Tree: ${totalNodes} nodes, max depth: ${maxDepth}`);
      results.treeStructureValid = maxDepth >= 5;
    }

    await takeScreenshot(page, `${ADMIN_USER}_hierarchy_created`);

    // ========================================================================
    // STEP 6: Create Sibling Nodes at Each Level
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: Create Sibling Nodes');
    console.log('-'.repeat(50));

    // Track attempts as well as successes: "created >= 4" passed while half
    // the sibling creations were failing, because 8 are attempted.
    let attemptedSiblings = 0;
    const siblingNames: string[] = [];
    for (let i = 0; i < LEVEL_NAMES.length - 1; i++) {
      const levelName = LEVEL_NAMES[i];
      const childType = LEVEL_NAMES[i + 1];
      const parentNodeId = nodeIds[levelName];
      if (!parentNodeId) continue;

      // Create 2 siblings at each level
      for (let s = 1; s <= 2; s++) {
        const siblingName = `${childType}_sibling${s}_${timestamp}`;
        attemptedSiblings++;
        const result = await createNodeViaProtocol(
          page,
          parentNodeId,
          { Child: childType },
          siblingName,
          `Sibling ${s} at ${childType} level`
        );
        if (result.success && result.nodeId) {
          createdNodeIds.push(result.nodeId);
          siblingNames.push(siblingName);
        } else {
          console.log(`  Sibling ${siblingName} FAILED: ${result.error}`);
        }
        await sleep(100);
      }
    }

    results.siblingNodesCreated =
      attemptedSiblings > 0 && siblingNames.length === attemptedSiblings;
    console.log(`  Created ${siblingNames.length}/${attemptedSiblings} sibling nodes`);

    // ========================================================================
    // STEP 7: Sidebar Navigation
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: Sidebar Navigation');
    console.log('-'.repeat(50));

    // Wait for tree data to show up in sidebar
    await waitForTreeDataLoaded(page, 15000);
    await sleep(2000);

    // Reload the page to pick up new nodes in sidebar
    await page.reload();
    await waitForWorkspaceLoaded(page);
    await waitForTreeDataLoaded(page, 15000);
    await sleep(2000);

    await takeScreenshot(page, `${ADMIN_USER}_sidebar_before_nav`);

    // Check all nodes visible
    let allVisible = true;
    for (const levelName of LEVEL_NAMES) {
      const nodeName = `${levelName}_${timestamp}`;
      const visible = await nodeExistsInUI(page, nodeName);
      if (!visible) {
        console.log(`  ${levelName} NOT visible in sidebar`);
        allVisible = false;
      }
    }
    results.allNodesVisibleInSidebar = allVisible;

    // Navigate to each level
    for (const levelName of LEVEL_NAMES) {
      const nodeName = `${levelName}_${timestamp}`;
      console.log(`\n  Navigating to ${levelName}...`);
      const success = await navigateToNodeViaUI(page, nodeName);
      const key = `${levelName.toLowerCase()}Navigation` as keyof TestResults;
      (results as unknown as Record<string, boolean>)[key] = success;

      if (success) {
        await sleep(500);
        await takeScreenshot(page, `${ADMIN_USER}_nav_${levelName.toLowerCase()}`);
      }
    }

    // Check sibling visibility. Every sibling that was created should be
    // reachable in the sidebar -- nodeExistsInUI clicks down to each one -- so
    // check them all rather than spot-checking one and calling it a pass.
    let allSiblingsVisible = siblingNames.length > 0;
    for (const name of siblingNames) {
      // 5s rather than the 10s default: the tree has already been reloaded and
      // waited on above, and a miss here costs the full timeout eight times over.
      if (!(await nodeExistsInUI(page, name, 5000))) {
        console.log(`  Sibling ${name} NOT visible in sidebar`);
        allSiblingsVisible = false;
      }
    }
    results.siblingNodesVisible = allSiblingsVisible;
    console.log(`  Siblings visible: ${results.siblingNodesVisible}`);

    await takeScreenshot(page, `${ADMIN_USER}_full_hierarchy`);

    // ========================================================================
    // STEP 8: Expand/Collapse Test
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Expand/Collapse Test');
    console.log('-'.repeat(50));

    // The focused sidebar unfolds only the selected node's children; a peer of
    // the selection unfolds in place with its peek chevron. Beta has children
    // and a peer with none (Beta_sibling1), so selecting the peer puts Beta's
    // chevron on screen with Beta's children folded away.
    const peerName = `${LEVEL_NAMES[1]}_sibling1_${timestamp}`;
    const charlieName = `${LEVEL_NAMES[2]}_${timestamp}`;
    if (nodeIds.Beta && siblingNames.includes(peerName) && (await navigateToNodeViaUI(page, peerName))) {
      const toggleBtn = page.getByTestId(`tree-node-toggle-${nodeIds.Beta}`);

      if (await isVisibleWithin(toggleBtn, 3000)) {
        const charlieRow = treeRow(page, charlieName).first();
        const foldedAtFirst = await isHiddenWithin(charlieRow, 3000);

        // Expand first, so that the collapse below is measured against a row
        // that was on screen -- "hidden" for a row never shown proves nothing.
        await toggleBtn.click();
        results.expandShowsChildren = foldedAtFirst && (await isVisibleWithin(charlieRow, 5000));
        console.log(`  Expand shows children: ${results.expandShowsChildren}`);

        await takeScreenshot(page, `${ADMIN_USER}_expanded`);

        await toggleBtn.click();
        results.collapseHidesChildren = results.expandShowsChildren && (await isHiddenWithin(charlieRow, 5000));
        console.log(`  Collapse hides children: ${results.collapseHidesChildren}`);

        await takeScreenshot(page, `${ADMIN_USER}_collapsed`);
      } else {
        console.log('  Peek toggle not found for Beta');
      }
    } else {
      console.log(`  Could not select ${peerName}, so Beta could not be peeked`);
    }

    // ========================================================================
    // CLEANUP
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('CLEANUP');
    console.log('-'.repeat(50));

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

    console.log('\nCustom Node Types:');
    for (const name of LEVEL_NAMES) {
      const key = `${name.toLowerCase()}TypeCreated` as keyof TestResults;
      console.log(`  ${name} Type:${' '.repeat(20 - name.length)}${results[key] ? 'PASS' : 'FAIL'}`);
    }
    console.log(`  Schema Updated:               ${results.schemaUpdated ? 'PASS' : 'FAIL'}`);

    console.log('\nHierarchy Creation:');
    for (const name of LEVEL_NAMES) {
      const key = `${name.toLowerCase()}NodeCreated` as keyof TestResults;
      console.log(`  ${name} Node:${' '.repeat(20 - name.length)}${results[key] ? 'PASS' : 'FAIL'}`);
    }

    console.log('\nDepth Verification:');
    for (const name of LEVEL_NAMES) {
      const key = `${name.toLowerCase()}DepthCorrect` as keyof TestResults;
      console.log(`  ${name} Depth:${' '.repeat(19 - name.length)}${results[key] ? 'PASS' : 'FAIL'}`);
    }
    console.log(`  Tree Structure Valid:         ${results.treeStructureValid ? 'PASS' : 'FAIL'}`);

    console.log('\nSidebar Navigation:');
    console.log(`  All Nodes Visible:            ${results.allNodesVisibleInSidebar ? 'PASS' : 'FAIL'}`);
    for (const name of LEVEL_NAMES) {
      const key = `${name.toLowerCase()}Navigation` as keyof TestResults;
      console.log(`  ${name} Nav:${' '.repeat(21 - name.length)}${results[key] ? 'PASS' : 'FAIL'}`);
    }

    console.log('\nExpand/Collapse:');
    console.log(`  Collapse Hides Children:      ${results.collapseHidesChildren ? 'PASS' : 'FAIL'}`);
    console.log(`  Expand Shows Children:        ${results.expandShowsChildren ? 'PASS' : 'FAIL'}`);

    console.log('\nSibling Nodes:');
    console.log(`  Siblings Created:             ${results.siblingNodesCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Siblings Visible:             ${results.siblingNodesVisible ? 'PASS' : 'FAIL'}`);

    // Determine overall pass/fail
    // Every result printed above is gated. The previous list stopped at the
    // protocol-level results, so the whole sidebar half of this test — node
    // types, navigation, expand/collapse, siblings — was printed as FAIL and
    // then thrown away, which is exactly the surface the test exists to cover.
    // All of it is single-user and driven off deterministic protocol responses.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.alphaTypeCreated,
      results.betaTypeCreated,
      results.charlieTypeCreated,
      results.deltaTypeCreated,
      results.epsilonTypeCreated,
      results.schemaUpdated,
      results.alphaNodeCreated,
      results.betaNodeCreated,
      results.charlieNodeCreated,
      results.deltaNodeCreated,
      results.epsilonNodeCreated,
      results.alphaDepthCorrect,
      results.betaDepthCorrect,
      results.charlieDepthCorrect,
      results.deltaDepthCorrect,
      results.epsilonDepthCorrect,
      results.treeStructureValid,
      results.allNodesVisibleInSidebar,
      results.alphaNavigation,
      results.betaNavigation,
      results.charlieNavigation,
      results.deltaNavigation,
      results.epsilonNavigation,
      results.collapseHidesChildren,
      results.expandShowsChildren,
      results.siblingNodesCreated,
      results.siblingNodesVisible,
    ];

    const allCriticalPassed = criticalTests.every(Boolean);

    if (browser) {
      await browser.close();
    }

    await harness.finalize(allCriticalPassed, {
      ...results,
      metrics: {
        levels: LEVEL_NAMES.length,
        nodesCreated: createdNodeIds.length,
      },
    } as unknown as Record<string, unknown>);

    return allCriticalPassed;
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
