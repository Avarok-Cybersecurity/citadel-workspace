/**
 * Office/Room MDX Content Integration Test (P9)
 *
 * Tests MDX content editing in offices:
 * 1. Rendered MDX content area (view mode)
 * 2. Edit button to enter editing mode
 * 3. MDXEditor with toolbar (Bold/Italic/etc.)
 * 4. Save button and content persistence
 *
 * Everything this spec exercises lives in src/components/office/BaseOffice.tsx
 * (content pane, save handler, template gate), src/components/office/OfficeLayout.tsx
 * (Edit / Save Changes header buttons) and src/components/mdx/ (editor + toolbar).
 */

import { Page } from 'playwright';
import {
  sleep,
  createBrowser,
  createAccount,
  takeScreenshot,
  setupConsoleCapture,
  waitForWorkspaceLoaded,
  closeAnyModals,
  waitForAppReady,
  isVisibleWithin,
  TestHarness,
  runTestMain,
  restartBackendServices,
  treeRow,
} from '../lib/index.js';
import { config } from '../lib/config.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreated: boolean;
  /** The Edit control became usable, i.e. EditMdx permission arrived for the office. */
  editControlReady: boolean;

  // MDX content area
  contentAreaVisible: boolean;
  editButtonVisible: boolean;

  // MDX Editor
  editorLoads: boolean;
  toolbarVisible: boolean;

  // Save
  saveButtonVisible: boolean;
  navigatedAwayAndBack: boolean;
  contentPersists: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `mdx_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// Offices that docker/workspace-server/workspaces.json seeds into every fresh
// workspace. The spec navigates between two of them to force a remount of the
// office view, which is what makes the persistence check meaningful.
const HOME_OFFICE = 'General';

// ============================================================================
// Locators
// ============================================================================

/**
 * OfficeLayout renders exactly one button whose accessible name is "Edit".
 * `exact: true` keeps it off "Edit Content" (the edit-mode heading) and off the
 * sidebar's "Edit"/"Edit Node" menu items, which are role=menuitem anyway.
 */
const editButton = (page: Page) =>
  page.getByTestId('office-edit-content').first();

/**
 * The Edit button while it is still permission-gated. DisabledWithTooltip does
 * NOT set `disabled` on the button — it drops the onClick handler and wraps the
 * button in a `div[aria-disabled="true"]` with `pointer-events: none`. So the
 * button reports itself enabled and clickable in both states; the wrapper is the
 * only thing that tells them apart.
 */
const editButtonGate = (page: Page) =>
  page.locator('[aria-disabled="true"] button:has-text("Edit")').first();

/** MDXEditor's textarea, identified by the placeholder BaseOffice passes it. */
const mdxTextarea = (page: Page) =>
  page.getByPlaceholder(/Write your office content/i).first();

/** BaseOffice's view-mode wrapper — present only once MDX has compiled. */
const renderedContent = (page: Page) => page.locator('div.prose').first();

/**
 * A top-level node's sidebar row. The focused tree always shows the top level:
 * as the root's children, as the selection's peers, or as an ancestor.
 */
const sidebarNode = (page: Page, name: string) => treeRow(page, name).first();

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * The old version of this matched `[class*="prose"], [class*="content"],
 * [class*="mdx"], [class*="editor"]` and fell back to `main, [role="main"]`.
 * Between them those match something on virtually any page in the app, so the
 * assertion could not fail and carried no information. BaseOffice renders the
 * view-mode pane as a single `div` carrying `prose`, so that is what we wait for.
 */
async function verifyContentArea(page: Page): Promise<boolean> {
  console.log('\n=== Verifying Content Area ===');

  const visible = await isVisibleWithin(renderedContent(page), 10000);
  console.log(`  Rendered MDX content area (div.prose) visible: ${visible}`);
  return visible;
}

async function findEditButton(page: Page): Promise<boolean> {
  console.log('\n=== Finding Edit Button ===');

  const btn = editButton(page);
  const visible = await isVisibleWithin(btn, 10000);
  console.log(`  Edit button visible: ${visible}`);

  if (!visible) return false;

  // A JS `el.click()` on a gated Edit button dispatches an event that nothing is
  // listening for (OfficeLayout passes `onClick={canEdit ? onEditToggle : undefined}`),
  // so the old "click through the disabled wrapper" path silently did nothing and
  // the spec then blamed the editor for not loading. Report the gate instead.
  // Was a tolerated condition: it logged the gate and returned "found", so a
  // permanently ungrantable Edit button read as a pass. This spec now recreates
  // the backend before registering, so its account is the workspace's first
  // member and therefore its administrator — a closed gate here is a real
  // failure, not an environment it has to put up with.
  if (await editButtonGate(page).isVisible()) {
    throw new Error(
      'Edit is permission-gated for the account that created the workspace. ' +
      'The first member should be promoted to Admin, and EditMdx belongs to Admin.'
    );
  }

  await btn.click();
  await sleep(1000);
  return visible;
}

async function verifyMDXEditor(page: Page): Promise<{
  loads: boolean;
  toolbar: boolean;
}> {
  console.log('\n=== Verifying MDX Editor ===');

  const results = { loads: false, toolbar: false };

  results.loads = await isVisibleWithin(mdxTextarea(page), 10000);
  console.log(`  Editor loads: ${results.loads}`);

  // MDXToolbar renders icon-only buttons with no `title` and no `aria-label` —
  // the label lives in a Radix TooltipContent that is not rendered until hover.
  // `button[title*="Bold"]` and `[aria-label="Bold"]` therefore never match; the
  // lucide class on the svg is the only stable hook. Both buttons are asserted
  // rather than OR'd, since half a toolbar is a failure, not a pass.
  const hasBold = await isVisibleWithin(page.locator('button:has(svg.lucide-bold)').first(), 5000);
  const hasItalic = await isVisibleWithin(page.locator('button:has(svg.lucide-italic)').first(), 3000);
  results.toolbar = hasBold && hasItalic;
  console.log(`  Toolbar visible: ${results.toolbar} (Bold: ${hasBold}, Italic: ${hasItalic})`);

  return results;
}

async function testSaveAndPersist(page: Page): Promise<{
  saveVisible: boolean;
  navigated: boolean;
  persists: boolean;
}> {
  console.log('\n=== Testing Save and Persistence ===');

  const results = { saveVisible: false, navigated: false, persists: false };

  const saveBtn = page.getByTestId('office-save-content').first();
  results.saveVisible = await isVisibleWithin(saveBtn, 5000);
  console.log(`  Save button visible: ${results.saveVisible}`);

  if (!results.saveVisible) return results;

  // Type unique content into the editor
  const UNIQUE_CONTENT = `TestMDX_${Date.now()}`;
  const editor = mdxTextarea(page);
  if (await isVisibleWithin(editor, 2000)) {
    await editor.click();
    // ControlOrMeta, not Meta: the suite runs on Linux CI as well as macOS, and
    // `Meta+a` selects nothing on Linux, so the typed text used to be appended to
    // the seeded office markdown instead of replacing it.
    await page.keyboard.press('ControlOrMeta+a');
    await sleep(100);
    await page.keyboard.type(UNIQUE_CONTENT);
    await sleep(500);
    console.log(`  Typed unique content: "${UNIQUE_CONTENT}"`);
  }

  // `textContent()` on a React-controlled <textarea> returns the text node React
  // wrote at mount, not what the user typed — the live value is only on the
  // `value` property. Reading it the old way made every content comparison here
  // compare against the seeded markdown. `inputValue()` reads the property.
  const beforeSave = await editor.inputValue().catch(() => '');
  console.log(`  Editor value before save: "${beforeSave.slice(0, 80)}"`);

  await saveBtn.click();

  const toastVisible = await isVisibleWithin(page.getByText('Changes saved').first(), 5000);
  console.log(`  Save success toast: ${toastVisible}`);

  // After save, BaseOffice leaves edit mode and re-renders the compiled view.
  const immediateView = (await renderedContent(page).textContent().catch(() => '')) ?? '';
  console.log(`  Immediate view content: "${immediateView.slice(0, 80)}"`);
  console.log(`  Immediate view has our content: ${immediateView.includes(UNIQUE_CONTENT)}`);

  // Persistence check: leave the office entirely and come back, so the office
  // view unmounts and has to re-read mdx_content from workspace state.
  // The office navigated to used to be "Tutorials", which exists nowhere in this
  // product — not in workspaces.json, not in the UI. The lookup always missed, the
  // spec logged a warning and skipped the navigation, and then "content persists"
  // was decided by reading the page it had never left. "Engineering" is a real
  // seeded office (docker/workspace-server/workspaces.json).
  // Persistence is checked by reloading the page, not by clicking to a sibling
  // office and back.
  //
  // A reload is the stronger test: it tears down the whole app — React tree, WASM
  // client, workspace state — so the content can only reappear if the server
  // actually stored it. Sibling navigation only unmounts the office view, and it
  // made this assertion depend on a second seeded office being present and
  // clickable in the sidebar, which is a fact about the fixture rather than about
  // whether saving works. That dependency is what failed here: the save itself
  // succeeded (toast shown, compiled view showing the new text) while the spec
  // reported a persistence failure because "Engineering" was not found in the
  // sidebar.
  console.log('  Reloading the page to force a re-read from the server...');
  await page.reload({ waitUntil: 'commit', timeout: 60_000 });
  await waitForAppReady(page, 60_000);
  await closeAnyModals(page);

  const home = sidebarNode(page, HOME_OFFICE);
  if (!(await isVisibleWithin(home, 30_000))) {
    console.log(`  FAIL: "${HOME_OFFICE}" not in the sidebar after reload`);
    return results;
  }
  await home.evaluate((el: HTMLElement) => el.click());

  results.navigated = await isVisibleWithin(renderedContent(page), 30_000);
  console.log(`  Back on ${HOME_OFFICE} after reload: ${results.navigated}`);

  if (!results.navigated) return results;

  const viewContent = (await renderedContent(page).textContent().catch(() => '')) ?? '';
  console.log(`  View content after nav: "${viewContent.slice(0, 80)}"`);

  // Also re-enter the editor and read the raw source, since the rendered view
  // strips markdown syntax and could hide a partial save.
  let editorContent = '';
  const btn = editButton(page);
  if (await isVisibleWithin(btn, 10000)) {
    if (await editButtonGate(page).isVisible()) {
      // Skipping the read-back is skipping the subject. The account that created
      // this workspace is its administrator, so the gate being closed here is
      // the defect, not a condition to work around.
      throw new Error('Edit is still permission-gated after navigation, for the workspace administrator');
    } else {
      await btn.click();
      await sleep(1000);
      editorContent = await mdxTextarea(page).inputValue().catch(() => '');
      console.log(`  Editor value after nav: "${editorContent.slice(0, 80)}"`);
    }
  }

  results.persists = `${viewContent}${editorContent}`.includes(UNIQUE_CONTENT);
  console.log(`  Content persists: ${results.persists} (looking for "${UNIQUE_CONTENT}")`);

  return results;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Office MDX Content Test',
    reportFileName: 'OFFICE_MDX_CONTENT_TEST_REPORT.json',
    metadata: { username: USERNAME },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    editControlReady: false,
    contentAreaVisible: false,
    editButtonVisible: false,
    editorLoads: false,
    toolbarVisible: false,
    saveButtonVisible: false,
    navigatedAwayAndBack: false,
    contentPersists: false,
  };

  try {
    const page = await context.newPage();
    setupConsoleCapture(page, 'MDX', ['error', 'Error', 'mdx', 'MDX', 'ILM']);

    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('─'.repeat(50));

    // Recreate the backend first. Only the workspace's FIRST member is promoted
    // to Admin, and EditMdx belongs to Admin and Owner by design — so whether
    // this spec can reach the editor at all depended on whether anything had
    // registered before it. That is why the editor checks below used to be
    // written as tolerated conditions. Starting from an empty workspace makes
    // this account the administrator every time, in CI and locally alike, which
    // is what lets those checks be assertions.
    await restartBackendServices();

    results.accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    if (!results.accountCreated) throw new Error('Account creation failed');

    await sleep(3000);
    await closeAnyModals(page);
    await waitForWorkspaceLoaded(page, 30000);

    // ========== STEP 2: Navigate to General Office ==========
    // MUST click General in sidebar to set nodeId in the route. Without it,
    // BaseOffice.handleSave skips the updateNode call entirely (see the product
    // note in the final report) and only shows a toast.
    console.log('\n' + '─'.repeat(50));
    console.log(`STEP 2: Navigate to ${HOME_OFFICE} Office`);
    console.log('─'.repeat(50));

    const home = sidebarNode(page, HOME_OFFICE);
    if (await isVisibleWithin(home, 10000)) {
      await home.evaluate((el: HTMLElement) => el.click());
      console.log(`  Clicked ${HOME_OFFICE} office in sidebar`);

      // Poll for the DisabledWithTooltip gate to disappear, which is how the
      // arrival of EditMdx permission shows up in the DOM. These are deliberate
      // point-in-time probes with no timeout argument: `isVisible({ timeout })`
      // ignores the timeout anyway, and the loop is doing the waiting.
      for (let i = 0; i < 30; i++) {
        await sleep(500);
        if (await editButtonGate(page).isVisible()) continue;
        if (await editButton(page).isVisible()) {
          results.editControlReady = true;
          console.log(`  Edit permission ready after ${(i + 1) * 500}ms`);
          break;
        }
      }
      if (!results.editControlReady) {
        // A logged warning is not a result. This ran for 15 seconds, recorded
        // that the product's central capability never became available, and let
        // the spec continue to a pass.
        uxTracker.log('major', 'functional', `EditMdx permission never arrived for the "${HOME_OFFICE}" office`);
        throw new Error(
          `Edit never became available for the "${HOME_OFFICE}" office within 15s, ` +
          'for the account that created the workspace and should be its Admin'
        );
      }
    } else {
      console.log(`  WARNING: ${HOME_OFFICE} office not found in sidebar`);
    }
    await takeScreenshot(page, '02_content_view');

    // ========== STEP 3: Verify Content Area ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Verify Content Area');
    console.log('─'.repeat(50));

    results.contentAreaVisible = await verifyContentArea(page);
    await takeScreenshot(page, '03_content_area');

    // ========== STEP 4: Find Edit Button ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Find Edit Button');
    console.log('─'.repeat(50));

    results.editButtonVisible = await findEditButton(page);
    await takeScreenshot(page, '04_edit_button');

    // ========== STEP 5: Verify MDX Editor ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Verify MDX Editor');
    console.log('─'.repeat(50));

    if (results.editButtonVisible) {
      const editorResult = await verifyMDXEditor(page);
      results.editorLoads = editorResult.loads;
      results.toolbarVisible = editorResult.toolbar;
      await takeScreenshot(page, '05_mdx_editor');
    }

    // ========== STEP 6: Test Save and Persistence ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Test Save and Persistence');
    console.log('─'.repeat(50));

    if (results.editorLoads) {
      const saveResult = await testSaveAndPersist(page);
      results.saveButtonVisible = saveResult.saveVisible;
      results.navigatedAwayAndBack = saveResult.navigated;
      results.contentPersists = saveResult.persists;
      await takeScreenshot(page, '06_save');
    }

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Every line printed below is now part of the gate. Previously the gate was
    // `results.accountCreated` alone, so the spec reported PASS as long as an
    // account could be made — the MDX editor could have been entirely broken.
    const corePassed =
      results.accountCreated &&
      results.editControlReady &&
      results.contentAreaVisible &&
      results.editButtonVisible &&
      results.editorLoads &&
      results.toolbarVisible &&
      results.saveButtonVisible &&
      results.navigatedAwayAndBack &&
      results.contentPersists;

    console.log(`\n  Account Created:           ${results.accountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Edit Permission Ready:     ${results.editControlReady ? 'PASS' : 'FAIL'}`);
    console.log(`  Content Area Visible:      ${results.contentAreaVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Edit Button:               ${results.editButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Editor Loads:              ${results.editorLoads ? 'PASS' : 'FAIL'}`);
    console.log(`  Toolbar Visible:           ${results.toolbarVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Save Button:               ${results.saveButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Navigated Away And Back:   ${results.navigatedAwayAndBack ? 'PASS' : 'FAIL'}`);
    console.log(`  Content Persists:          ${results.contentPersists ? 'PASS' : 'FAIL'}`);
    // Not asserted: BaseOffice only renders TemplateSelector when the node has no
    // mdx_content (`isNewContent || content.trim() === ''`). Every office this spec
    // can reach is seeded from a markdown_file in workspaces.json, so the template
    // button is legitimately absent and asserting it would only ever produce a
    // false failure. Covering it needs an office created empty, which this spec
    // does not create.
    console.log('  Template Selector:         SKIP (only rendered for offices with no MDX content; every seeded office has some)');

    harness.finalize(corePassed, results);
    return corePassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await browser.close();
  }
}

runTestMain(runTest);
