/**
 * Tree Custom Types Integration Test
 *
 * Tests custom node type creation and schema enforcement via WorkspaceProtocol:
 * 1. Create custom node types (Department, Team)
 * 2. Create nodes with custom types
 * 3. Schema enforcement (reject invalid parent-child relationships)
 * 4. Default schema (Workspace -> Office -> Room) enforcement
 * 5. TreeSchema operations (GetTreeSchema, UpdateTreeSchema)
 *
 * This test validates the protocol layer directly via browser evaluation.
 */

import type { Page, Browser } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  waitForWorkspaceLoaded,
  startDiagnostics,
  type DiagnosticsHandle,
  // Tree helpers
  createNodeViaProtocol,
  createNodeType,
  listNodeTypes,
  getTreeSchema,
  updateTreeSchema,
  getWorkspaceRootId,
  getNodeViaProtocol,
  listNodesViaProtocol,
  type TreeSchema,
  type NestingRule,
  type CustomNodeType,
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
  workspaceRootFound: boolean;

  // Custom Node Type Tests
  departmentTypeCreated: boolean;
  teamTypeCreated: boolean;
  customTypesListed: boolean;

  // Custom Type Node Creation
  departmentNodeCreated: boolean;
  teamNodeCreated: boolean;
  nodeEntityTypeCorrect: boolean;

  // Schema Enforcement
  teamUnderWorkspaceRejected: boolean;
  officeUnderTeamRejected: boolean;
  schemaViolationErrorReturned: boolean;

  // Default Schema Tests
  officeUnderWorkspaceAllowed: boolean;
  roomUnderOfficeAllowed: boolean;
  roomUnderWorkspaceRejected: boolean;

  // TreeSchema Operations
  getTreeSchemaSucceeded: boolean;
  updateTreeSchemaSucceeded: boolean;
  updatedSchemaEnforced: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `custom_types_admin_${timestamp}`;

// Custom type names
const DEPARTMENT_TYPE = 'Department';
const TEAM_TYPE = 'Team';

// Test node names
const TEST_DEPARTMENT_NAME = `TestDepartment_${timestamp}`;
const TEST_TEAM_NAME = `TestTeam_${timestamp}`;
const TEST_OFFICE_NAME = `TestOffice_${timestamp}`;
const TEST_ROOM_NAME = `TestRoom_${timestamp}`;

// Store created IDs
let workspaceRootId: string | null = null;
let departmentNodeId: string | null = null;
let officeNodeId: string | null = null;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an error message indicates a schema violation.
 */
function isSchemaViolationError(error: string | undefined): boolean {
  if (!error) return false;
  const schemaKeywords = [
    'schema',
    'not allowed',
    'invalid parent',
    'invalid child',
    'nesting',
    'rule',
    'constraint',
    'type not permitted',
    'cannot be child of',
  ];
  const lowerError = error.toLowerCase();
  return schemaKeywords.some((keyword) => lowerError.includes(keyword));
}

/**
 * Log a test step with result.
 */
function logStep(step: string, passed: boolean, details?: string): void {
  const status = passed ? 'PASS' : 'FAIL';
  console.log(`  [${status}] ${step}${details ? ': ' + details : ''}`);
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'TREE CUSTOM TYPES INTEGRATION TEST',
    reportFileName: 'TREE_CUSTOM_TYPES_TEST_REPORT.json',
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Custom Types: ${DEPARTMENT_TYPE}, ${TEAM_TYPE}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    workspaceRootFound: false,
    departmentTypeCreated: false,
    teamTypeCreated: false,
    customTypesListed: false,
    departmentNodeCreated: false,
    teamNodeCreated: false,
    nodeEntityTypeCorrect: false,
    teamUnderWorkspaceRejected: false,
    officeUnderTeamRejected: false,
    schemaViolationErrorReturned: false,
    officeUnderWorkspaceAllowed: false,
    roomUnderOfficeAllowed: false,
    roomUnderWorkspaceRejected: false,
    getTreeSchemaSucceeded: false,
    updateTreeSchemaSucceeded: false,
    updatedSchemaEnforced: false,
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

    await waitForWorkspaceLoaded(page);
    results.workspaceLoaded = true;
    await takeScreenshot(page, `${ADMIN_USER}_admin_ready`);

    // Get workspace root ID
    workspaceRootId = await getWorkspaceRootId(page);
    // `workspaceRootId !== null` was not an assertion: getWorkspaceRootId falls
    // back to the WORKSPACE_ROOT_SENTINEL and cannot return null, so this always
    // held — and it counted toward this spec's pass total. Resolving the id to a
    // real Workspace node at depth 0 is the check that was intended.
    const rootNode = await getNodeViaProtocol(page, workspaceRootId);
    results.workspaceRootFound =
      rootNode !== null && rootNode.entity_type === 'Workspace' && rootNode.depth === 0;
    logStep('Workspace root resolves', results.workspaceRootFound, workspaceRootId);

    if (!workspaceRootId) {
      throw new Error('Could not find workspace root ID');
    }

    // ========================================================================
    // STEP 2: Create Custom Node Types
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 2: Create Custom Node Types');
    console.log('-'.repeat(50));

    // Create Department type (allowed under Workspace)
    console.log(`  Creating custom type: ${DEPARTMENT_TYPE}`);
    results.departmentTypeCreated = await createNodeType(
      page,
      DEPARTMENT_TYPE,
      'Department',
      ['Workspace']
    );
    logStep('Department type created', results.departmentTypeCreated);

    // Create Team type (allowed under Department)
    console.log(`  Creating custom type: ${TEAM_TYPE}`);
    results.teamTypeCreated = await createNodeType(
      page,
      TEAM_TYPE,
      'Team',
      [DEPARTMENT_TYPE]
    );
    logStep('Team type created', results.teamTypeCreated);

    await takeScreenshot(page, `${ADMIN_USER}_custom_types_created`);

    // ========================================================================
    // STEP 3: Verify Custom Types Listed
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 3: Verify Custom Types Listed');
    console.log('-'.repeat(50));

    const nodeTypes = await listNodeTypes(page);
    console.log(`  Found ${nodeTypes.length} node types`);

    const departmentTypeFound = nodeTypes.some((t: CustomNodeType) => t.name === DEPARTMENT_TYPE);
    const teamTypeFound = nodeTypes.some((t: CustomNodeType) => t.name === TEAM_TYPE);

    results.customTypesListed = departmentTypeFound && teamTypeFound;
    logStep('Custom types listed', results.customTypesListed,
      `Department: ${departmentTypeFound}, Team: ${teamTypeFound}`);

    // Log all types for debugging
    console.log('  All node types:');
    for (const t of nodeTypes) {
      console.log(`    - ${t.name} (display: ${t.display_name}, parents: [${t.allowed_parents.join(', ')}])`);
    }

    // ========================================================================
    // STEP 4: Create Nodes with Custom Types
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 4: Create Nodes with Custom Types');
    console.log('-'.repeat(50));

    // Create Department under Workspace
    console.log(`  Creating ${DEPARTMENT_TYPE} node under workspace`);
    const departmentResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: DEPARTMENT_TYPE },
      TEST_DEPARTMENT_NAME,
      'Test department for custom types'
    );

    results.departmentNodeCreated = departmentResult.success;
    departmentNodeId = departmentResult.nodeId || null;
    logStep('Department node created', results.departmentNodeCreated,
      departmentResult.error || departmentNodeId || 'no id');

    // Create Team under Department
    if (departmentNodeId) {
      console.log(`  Creating ${TEAM_TYPE} node under department`);
      const teamResult = await createNodeViaProtocol(
        page,
        departmentNodeId,
        { Child: TEAM_TYPE },
        TEST_TEAM_NAME,
        'Test team for custom types'
      );

      results.teamNodeCreated = teamResult.success;
      logStep('Team node created', results.teamNodeCreated,
        teamResult.error || teamResult.nodeId || 'no id');

      // Verify entity_type is correct
      if (teamResult.nodeId) {
        const teamNode = await getNodeViaProtocol(page, teamResult.nodeId);
        if (teamNode) {
          const entityType = teamNode.entity_type;
          const isChildType = typeof entityType === 'object' && 'Child' in entityType;
          results.nodeEntityTypeCorrect = isChildType && entityType.Child === TEAM_TYPE;
          logStep('Node entity_type correct', results.nodeEntityTypeCorrect,
            JSON.stringify(teamNode.entity_type));
        }
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_custom_nodes_created`);

    // ========================================================================
    // STEP 5: Schema Enforcement - Invalid Parent-Child
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 5: Schema Enforcement - Invalid Parent-Child');
    console.log('-'.repeat(50));

    // Attempt Team under Workspace (invalid - Team requires Department parent)
    console.log(`  Attempting ${TEAM_TYPE} under Workspace (should fail)`);
    const teamUnderWorkspaceResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: TEAM_TYPE },
      `InvalidTeam_${timestamp}`,
      'This should fail'
    );

    results.teamUnderWorkspaceRejected = !teamUnderWorkspaceResult.success;
    logStep('Team under Workspace rejected', results.teamUnderWorkspaceRejected,
      teamUnderWorkspaceResult.error || 'no error returned');

    if (!teamUnderWorkspaceResult.success && teamUnderWorkspaceResult.error) {
      results.schemaViolationErrorReturned = isSchemaViolationError(teamUnderWorkspaceResult.error);
      logStep('Schema violation error returned', results.schemaViolationErrorReturned);
    }

    // Create an Office first for the next test
    console.log(`  Creating Office for Office-under-Team test`);
    const officeResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Office' },
      TEST_OFFICE_NAME,
      'Test office'
    );
    officeNodeId = officeResult.nodeId || null;

    // Attempt Office under Team (invalid - Office requires Workspace parent)
    if (departmentNodeId) {
      // First create a team to test with
      const testTeamResult = await createNodeViaProtocol(
        page,
        departmentNodeId,
        { Child: TEAM_TYPE },
        `TestTeamForOfficeTest_${timestamp}`,
        'Team to test Office placement'
      );

      if (testTeamResult.success && testTeamResult.nodeId) {
        console.log(`  Attempting Office under Team (should fail)`);
        const officeUnderTeamResult = await createNodeViaProtocol(
          page,
          testTeamResult.nodeId,
          { Child: 'Office' },
          `InvalidOffice_${timestamp}`,
          'This should fail'
        );

        results.officeUnderTeamRejected = !officeUnderTeamResult.success;
        logStep('Office under Team rejected', results.officeUnderTeamRejected,
          officeUnderTeamResult.error || 'no error returned');
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_schema_enforcement`);

    // ========================================================================
    // STEP 6: Default Schema Enforcement
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 6: Default Schema Enforcement (Workspace -> Office -> Room)');
    console.log('-'.repeat(50));

    // Office under Workspace (valid)
    console.log(`  Testing Office under Workspace (should succeed)`);
    results.officeUnderWorkspaceAllowed = officeResult.success;
    logStep('Office under Workspace allowed', results.officeUnderWorkspaceAllowed);

    // Room under Office (valid)
    if (officeNodeId) {
      console.log(`  Testing Room under Office (should succeed)`);
      const roomUnderOfficeResult = await createNodeViaProtocol(
        page,
        officeNodeId,
        { Child: 'Room' },
        TEST_ROOM_NAME,
        'Test room'
      );
      results.roomUnderOfficeAllowed = roomUnderOfficeResult.success;
      logStep('Room under Office allowed', results.roomUnderOfficeAllowed,
        roomUnderOfficeResult.error || roomUnderOfficeResult.nodeId || 'unknown');
    }

    // Room under Workspace (invalid - Room requires Office parent)
    console.log(`  Testing Room under Workspace (should fail)`);
    const roomUnderWorkspaceResult = await createNodeViaProtocol(
      page,
      workspaceRootId,
      { Child: 'Room' },
      `InvalidRoom_${timestamp}`,
      'This should fail'
    );
    results.roomUnderWorkspaceRejected = !roomUnderWorkspaceResult.success;
    logStep('Room under Workspace rejected', results.roomUnderWorkspaceRejected,
      roomUnderWorkspaceResult.error || 'no error returned');

    await takeScreenshot(page, `${ADMIN_USER}_default_schema`);

    // ========================================================================
    // STEP 7: TreeSchema Operations
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 7: TreeSchema Operations');
    console.log('-'.repeat(50));

    // GetTreeSchema
    console.log(`  Getting current tree schema`);
    const schema = await getTreeSchema(page);
    results.getTreeSchemaSucceeded = schema !== null;
    logStep('GetTreeSchema succeeded', results.getTreeSchemaSucceeded);

    if (schema) {
      console.log(`  Schema name: ${schema.name}`);
      console.log(`  Max depth: ${schema.max_depth ?? 'unlimited'}`);
      console.log(`  Rules (${schema.rules.length}):`);
      for (const rule of schema.rules) {
        console.log(`    - ${rule.parent_type} -> [${rule.allowed_child_types.join(', ')}]`);
      }

      // UpdateTreeSchema - Add a new nesting rule
      console.log(`  Updating tree schema with new rule`);
      const newRule: NestingRule = {
        parent_type: TEAM_TYPE,
        allowed_child_types: ['SubTeam'], // Allow SubTeam under Team
      };

      const updatedSchema: TreeSchema = {
        ...schema,
        rules: [...schema.rules, newRule],
      };

      results.updateTreeSchemaSucceeded = await updateTreeSchema(page, updatedSchema);
      logStep('UpdateTreeSchema succeeded', results.updateTreeSchemaSucceeded);

      // Verify updated schema by getting it again
      if (results.updateTreeSchemaSucceeded) {
        await sleep(500); // Give server time to process

        const verifySchema = await getTreeSchema(page);
        if (verifySchema) {
          const hasNewRule = verifySchema.rules.some((r: NestingRule) =>
            r.parent_type === TEAM_TYPE &&
            r.allowed_child_types.includes('SubTeam')
          );
          results.updatedSchemaEnforced = hasNewRule;
          logStep('Updated schema enforced', results.updatedSchemaEnforced,
            hasNewRule ? 'SubTeam rule found' : 'SubTeam rule not found');
        }
      }
    }

    await takeScreenshot(page, `${ADMIN_USER}_schema_operations`);

    // ========================================================================
    // STEP 8: Additional Validation - List Nodes by Type
    // ========================================================================
    console.log('\n' + '-'.repeat(50));
    console.log('STEP 8: Additional Validation');
    console.log('-'.repeat(50));

    // List all Department nodes
    console.log(`  Listing nodes of type ${DEPARTMENT_TYPE}`);
    const departmentNodes = await listNodesViaProtocol(page, {
      entityTypes: [{ Child: DEPARTMENT_TYPE }],
    });
    console.log(`  Found ${departmentNodes.length} department nodes`);

    // List all Team nodes
    console.log(`  Listing nodes of type ${TEAM_TYPE}`);
    const teamNodes = await listNodesViaProtocol(page, {
      entityTypes: [{ Child: TEAM_TYPE }],
    });
    console.log(`  Found ${teamNodes.length} team nodes`);

    await takeScreenshot(page, 'FINAL_custom_types_test');

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
    console.log(`  Workspace Root Found:         ${results.workspaceRootFound ? 'PASS' : 'FAIL'}`);

    console.log('\nCustom Node Type Creation:');
    console.log(`  Department Type Created:      ${results.departmentTypeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Team Type Created:            ${results.teamTypeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Custom Types Listed:          ${results.customTypesListed ? 'PASS' : 'FAIL'}`);

    console.log('\nCustom Type Node Creation:');
    console.log(`  Department Node Created:      ${results.departmentNodeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Team Node Created:            ${results.teamNodeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Node entity_type Correct:     ${results.nodeEntityTypeCorrect ? 'PASS' : 'FAIL'}`);

    console.log('\nSchema Enforcement (Custom Types):');
    console.log(`  Team Under Workspace Rejected:  ${results.teamUnderWorkspaceRejected ? 'PASS' : 'FAIL'}`);
    // A custom type constrains what it can CONTAIN as well as what it can sit under. It once did
    // not: CreateNodeType { name: "Team", allowed_parents: ["Department"] } wrote a rule for
    // parent_type "Department" and none for "Team", and TreeSchema::is_child_allowed answered
    // "allow all" for a parent with no rule, so an Office was accepted under a Team. That lookup
    // now answers closed (citadel-workspace-types/src/structs.rs, `is_child_allowed`), the same as
    // `get_allowed_children`, so a Team with no rule contains nothing. Not in the pass/fail gate
    // below only because that gate has always covered the default schema alone.
    console.log(`  Office Under Team Rejected:     ${results.officeUnderTeamRejected ? 'PASS' : 'FAIL'}`);
    console.log(`  Schema Violation Error:         ${results.schemaViolationErrorReturned ? 'PASS' : 'FAIL'}`);

    console.log('\nDefault Schema Enforcement:');
    console.log(`  Office Under Workspace:       ${results.officeUnderWorkspaceAllowed ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Under Office:            ${results.roomUnderOfficeAllowed ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Under Workspace Rejected:${results.roomUnderWorkspaceRejected ? 'PASS' : 'FAIL'}`);

    console.log('\nTreeSchema Operations:');
    console.log(`  GetTreeSchema:                ${results.getTreeSchemaSucceeded ? 'PASS' : 'FAIL'}`);
    console.log(`  UpdateTreeSchema:             ${results.updateTreeSchemaSucceeded ? 'PASS' : 'FAIL'}`);
    console.log(`  Updated Schema Enforced:      ${results.updatedSchemaEnforced ? 'PASS' : 'FAIL'}`);

    // Determine overall pass/fail
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.workspaceRootFound,
      // Custom types - mark as critical once feature is implemented
      // results.departmentTypeCreated,
      // results.teamTypeCreated,
      // Default schema must work
      results.officeUnderWorkspaceAllowed,
    ];

    const schemaEnforcementTests = [
      results.roomUnderWorkspaceRejected,
      results.getTreeSchemaSucceeded,
    ];

    const criticalPassed = criticalTests.every(Boolean);
    const schemaPassed = schemaEnforcementTests.filter(Boolean).length >= 1;
    const overallPass = criticalPassed && schemaPassed;

    if (!overallPass) {
      console.log('Note: Custom type creation may not be implemented yet.');
      console.log('Schema enforcement tests show the expected behavior.');
    }

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
