/**
 * Group Chat Extended Integration Test (P7)
 *
 * What this spec can actually reach with one user and no peers:
 *   1. The office Chat tab activates and renders GroupChatView
 *      (src/components/chat/GroupChatView.tsx)
 *   2. That view's composer and empty state are present
 *   3. The /groups/:groupId route is registered and its "group not found" guard fires
 *
 * What it deliberately does NOT assert — see the SKIP block at the bottom:
 * GroupChatHeader (group name, member count, settings dropdown) and
 * GroupSettingsPanel are rendered ONLY by src/pages/GroupChatPage.tsx, i.e. only
 * on /groups/:groupId for a real peer group. The office/room Chat tab embeds
 * GroupChatView directly with no header at all, so the old assertions here were
 * looking for markup that the view under test never renders.
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
  hasOffices,
  navigateToOffice,
  activateTab,
  isVisibleWithin,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { config } from '../lib/config.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreated: boolean;
  officesPresent: boolean;
  officeNavigated: boolean;

  // Office chat tab
  chatTabActivates: boolean;
  chatPanelHasContent: boolean;
  composerVisible: boolean;
  emptyStateVisible: boolean;

  // Route
  groupRouteGuardWorks: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USERNAME = `grpchat_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// "General" is seeded by docker/workspace-server/workspaces.json with
// chat_enabled: true, so the server assigns it a chat_channel_id and BaseOffice
// renders the Content/Chat tabs. An office created through the UI gets
// chat_channel_id: None and therefore has no Chat tab at all — which is why this
// spec targets a seeded office instead of creating its own, as it used to. (The
// old version created `TestOffice_<ts>` only when the workspace was empty, then
// navigated to that name unconditionally: on a seeded workspace it navigated to
// an office that had never been created, ignored the false return value, and ran
// every chat assertion against whatever happened to be on screen.)
const CHAT_OFFICE = 'General';

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Confirm the Chat tab really activated and that GroupChatView is behind it.
 *
 * `activateTab` is given a tab locator scoped to the office's own tablist. A bare
 * `[role="tab"]:has-text("Chat")` matches page-wide, including tabs inside any
 * dialog or sheet that happens to be mounted, so it can report success for a tab
 * the user never sees.
 */
async function openOfficeChatTab(page: Page): Promise<{ works: boolean; hasContent: boolean }> {
  console.log('\n=== Activating office Chat tab ===');

  const officeTabs = page.locator('[role="tablist"]').first();
  const chatTab = officeTabs.getByRole('tab', { name: 'Chat' });
  const activePanel = page.locator('[role="tabpanel"][data-state="active"]').first();

  const activation = await activateTab(page, chatTab, 'Chat', activePanel);
  return { works: activation.works, hasContent: activation.hasContent };
}

/**
 * GroupChatView's two unconditional pieces of chrome: the composer, and — with no
 * messages yet — the empty state. Asserting these is what tells us the chat tab
 * mounted the real component rather than an error boundary or a spinner.
 */
async function verifyGroupChatView(page: Page): Promise<{
  composer: boolean;
  emptyState: boolean;
}> {
  console.log('\n=== Verifying GroupChatView ===');

  const composer = await isVisibleWithin(
    page.getByPlaceholder('Type a message...').first(),
    10000
  );
  console.log(`  Message composer visible: ${composer}`);

  const emptyState = await isVisibleWithin(
    page.getByText('No messages yet').first(),
    10000
  );
  console.log(`  Empty state visible: ${emptyState}`);

  return { composer, emptyState };
}

/**
 * Exercise /groups/:groupId without needing a peer group.
 *
 * GroupChatPage looks the id up and, when it misses, toasts "Group not found" and
 * redirects to /workspace. That toast is only reachable if the route is actually
 * registered in App.tsx — an unregistered path falls through to the `*` NotFound
 * element, which renders no toast. So this is a real assertion about routing, and
 * unlike the old version it does not need a group to exist.
 *
 * pushState + popstate rather than page.goto: a full document load tears down the
 * WASM client and its WebSocket, and the app comes back unauthenticated. (The old
 * Step 6 did `page.goto(currentUrl)` on the office URL and then asserted
 * `getByText('General').or(page.locator('h2'))` — an `h2` locator matches any
 * heading anywhere, so that assertion passed on essentially any rendered page.)
 */
async function verifyGroupRouteGuard(page: Page): Promise<boolean> {
  console.log('\n=== Testing /groups/:groupId route guard ===');

  const unknownGroupId = `no-such-group-${timestamp}`;
  await page.evaluate((target: string) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/groups/${unknownGroupId}`);

  const toasted = await isVisibleWithin(page.getByText('Group not found').first(), 15000);
  console.log(`  "Group not found" toast shown: ${toasted}`);

  const redirected = await page
    .waitForURL((url: URL) => url.pathname === '/workspace', { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  console.log(`  Redirected back to /workspace: ${redirected}`);

  return toasted && redirected;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'Group Chat Extended Test',
    reportFileName: 'GROUP_CHAT_EXTENDED_TEST_REPORT.json',
    metadata: { username: USERNAME, office: CHAT_OFFICE },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  const { browser, context } = await createBrowser();

  const results: TestResults = {
    accountCreated: false,
    officesPresent: false,
    officeNavigated: false,
    chatTabActivates: false,
    chatPanelHasContent: false,
    composerVisible: false,
    emptyStateVisible: false,
    groupRouteGuardWorks: false,
  };

  try {
    const page = await context.newPage();
    setupConsoleCapture(page, 'GroupChat', ['error', 'Error', 'chat', 'ILM']);

    // ========== STEP 1: Create Account ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Account');
    console.log('─'.repeat(50));

    results.accountCreated = await createAccount(page, USERNAME, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });

    if (!results.accountCreated) throw new Error('Account creation failed');

    await sleep(3000);
    await closeAnyModals(page);
    await waitForWorkspaceLoaded(page, 30000);

    // ========== STEP 2: Seeded offices present ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: Seeded Offices');
    console.log('─'.repeat(50));

    results.officesPresent = await hasOffices(page, USERNAME);
    if (!results.officesPresent) {
      uxTracker.log('major', 'functional', 'Workspace initialization produced no offices from workspaces.json');
    }
    await takeScreenshot(page, '02_offices');

    // ========== STEP 3: Navigate to the chat-enabled office ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Navigate to Office');
    console.log('─'.repeat(50));

    // The return value used to be discarded; a failed navigation then showed up
    // as a mysterious chat failure three steps later.
    results.officeNavigated = await navigateToOffice(page, USERNAME, CHAT_OFFICE);
    await sleep(2000);

    // ========== STEP 4: Open the Chat tab ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 4: Open Chat Tab');
    console.log('─'.repeat(50));

    if (results.officeNavigated) {
      const tab = await openOfficeChatTab(page);
      results.chatTabActivates = tab.works;
      results.chatPanelHasContent = tab.hasContent;
      await takeScreenshot(page, '03_chat_tab');
    }

    // ========== STEP 5: Verify GroupChatView ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 5: Verify GroupChatView');
    console.log('─'.repeat(50));

    if (results.chatTabActivates) {
      const view = await verifyGroupChatView(page);
      results.composerVisible = view.composer;
      results.emptyStateVisible = view.emptyState;
      await takeScreenshot(page, '04_group_chat_view');
    }

    // ========== STEP 6: /groups/:groupId route guard ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 6: Group Route Guard');
    console.log('─'.repeat(50));

    results.groupRouteGuardWorks = await verifyGroupRouteGuard(page);
    await takeScreenshot(page, '05_group_route');

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // The gate used to be `results.accountCreated` alone, so every chat assertion
    // below could fail while the spec reported PASS.
    const corePassed =
      results.accountCreated &&
      results.officesPresent &&
      results.officeNavigated &&
      results.chatTabActivates &&
      results.chatPanelHasContent &&
      results.composerVisible &&
      results.emptyStateVisible &&
      results.groupRouteGuardWorks;

    console.log(`\n  Account Created:           ${results.accountCreated ? 'PASS' : 'FAIL'}`);
    console.log(`  Seeded Offices Present:    ${results.officesPresent ? 'PASS' : 'FAIL'}`);
    console.log(`  Navigated to "${CHAT_OFFICE}":     ${results.officeNavigated ? 'PASS' : 'FAIL'}`);
    console.log(`  Chat Tab Activates:        ${results.chatTabActivates ? 'PASS' : 'FAIL'}`);
    console.log(`  Chat Panel Has Content:    ${results.chatPanelHasContent ? 'PASS' : 'FAIL'}`);
    console.log(`  Message Composer:          ${results.composerVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Empty State:               ${results.emptyStateVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Group Route Guard:         ${results.groupRouteGuardWorks ? 'PASS' : 'FAIL'}`);

    // Not asserted here, and not because they are unimportant: GroupChatHeader and
    // GroupSettingsPanel are mounted only by src/pages/GroupChatPage.tsx, which
    // requires an existing peer group (useGroupConversations().getGroup(groupId)).
    // Building one needs a second registered peer and the CreateGroupDialog flow,
    // neither of which this single-user spec sets up. Asserting them against the
    // office Chat tab — as this spec used to — can only ever fail, because
    // GroupChatView renders no header, no member count and no settings dropdown.
    console.log('\nNot exercised by this spec:');
    console.log('  Group Chat Header:         SKIP (GroupChatPage-only; needs a peer group with >= 2 members)');
    console.log('  Member Count:              SKIP (same — rendered by GroupChatHeader)');
    console.log('  Settings Dropdown:         SKIP (same — rendered by GroupChatHeader)');
    console.log('  Group Settings Panel:      SKIP (opened from GroupChatHeader; unreachable without a group)');

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
