/**
 * Office & Room CRUD Integration Test
 *
 * What this spec actually drives, in order:
 * 1. Admin (first user) creates an office
 * 2. Admin creates a room within that office
 * 3. Rename the office
 * 4. Delete the room
 * 5. Cascade delete: office with a child room is removed together with the room
 * 6. A non-admin cannot create an office
 * 7. Cleanup: delete the test office
 *
 * The header used to also claim description/MDX updates, room rename, non-admin
 * delete paths and member management. No step ever performed any of those; the
 * corresponding result fields were declared, never assigned and never printed.
 * They are now reported as explicit SKIPs at the end of the run so the coverage
 * gap is visible instead of implied.
 */

import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  navigateToOffice,
  waitForWorkspaceLoaded,
  startDiagnostics,
  assertNoToastConflict,
  dismissAllToasts,
  TestHarness,
  runTestMain,
  type DiagnosticsHandle,
} from '../lib/index.js';

import type { Page, Browser } from 'playwright';
import { waitForAdminRole } from '../lib/admin-role.js';
import {
  isVisibleWithin,
  pickChildTypeIfAsked,
  openNodeMenu,
  rootRow,
  selectRoot,
  deleteNodeViaUI,
  nodeExistsInUI,
  nodeGoneFromUI,
} from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

/**
 * Only fields this spec actually drives live here. The interface used to also
 * carry officeDescriptionUpdated, officeMdxUpdated, roomNameUpdated,
 * roomDescriptionUpdated, roomMdxUpdated, nonAdminCannotDeleteOffice,
 * nonAdminCannotCreateRoom, nonAdminCannotDeleteRoom, memberAddedToOffice,
 * memberRemovedFromOffice, memberAddedToRoom and memberRemovedFromRoom — none of
 * which any step ever assigned, and none of which were printed. They were
 * permanently false and read as "nothing tested" only if you went looking. The
 * gaps are now listed explicitly in the SKIP block at the end of the run.
 */
interface TestResults {
  accountCreation: boolean;
  workspaceLoaded: boolean;
  isAdmin: boolean;

  // Office CRUD
  officeCreated: boolean;
  officeNameUpdated: boolean;
  officeDeleted: boolean;

  // Room CRUD
  roomCreated: boolean;
  roomDeleted: boolean;

  // Cascade Delete
  cascadeDeleteWorks: boolean;

  // Authorization
  nonAdminAccountCreated: boolean;
  nonAdminCannotCreateOffice: boolean;

  // Toast Conflicts (should all be false)
  toastConflictDetected: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const ADMIN_USER = `crud_admin_${timestamp}`;
const NON_ADMIN_USER = `crud_user_${timestamp}`;
const TEST_OFFICE_NAME = `TestOffice_${timestamp}`;
const TEST_ROOM_NAME = `TestRoom_${timestamp}`;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Click the add node button (+) in the hierarchy sidebar
 */
async function clickAddOfficeButton(page: Page): Promise<boolean> {
  console.log('  Looking for Add Node button...');

  // "+" adds inside the selected node; with the root selected the new node is
  // top-level. An empty workspace has no root row, and add-root-node-button.
  if ((await rootRow(page).isVisible()) && (await selectRoot(page)) === null) {
    console.log('  WARNING: Could not select the workspace root');
    return false;
  }

  const selectors = [
    '[data-testid="add-node-button"]',
    '[data-testid="add-root-node-button"]',
  ];

  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await isVisibleWithin(btn, 1000)) {
      // TreeNodesSection renders this button for everyone and disables it while
      // the workspace schema is still loading. A plain .click() on a disabled
      // button blocks for the full 30s action timeout and then throws, which used
      // to abort the whole spec from inside a step that only wanted a yes/no.
      if (!(await btn.isEnabled())) {
        console.log(`  Add Node button present but disabled (${selector})`);
        return false;
      }
      // It can still turn disabled between the check and the click, when the permission answer
      // lands; that is the known "no", not a reason to wait out the 30s action timeout.
      if (!(await btn.click({ timeout: 5000 }).then(() => true).catch(() => false))) {
        console.log(`  Add Node button turned disabled before the click (${selector})`);
        return false;
      }
      await sleep(500);
      console.log(`  Clicked Add Node button (${selector})`);
      return true;
    }
  }

  console.log('  WARNING: Add Node button not found');
  return false;
}

/**
 * Fill the node create/edit dialog (EntityManagementModal) and submit it.
 *
 * Everything is scoped to `[role="dialog"]`. Unscoped, `input#name` and
 * `button:has-text("Create")` match page-wide, and because Radix portals the
 * dialog to the end of <body>, `.first()` prefers whatever is behind the overlay
 * — the office view's own header controls — over the dialog we just opened.
 *
 * `button[type="submit"]` rather than a text match: EntityManagementModal labels
 * the submit button from the entity type and mode ("Create Office", "Update
 * Room", "Creating..." while in flight), so any literal is wrong for some call.
 *
 * This replaces fillCreateOfficeModal/fillCreateRoomModal, which were the same
 * function twice — and would have needed the same fix twice.
 */
async function fillNodeModal(
  page: Page,
  name: string,
  description: string
): Promise<boolean> {
  console.log(`  Filling node modal: ${name}`);

  const dialog = page.locator('[role="dialog"]');
  if (!(await isVisibleWithin(dialog.first(), 5000))) {
    console.log('  WARNING: Node modal did not open');
    return false;
  }

  const nameInput = dialog.locator('input#name').first();
  if (!(await isVisibleWithin(nameInput, 2000))) {
    console.log('  WARNING: Name input not found');
    return false;
  }
  await nameInput.fill(name);

  const descInput = dialog.locator('textarea#description').first();
  if (await isVisibleWithin(descInput, 1000)) {
    await descInput.fill(description);
  }

  await sleep(300);

  const submitBtn = dialog.locator('button[type="submit"]').first();
  if (!(await isVisibleWithin(submitBtn, 2000))) {
    console.log('  WARNING: Submit button not found');
    return false;
  }

  await submitBtn.click();
  await sleep(2000);
  return true;
}

/**
 * Click the create-child button for a parent node in the hierarchy sidebar.
 * Opens the parent's context menu and clicks the create-child menu item.
 * @param parentName - Name of the parent node to find in the sidebar
 */
async function clickAddRoomButton(page: Page, parentName: string): Promise<boolean> {
  console.log(`  Looking for Create Child button in tree (parent: ${parentName})...`);

  // Close any stale menus/modals first
  await page.keyboard.press('Escape');
  await sleep(300);

  // Reveal the parent -- which selects it -- and open its ⋯ menu.
  const nodeId: string | null = await openNodeMenu(page, parentName);
  if (!nodeId) {
    console.log('  WARNING: Parent node menu button not found');
    return false;
  }
  console.log(`  Opened the menu of parent node ${nodeId}`);

  // Now look for the create-child item in the open dropdown
  const createChildTestId = `create-child-${nodeId}`;
  const createItem = page.locator(`[data-testid="${createChildTestId}"]`);
  if (await isVisibleWithin(createItem, 2000)) {
    await createItem.click();
    await pickChildTypeIfAsked(page, 'Room');
    await sleep(500);
    console.log(`  Clicked Create Child button (${createChildTestId})`);
    return true;
  }

  // Close menu if create-child not found
  await page.keyboard.press('Escape');
  await sleep(200);

  // Debug: log what menu items ARE visible
  const menuItems = await page.locator('[role="menuitem"]').allTextContents();
  console.log(`  WARNING: Create Child option not found. Visible menu items: ${JSON.stringify(menuItems)}`);
  return false;
}

/**
 * Open the node edit modal via the hierarchy sidebar's tree-node-menu.
 */
async function openEditModal(page: Page, itemName: string, _type: 'office' | 'room' = 'office'): Promise<boolean> {
  console.log(`  Opening edit modal for node: ${itemName}`);

  const nodeId: string | null = await openNodeMenu(page, itemName);
  if (nodeId) {
    const editOption = page.locator(`[data-testid="edit-node-${nodeId}"]`).first();
    if (await isVisibleWithin(editOption, 1000)) {
      await editOption.click();
      await sleep(500);
      return true;
    }
  }

  console.log('  WARNING: Could not open edit modal');
  return false;
}

/**
 * Delete a node via the UI: reveal it, open its ⋯ menu, confirm.
 */
async function deleteNode(page: Page, nodeName: string): Promise<boolean> {
  console.log(`\n=== Deleting node: ${nodeName} ===`);
  const { success } = await deleteNodeViaUI(page, nodeName);
  if (!success) {
    await page.keyboard.press('Escape');
    await sleep(300);
    console.log('  WARNING: Could not delete node');
  }
  return success;
}

/** @deprecated Use deleteNode instead */
const deleteOffice = deleteNode;
/** @deprecated Use deleteNode instead */
const deleteRoom = deleteNode;

/**
 * Whether `itemName` is in the workspace, waiting for it to appear. The sidebar
 * is a focused tree, so this reveals the node (selecting it) rather than looking
 * for a row that may simply be off screen.
 */
async function itemExistsInSidebar(page: Page, itemName: string): Promise<boolean> {
  return nodeExistsInUI(page, itemName, 5000);
}

/**
 * Whether `itemName` is gone from the workspace.
 *
 * Asked of the sidebar's filter, which searches every node: in a focused tree
 * "no row on screen" holds for most nodes that exist -- a cascaded room is off
 * screen the moment its office is -- so it would pass whether or not the room
 * was deleted. Deliberately not `!(await itemExistsInSidebar(...))`, which
 * spends the whole timeout waiting for something that is supposed to be absent.
 */
async function itemGoneFromSidebar(page: Page, itemName: string): Promise<boolean> {
  return nodeGoneFromUI(page, itemName, 5000);
}

/**
 * Ensure all modals and menus are closed by pressing Escape and dismissing toasts.
 */
async function closeAllOverlays(page: Page): Promise<void> {
  await dismissAllToasts(page);
  await page.keyboard.press('Escape');
  await sleep(300);
  // Press again in case there's a nested dialog
  await page.keyboard.press('Escape');
  await sleep(200);
}

/**
 * Whether the app told the user the operation was refused.
 *
 * When WorkspaceService.createNode rejects, EntityManagementModal keeps the
 * dialog open and raises a destructive toast titled "Error" whose body is
 * "Failed to create office. Please try again." — that string, plus the two
 * explicit denial wordings, is what we look for.
 *
 * The bare `Admin` alternative that used to be in this pattern matched the
 * "ADMIN SETTINGS" sidebar label, the "Admin" role badge and any tooltip
 * mentioning admins, so it could report "permission denied" on a screen that had
 * denied nothing.
 */
async function hasPermissionDenied(page: Page): Promise<boolean> {
  const denied = page
    .getByText(/Permission denied|Unauthorized|Failed to (create|update|delete)/i)
    .first();
  return isVisibleWithin(denied, 5000);
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Office & Room CRUD Integration Test',
    reportFileName: 'OFFICE_ROOM_CRUD_TEST_REPORT.json',
    metadata: { adminUser: ADMIN_USER, nonAdminUser: NON_ADMIN_USER },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`Admin User: ${ADMIN_USER}`);
  console.log(`Non-Admin User: ${NON_ADMIN_USER}`);
  console.log(`Test Office: ${TEST_OFFICE_NAME}`);
  console.log(`Test Room: ${TEST_ROOM_NAME}`);
  console.log('');

  const results: TestResults = {
    accountCreation: false,
    workspaceLoaded: false,
    isAdmin: false,
    officeCreated: false,
    officeNameUpdated: false,
    officeDeleted: false,
    roomCreated: false,
    roomDeleted: false,
    cascadeDeleteWorks: false,
    nonAdminAccountCreated: false,
    nonAdminCannotCreateOffice: false,
    toastConflictDetected: false,
  };

  let browser: Browser | null = null;
  let adminPage: Page | null = null;
  let nonAdminPage: Page | null = null;
  let diagnostics: DiagnosticsHandle | null = null;
  let overallPass = false;

  try {
    // Create browser with BOTH contexts upfront to avoid browser state issues
    // Creating contexts late (after many operations) can fail with "browser has been closed"
    const setup = await createBrowser();
    browser = setup.browser;
    const adminContext = setup.context;
    const nonAdminContext = await browser.newContext();
    adminPage = await adminContext.newPage();
    nonAdminPage = await nonAdminContext.newPage();

    // Start diagnostics
    diagnostics = await startDiagnostics(adminPage);

    // ========================================================================
    // STEP 1: Create Admin Account (First User = Admin)
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Admin Account');
    console.log('─'.repeat(50));

    // createAccount handles navigation and storage clearing internally
    results.accountCreation = await createAccount(adminPage, ADMIN_USER, {
      isFirstUser: true,
    });

    if (!results.accountCreation) {
      throw new Error('Failed to create admin account');
    }

    // The return value used to be thrown away and `workspaceLoaded` hard-coded to
    // true, which made it one of the four "critical" gate inputs while being
    // incapable of ever reporting a failure.
    results.workspaceLoaded = await waitForWorkspaceLoaded(adminPage);
    await takeScreenshot(adminPage, `${ADMIN_USER}_admin_ready`);

    // See waitForAdminRole for why this is not a 10s wall: the role trails the
    // workspace load, and two different failures used to share one FAIL.
    results.isAdmin = await waitForAdminRole(adminPage);

    // ========================================================================
    // STEP 2: Create Office (Admin Only)
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Create Office');
    console.log('─'.repeat(50));

    if (await clickAddOfficeButton(adminPage)) {
      await takeScreenshot(adminPage, `${ADMIN_USER}_create_office_modal`);

      if (await fillNodeModal(adminPage, TEST_OFFICE_NAME, 'Test office description')) {
        // Assert no toast conflict (both success AND error visible = bug)
        const toastOk = await assertNoToastConflict(adminPage, 'Create Office', uxTracker);
        if (!toastOk) {
          results.toastConflictDetected = true;
          await takeScreenshot(adminPage, `${ADMIN_USER}_office_create_TOAST_CONFLICT`);
          throw new Error('Toast conflict detected after Create Office - both success and error toasts visible');
        }

        // Verify office was created
        results.officeCreated = await itemExistsInSidebar(adminPage, TEST_OFFICE_NAME);
        console.log(`  Office created: ${results.officeCreated}`);
        await takeScreenshot(adminPage, `${ADMIN_USER}_office_created`);
        await closeAllOverlays(adminPage);
      }
    }

    if (!results.officeCreated) {
      uxTracker.log('major', 'functional', 'Could not create office');
    }

    // ========================================================================
    // STEP 3: Create Room Within Office
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Create Room');
    console.log('─'.repeat(50));

    if (results.officeCreated) {
      // First navigate to the office
      await navigateToOffice(adminPage, ADMIN_USER, TEST_OFFICE_NAME);
      await sleep(1000);

      if (await clickAddRoomButton(adminPage, TEST_OFFICE_NAME)) {
        await takeScreenshot(adminPage, `${ADMIN_USER}_create_room_modal`);

        if (await fillNodeModal(adminPage, TEST_ROOM_NAME, 'Test room description')) {
          // Assert no toast conflict
          const toastOk = await assertNoToastConflict(adminPage, 'Create Room', uxTracker);
          if (!toastOk) {
            results.toastConflictDetected = true;
            await takeScreenshot(adminPage, `${ADMIN_USER}_room_create_TOAST_CONFLICT`);
            throw new Error('Toast conflict detected after Create Room - both success and error toasts visible');
          }

          results.roomCreated = await itemExistsInSidebar(adminPage, TEST_ROOM_NAME);
          console.log(`  Room created: ${results.roomCreated}`);
          await takeScreenshot(adminPage, `${ADMIN_USER}_room_created`);
          await closeAllOverlays(adminPage);
        }
      }
    }

    // ========================================================================
    // STEP 4: Update Office
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Update Office');
    console.log('─'.repeat(50));

    if (results.officeCreated) {
      const updatedOfficeName = `${TEST_OFFICE_NAME}_Updated`;

      if (await openEditModal(adminPage, TEST_OFFICE_NAME)) {
        // Same dialog component as create, so the same dialog-scoped helper
        // applies. The hand-rolled version here reached for
        // `button:has-text("Save"), button:has-text("Update")` unscoped — and the
        // office view behind the overlay has its own "Save Changes" button, which
        // `.first()` would have picked in DOM order.
        if (await fillNodeModal(adminPage, updatedOfficeName, 'Test office description')) {
          // Assert no toast conflict
          const toastOk = await assertNoToastConflict(adminPage, 'Update Office', uxTracker);
          if (!toastOk) {
            results.toastConflictDetected = true;
            await takeScreenshot(adminPage, `${ADMIN_USER}_office_update_TOAST_CONFLICT`);
            throw new Error('Toast conflict detected after Update Office - both success and error toasts visible');
          }

          results.officeNameUpdated = await itemExistsInSidebar(adminPage, updatedOfficeName);
          await dismissAllToasts(adminPage);
        } else {
          console.log('  WARNING: Could not fill the edit modal, closing it');
        }
        // Ensure edit modal is closed before continuing
        await adminPage.keyboard.press('Escape');
        await sleep(300);
        await takeScreenshot(adminPage, `${ADMIN_USER}_office_updated`);
      }
      console.log(`  Office name updated: ${results.officeNameUpdated}`);
    }

    // ========================================================================
    // STEP 5: Delete Room
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Delete Room');
    console.log('─'.repeat(50));

    if (results.roomCreated) {
      results.roomDeleted = await deleteRoom(adminPage, TEST_ROOM_NAME);

      if (results.roomDeleted) {
        // Assert no toast conflict
        const toastOk = await assertNoToastConflict(adminPage, 'Delete Room', uxTracker);
        if (!toastOk) {
          results.toastConflictDetected = true;
          await takeScreenshot(adminPage, `${ADMIN_USER}_room_delete_TOAST_CONFLICT`);
          throw new Error('Toast conflict detected after Delete Room - both success and error toasts visible');
        }

        // Verify room no longer exists
        results.roomDeleted = await itemGoneFromSidebar(adminPage, TEST_ROOM_NAME);
        await closeAllOverlays(adminPage);
      }
      console.log(`  Room deleted: ${results.roomDeleted}`);
      await takeScreenshot(adminPage, `${ADMIN_USER}_room_deleted`);
    }

    // ========================================================================
    // STEP 6: Test Cascade Delete (Create room, delete office)
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Test Cascade Delete');
    console.log('─'.repeat(50));

    const cascadeOfficeName = `CascadeOffice_${timestamp}`;
    const cascadeRoomName = `CascadeRoom_${timestamp}`;

    // Create office for cascade test
    if (await clickAddOfficeButton(adminPage)) {
      if (await fillNodeModal(adminPage, cascadeOfficeName, 'Cascade test')) {
        // Assert no toast conflict after cascade office creation
        const toastOk1 = await assertNoToastConflict(adminPage, 'Create Cascade Office', uxTracker);
        if (!toastOk1) {
          results.toastConflictDetected = true;
          await takeScreenshot(adminPage, `${ADMIN_USER}_cascade_office_TOAST_CONFLICT`);
          throw new Error('Toast conflict detected after Create Cascade Office');
        }
        await closeAllOverlays(adminPage);

        await navigateToOffice(adminPage, ADMIN_USER, cascadeOfficeName);
        await sleep(1000);

        // Create room inside
        if (await clickAddRoomButton(adminPage, cascadeOfficeName)) {
          await fillNodeModal(adminPage, cascadeRoomName, 'Will be cascade deleted');

          // Assert no toast conflict after cascade room creation
          const toastOk2 = await assertNoToastConflict(adminPage, 'Create Cascade Room', uxTracker);
          if (!toastOk2) {
            results.toastConflictDetected = true;
            await takeScreenshot(adminPage, `${ADMIN_USER}_cascade_room_TOAST_CONFLICT`);
            throw new Error('Toast conflict detected after Create Cascade Room');
          }
          await closeAllOverlays(adminPage);
          await sleep(1000);
        }

        // Delete the office
        if (await deleteOffice(adminPage, cascadeOfficeName)) {
          // Assert no toast conflict after cascade delete
          const toastOk3 = await assertNoToastConflict(adminPage, 'Cascade Delete Office', uxTracker);
          if (!toastOk3) {
            results.toastConflictDetected = true;
            await takeScreenshot(adminPage, `${ADMIN_USER}_cascade_delete_TOAST_CONFLICT`);
            throw new Error('Toast conflict detected after Cascade Delete Office');
          }
          await closeAllOverlays(adminPage);

          // Verify both office and room are gone
          const officeGone = await itemGoneFromSidebar(adminPage, cascadeOfficeName);
          const roomGone = await itemGoneFromSidebar(adminPage, cascadeRoomName);
          results.cascadeDeleteWorks = officeGone && roomGone;
          console.log(`  Cascade delete works: ${results.cascadeDeleteWorks}`);
        }
      }
    }
    await takeScreenshot(adminPage, `${ADMIN_USER}_cascade_test`);

    // ========================================================================
    // STEP 7: Non-Admin Authorization Test
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 7: Non-Admin Authorization Test');
    console.log('─'.repeat(50));

    // Use the pre-created nonAdminPage (context created at start to avoid browser state issues)
    // createAccount handles navigation and storage clearing internally
    // Tracked as a result: if the second account never got created, the
    // authorization check below silently stayed false, and a false there is
    // indistinguishable from "the server let a non-admin create an office".
    results.nonAdminAccountCreated = await createAccount(nonAdminPage!, NON_ADMIN_USER, {
      isFirstUser: false,
    });

    if (results.nonAdminAccountCreated) {
      await waitForWorkspaceLoaded(nonAdminPage);
      await takeScreenshot(nonAdminPage, `${NON_ADMIN_USER}_logged_in`);

      // Try to create an office as non-admin
      console.log('  Testing non-admin office creation...');
      // "+" is offered until the permission answer arrives and disabled once it is a known "no"
      // (AddNodeButton). Reading it once raced that answer: the button was enabled at the check,
      // disabled by the click, and the click waited out its 30s timeout. Wait for the answer.
      await nonAdminPage
        .waitForSelector('[data-testid="add-node-button"][disabled], [data-testid="add-root-node-button"][disabled]', { timeout: 15_000 })
        .catch(() => console.log('  Add Node button still enabled after 15s; trying it'));
      if (await clickAddOfficeButton(nonAdminPage)) {
        await fillNodeModal(nonAdminPage, 'UnauthorizedOffice', 'Should fail');

        // Either outcome is an acceptable refusal: an explicit error toast, or
        // the node simply never appearing in the tree.
        results.nonAdminCannotCreateOffice = await hasPermissionDenied(nonAdminPage);
        if (!results.nonAdminCannotCreateOffice) {
          results.nonAdminCannotCreateOffice = await itemGoneFromSidebar(nonAdminPage, 'UnauthorizedOffice');
        }
      } else {
        // An absent button is only evidence if the page actually LOADED.
        //
        // TreeNodesSection renders the add button for everyone, so this branch
        // fires exactly when the non-admin's workspace failed to render — and
        // it used to record that as a pass. Deleting the server-side
        // EditTreeStructure check would have gone unnoticed, because the thing
        // this spec measures was "the page is broken".
        const loaded = await nonAdminPage
          .locator('#main-content')
          .isVisible()
          .catch(() => false);

        results.nonAdminCannotCreateOffice = loaded;
        if (!loaded) {
          console.error(
            '  FAIL: the non-admin workspace never rendered, so the absence of an add ' +
              'button proves nothing about authorization.',
          );
        }
      }
      console.log(`  Non-admin cannot create office: ${results.nonAdminCannotCreateOffice}`);
      await takeScreenshot(nonAdminPage, `${NON_ADMIN_USER}_auth_test`);
    }

    // Note: Don't close nonAdminContext here - browser.close() in finally handles it

    // ========================================================================
    // Cleanup: Delete test office
    // ========================================================================
    console.log('\n' + '─'.repeat(50));
    console.log('CLEANUP: Delete Test Office');
    console.log('─'.repeat(50));

    const updatedOfficeName = `${TEST_OFFICE_NAME}_Updated`;
    if (await itemExistsInSidebar(adminPage, updatedOfficeName)) {
      results.officeDeleted = await deleteOffice(adminPage, updatedOfficeName);
      if (results.officeDeleted) {
        const toastOk = await assertNoToastConflict(adminPage, 'Cleanup Delete Office', uxTracker);
        if (!toastOk) {
          results.toastConflictDetected = true;
          await takeScreenshot(adminPage, `${ADMIN_USER}_cleanup_delete_TOAST_CONFLICT`);
        }
        await dismissAllToasts(adminPage);
      }
    } else if (await itemExistsInSidebar(adminPage, TEST_OFFICE_NAME)) {
      results.officeDeleted = await deleteOffice(adminPage, TEST_OFFICE_NAME);
      if (results.officeDeleted) {
        const toastOk = await assertNoToastConflict(adminPage, 'Cleanup Delete Office', uxTracker);
        if (!toastOk) {
          results.toastConflictDetected = true;
          await takeScreenshot(adminPage, `${ADMIN_USER}_cleanup_delete_TOAST_CONFLICT`);
        }
        await dismissAllToasts(adminPage);
      }
    }
    console.log(`  Cleanup - office deleted: ${results.officeDeleted}`);

    await takeScreenshot(adminPage, 'FINAL_cleanup');

  } catch (error) {
    console.error('\n[TEST ERROR]', error);
    uxTracker.log('critical', 'functional', `Test crashed: ${error}`);

    if (adminPage) {
      await takeScreenshot(adminPage, 'ERROR_state');
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

    console.log('\nOffice CRUD:');
    console.log(`  Office Created:             ${results.officeCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Office Name Updated:        ${results.officeNameUpdated ? 'PASS' : 'FAIL'}`);
    console.log(`  Office Deleted:             ${results.officeDeleted ? 'PASS' : 'FAIL'}`);

    console.log('\nRoom CRUD:');
    console.log(`  Room Created:               ${results.roomCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Room Deleted:               ${results.roomDeleted ? 'PASS' : 'FAIL'}`);

    console.log('\nCascade Delete:');
    console.log(`  Cascade Delete Works:       ${results.cascadeDeleteWorks ? 'PASS' : 'FAIL'}`);

    console.log('\nAuthorization:');
    console.log(`  Non-Admin Account Created:  ${results.nonAdminAccountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Non-Admin Cannot Create:    ${results.nonAdminCannotCreateOffice ? 'PASS' : 'FAIL'}`);

    console.log('\nToast Validation:');
    console.log(`  No Toast Conflicts:         ${!results.toastConflictDetected ? 'PASS' : 'FAIL'}`);

    // Gaps this spec's header promises but its steps never perform. Listed rather
    // than left as permanently-false result fields, which is what they used to be:
    // an unset boolean printed as FAIL is a bug report nobody can act on, and one
    // that is never printed at all is worse.
    console.log('\nNot exercised by this spec:');
    console.log('  Office/Room description + MDX update: SKIP (no step opens the MDX editor here — covered by office-mdx-content)');
    console.log('  Room rename:                          SKIP (no step opens the room edit modal)');
    console.log('  Non-admin delete office/room:         SKIP (needs an office the non-admin can see AND a delete affordance; no step sets that up)');
    console.log('  Non-admin create room:                SKIP (needs a parent office visible to the non-admin; no step sets that up)');
    console.log('  Member add/remove on office + room:   SKIP (needs a second user added to a domain; no step performs the invite)');

    // Every line printed above with a PASS/FAIL verdict is now part of the gate.
    // It used to be four entries — accountCreation, workspaceLoaded (hard-coded
    // true), officeCreated and the toast check — so a run where the rename, both
    // deletes, the cascade and the authorization check all failed still reported
    // PASS overall.
    const criticalTests = [
      results.accountCreation,
      results.workspaceLoaded,
      results.isAdmin,
      results.officeCreated,
      results.officeNameUpdated,
      results.officeDeleted,
      results.roomCreated,
      results.roomDeleted,
      results.cascadeDeleteWorks,
      results.nonAdminAccountCreated,
      results.nonAdminCannotCreateOffice,
      !results.toastConflictDetected, // No toast conflicts is critical
    ];

    overallPass = criticalTests.every(Boolean);

    harness.finalize(overallPass, results);

    if (browser) {
      await browser.close();
    }
  }

  return overallPass;
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
