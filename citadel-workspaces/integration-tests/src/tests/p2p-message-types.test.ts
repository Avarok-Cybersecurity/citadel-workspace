/**
 * P2P Message Types & Chat Features Integration Test (P3)
 *
 * Tests extended P2P chat features:
 * 1. TypeSelectorBar (Text / Markdown / Live Doc buttons)
 * 2. MarkdownToolbar (Bold, Italic, etc.)
 * 3. MarkdownBubble (formatted message display)
 * 4. ChatSettingsPanel (settings drawer)
 *
 * Message edit/delete/reply used to be exercised here too. It no longer is:
 * MessageBubble only renders the "..." actions dropdown when it receives
 * onEdit/onDelete/onReply, and neither of the two places that mount P2PChat
 * (WorkspaceView.tsx and pages/Messages.tsx) passes them, so the trigger
 * cannot appear on any screen a user can reach. See STEP 7 below.
 */

import { Page } from 'playwright';
import {
  sleep,
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  sendMessage,
  takeScreenshot,
  setupConsoleCapture,
  waitForP2PReady,
  TestHarness,
  runTestMain,
} from '../lib/index.js';
import { config } from '../lib/config.js';
import { isVisibleWithin, isHiddenWithin } from '../lib/index.js';

// ============================================================================
// Types
// ============================================================================

interface TestResults {
  accountCreation: { user1: boolean; user2: boolean };
  p2pRegistration: boolean;
  p2pAccept: boolean;
  conversationOpened: boolean;

  // TypeSelectorBar
  typeSelectorVisible: boolean;
  textButtonVisible: boolean;
  markdownButtonVisible: boolean;
  liveDocButtonVisible: boolean;

  // Markdown mode
  markdownToolbarAppears: boolean;
  boldButtonVisible: boolean;
  italicButtonVisible: boolean;
  markdownMessageSent: boolean;
  markdownBubbleRendered: boolean;

  // ChatSettingsPanel
  chatSettingsOpens: boolean;
  chatSettingsHasTabs: boolean;
}

// ============================================================================
// Test Configuration
// ============================================================================

const timestamp = Date.now();
const USER1 = `p2ptype_a_${timestamp}`;
const USER2 = `p2ptype_b_${timestamp}`;
const PASSWORD = config.DEFAULT_PASSWORD;

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Verify TypeSelectorBar renders with all buttons
 */
async function verifyTypeSelectorBar(page: Page): Promise<{
  visible: boolean;
  textBtn: boolean;
  markdownBtn: boolean;
  liveDocBtn: boolean;
}> {
  console.log('\n=== Verifying TypeSelectorBar ===');

  const results = { visible: false, textBtn: false, markdownBtn: false, liveDocBtn: false };

  // TypeSelectorBar gives each button a `title` equal to its label, and those
  // three titles are unique on the chat screen. The old selectors unioned in
  // `button:has-text("Text")`, which matches any button whose text merely
  // contains that word, and `.first()` then picked whichever the DOM happened
  // to order first — so a passing result did not mean the type bar was there.
  const textBtn = page.locator('button[title="Text"]');
  const markdownBtn = page.locator('button[title="Markdown"]');
  const liveDocBtn = page.locator('button[title="Live Doc"]');

  // isVisibleWithin, not isVisible({ timeout }): Playwright ignores the timeout
  // option on isVisible, so the old calls were instantaneous snapshots taken
  // while the chat pane was still mounting.
  results.textBtn = await isVisibleWithin(textBtn, 10000);
  results.markdownBtn = await isVisibleWithin(markdownBtn, 5000);
  results.liveDocBtn = await isVisibleWithin(liveDocBtn, 5000);

  // TypeSelectorBar renders all three buttons unconditionally, so this is an
  // AND. As an OR it reported "visible" with two thirds of the bar missing.
  results.visible = results.textBtn && results.markdownBtn && results.liveDocBtn;

  console.log(`  Text: ${results.textBtn}, Markdown: ${results.markdownBtn}, LiveDoc: ${results.liveDocBtn}`);
  return results;
}

/**
 * Switch to Markdown mode and verify toolbar
 */
async function testMarkdownMode(page: Page): Promise<{
  toolbarAppears: boolean;
  boldVisible: boolean;
  italicVisible: boolean;
}> {
  console.log('\n=== Testing Markdown Mode ===');

  const results = { toolbarAppears: false, boldVisible: false, italicVisible: false };

  const markdownBtn = page.locator('button[title="Markdown"]');
  if (!(await isVisibleWithin(markdownBtn, 5000))) {
    console.log('  Markdown button not found');
    return results;
  }

  await markdownBtn.click();

  // MarkdownToolbar labels its buttons "Bold (Ctrl+B)" / "Italic (Ctrl+I)", so
  // match on the title prefix. The toolbar animates in via framer-motion, hence
  // a real wait rather than an immediate probe.
  const boldBtn = page.locator('button[title^="Bold"]');
  const italicBtn = page.locator('button[title^="Italic"]');

  results.boldVisible = await isVisibleWithin(boldBtn, 5000);
  results.italicVisible = await isVisibleWithin(italicBtn, 5000);
  // Both buttons come from the same toolbar render, so AND: an OR would call
  // the toolbar present when half of it failed to render.
  results.toolbarAppears = results.boldVisible && results.italicVisible;

  console.log(`  Toolbar: ${results.toolbarAppears}, Bold: ${results.boldVisible}, Italic: ${results.italicVisible}`);
  return results;
}

/**
 * Send a markdown message and verify it renders as formatted HTML
 */
async function sendMarkdownMessage(page: Page, username: string, marker: string): Promise<{
  sent: boolean;
  rendered: boolean;
}> {
  console.log(`\n=== ${username}: Sending Markdown Message ===`);

  const results = { sent: false, rendered: false };

  const messageInput = page.getByTestId('p2p-message-input').first();
  if (!(await isVisibleWithin(messageInput, 5000))) {
    console.log('  Message input not found');
    return results;
  }

  await messageInput.fill(`**Bold ${marker}** and *italic ${marker}*`);

  const sendBtn = page.getByTestId('p2p-chat').getByTestId('chat-send');
  if (!(await isVisibleWithin(sendBtn, 5000))) {
    console.log('  Send button not found');
    return results;
  }

  // P2PMessageInput disables submit while the input is empty, so "enabled"
  // is the app confirming it accepted the typed markdown. The old code set
  // sent=true merely because a button was on screen.
  if (!(await sendBtn.isEnabled())) {
    console.log('  Send button is disabled - input was not accepted');
    return results;
  }
  await sendBtn.click();
  results.sent = true;
  console.log('  Markdown message sent');

  // MessageSender adds the message to the conversation optimistically (status
  // 'pending') before the wire send, so the bubble is local rendering — but it
  // sits behind an await on peer-readiness, so allow a generous wait.
  //
  // Assert on the rendered markup, not on a `.prose` class: `.prose` also
  // matches the input's live preview pane, so the old check could pass with no
  // message in the list at all. react-markdown turns **/* into <strong>/<em>,
  // which is exactly the behaviour under test.
  const boldRendered = page.locator('strong', { hasText: `Bold ${marker}` }).first();
  const italicRendered = page.locator('em', { hasText: `italic ${marker}` }).first();
  const hasBold = await isVisibleWithin(boldRendered, 20000);
  const hasItalic = await isVisibleWithin(italicRendered, 5000);
  results.rendered = hasBold && hasItalic;
  console.log(`  Markdown bubble rendered: ${results.rendered} (strong: ${hasBold}, em: ${hasItalic})`);

  return results;
}

/**
 * Test ChatSettingsPanel
 */
async function testChatSettingsPanel(page: Page): Promise<{
  opens: boolean;
  hasTabs: boolean;
}> {
  console.log('\n=== Testing Chat Settings Panel ===');

  const results = { opens: false, hasTabs: false };

  // P2PChatHeader ships a data-testid for this button. The old lookup guessed
  // at lucide's internal svg class names and then fell back to a
  // "panel-right" toggle that does not exist in this app at all.
  const settingsBtn = page.locator('[data-testid="chat-settings-button"]');
  if (!(await isVisibleWithin(settingsBtn, 10000))) {
    console.log('  Settings button not found');
    return results;
  }

  await settingsBtn.click();

  // Identify the dialog by its title so a stray dialog elsewhere on the page
  // cannot satisfy this assertion.
  const dialog = page.getByRole('dialog').filter({ hasText: 'Chat Settings' });
  results.opens = await isVisibleWithin(dialog, 5000);
  if (!results.opens) {
    console.log('  Panel did not open');
    return results;
  }

  // Scope the tab lookups to the dialog. The tab-* testids are unique to
  // ChatSettingsPanel today, but a page-wide match would start picking up the
  // office view behind the modal the moment it grows its own tabs.
  const tabNames = ['general', 'file', 'advanced', 'stats'] as const;
  const seen: Record<string, boolean> = {};
  for (const name of tabNames) {
    seen[name] = await isVisibleWithin(dialog.locator(`[data-testid="tab-${name}"]`), 3000);
  }
  // ChatSettingsPanel always renders all four triggers, so a missing one is a
  // failure rather than a variant.
  results.hasTabs = tabNames.every((name) => seen[name]);
  console.log(`  Panel opens: ${results.opens}, tabs: ${JSON.stringify(seen)}`);

  await page.keyboard.press('Escape');
  await isHiddenWithin(dialog, 3000);

  return results;
}

// ============================================================================
// Main Test
// ============================================================================

async function runTest(): Promise<boolean> {
  const harness = await TestHarness.create({
    testName: 'P2P Message Types & Chat Features Test',
    reportFileName: 'P2P_MESSAGE_TYPES_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2 },
    restartBackend: true,
  });
  const uxTracker = harness.uxTracker;

  console.log(`User1: ${USER1}`);
  console.log(`User2: ${USER2}`);
  console.log('');

  const { pages, cleanup } = await createSeparateBrowsers(2);
  const [page1, page2] = pages;

  const results: TestResults = {
    accountCreation: { user1: false, user2: false },
    p2pRegistration: false,
    p2pAccept: false,
    conversationOpened: false,
    typeSelectorVisible: false,
    textButtonVisible: false,
    markdownButtonVisible: false,
    liveDocButtonVisible: false,
    markdownToolbarAppears: false,
    boldButtonVisible: false,
    italicButtonVisible: false,
    markdownMessageSent: false,
    markdownBubbleRendered: false,
    chatSettingsOpens: false,
    chatSettingsHasTabs: false,
  };

  try {
    setupConsoleCapture(page1, 'User1', ['error', 'Error', 'P2P', 'ILM']);
    setupConsoleCapture(page2, 'User2', ['error', 'Error', 'P2P', 'ILM']);

    // ========== STEP 1: Create Accounts ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 1: Create Accounts');
    console.log('─'.repeat(50));

    results.accountCreation.user1 = await createAccount(page1, USER1, {
      isFirstUser: true,
      password: PASSWORD,
      uxTracker,
    });
    results.accountCreation.user2 = await createAccount(page2, USER2, {
      isFirstUser: false,
      password: PASSWORD,
      uxTracker,
    });

    await takeScreenshot(page1, '01_user1_created');
    await takeScreenshot(page2, '01_user2_created');

    if (!results.accountCreation.user1 || !results.accountCreation.user2) {
      throw new Error('Account creation failed');
    }

    // ========== STEP 2: P2P Registration ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 2: P2P Registration');
    console.log('─'.repeat(50));

    results.p2pRegistration = await p2pRegister(page1, USER1, USER2);
    await sleep(3000);
    results.p2pAccept = await acceptP2PRequest(page2, USER2, null, USER1);

    console.log('  Waiting for P2P connection...');
    await sleep(5000);

    // Wait for P2P ready
    await waitForP2PReady(page1, USER1, USER2, 30000);

    // ========== STEP 3: Open Conversation ==========
    console.log('\n' + '─'.repeat(50));
    console.log('STEP 3: Open Conversation');
    console.log('─'.repeat(50));

    results.conversationOpened = await openConversation(page1, USER1, USER2);
    await takeScreenshot(page1, '03_conversation_opened');

    if (results.conversationOpened) {
      // Send a warmup message to establish channel
      await sendMessage(page1, USER1, 'Warmup message');
      await sleep(3000);

      // ========== STEP 4: Verify TypeSelectorBar ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 4: Verify TypeSelectorBar');
      console.log('─'.repeat(50));

      const selectorResult = await verifyTypeSelectorBar(page1);
      results.typeSelectorVisible = selectorResult.visible;
      results.textButtonVisible = selectorResult.textBtn;
      results.markdownButtonVisible = selectorResult.markdownBtn;
      results.liveDocButtonVisible = selectorResult.liveDocBtn;
      await takeScreenshot(page1, '04_type_selector');

      // ========== STEP 5: Test Markdown Mode ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 5: Test Markdown Mode');
      console.log('─'.repeat(50));

      const markdownResult = await testMarkdownMode(page1);
      results.markdownToolbarAppears = markdownResult.toolbarAppears;
      results.boldButtonVisible = markdownResult.boldVisible;
      results.italicButtonVisible = markdownResult.italicVisible;
      await takeScreenshot(page1, '05_markdown_toolbar');

      // ========== STEP 6: Send Markdown Message ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 6: Send Markdown Message');
      console.log('─'.repeat(50));

      const sendResult = await sendMarkdownMessage(page1, USER1, `mk${timestamp}`);
      results.markdownMessageSent = sendResult.sent;
      results.markdownBubbleRendered = sendResult.rendered;
      await takeScreenshot(page1, '06_markdown_message');

      // ========== STEP 7: Message Context Menu (removed) ==========
      // There is nothing to click here. TextBubble/MarkdownBubble render the
      // "..." dropdown only when `onEdit || onDelete || onReply` is supplied,
      // P2PMessageList only supplies those when P2PChat receives
      // onEditMessage/onDeleteMessage/onReplyMessage, and the only two mounts
      // of P2PChat in the app (components/workspace/WorkspaceView.tsx and
      // pages/Messages.tsx) pass neither. Reply/Edit/Delete are therefore
      // unreachable in the shipped UI, so the old assertions could only ever
      // print CHECK.

      // ========== STEP 8: Test Chat Settings Panel ==========
      console.log('\n' + '─'.repeat(50));
      console.log('STEP 8: Test Chat Settings Panel');
      console.log('─'.repeat(50));

      const settingsResult = await testChatSettingsPanel(page1);
      results.chatSettingsOpens = settingsResult.opens;
      results.chatSettingsHasTabs = settingsResult.hasTabs;
      await takeScreenshot(page1, '08_chat_settings');
    } else {
      console.log('  Conversation could not be opened - skipping chat feature steps');
      uxTracker.log('critical', 'functional', 'Could not open P2P conversation');
    }

    // ========== RESULTS ==========
    console.log('\n' + '='.repeat(60));
    console.log('TEST RESULTS');
    console.log('='.repeat(60));

    // Everything below the conversation is deterministic client-side rendering,
    // so all of it is gated. p2pRegistration/p2pAccept are deliberately NOT
    // gated: they are real two-party handshakes whose helpers report false on
    // timing alone, and openConversation already fails if registration did not
    // actually take effect.
    const corePassed =
      results.accountCreation.user1 &&
      results.accountCreation.user2 &&
      results.conversationOpened &&
      results.typeSelectorVisible &&
      results.textButtonVisible &&
      results.markdownButtonVisible &&
      results.liveDocButtonVisible &&
      results.markdownToolbarAppears &&
      results.boldButtonVisible &&
      results.italicButtonVisible &&
      results.markdownMessageSent &&
      results.markdownBubbleRendered &&
      results.chatSettingsOpens &&
      results.chatSettingsHasTabs;

    console.log('\nAccounts:');
    console.log(`  User1 Created:             ${results.accountCreation.user1 ? 'PASS' : 'FAIL'}`);
    console.log(`  User2 Created:             ${results.accountCreation.user2 ? 'PASS' : 'FAIL'}`);
    console.log(`  P2P Registered:            ${results.p2pRegistration ? 'PASS' : 'CHECK'}  (not gated: P2P handshake timing)`);
    console.log(`  P2P Accepted:              ${results.p2pAccept ? 'PASS' : 'CHECK'}  (not gated: P2P handshake timing)`);
    console.log(`  Conversation Opened:       ${results.conversationOpened ? 'PASS' : 'FAIL'}`);

    console.log('\nTypeSelectorBar:');
    console.log(`  Visible:                   ${results.typeSelectorVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Text Button:               ${results.textButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Markdown Button:           ${results.markdownButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Live Doc Button:           ${results.liveDocButtonVisible ? 'PASS' : 'FAIL'}`);

    console.log('\nMarkdown Mode:');
    console.log(`  Toolbar Appears:           ${results.markdownToolbarAppears ? 'PASS' : 'FAIL'}`);
    console.log(`  Bold Button:               ${results.boldButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Italic Button:             ${results.italicButtonVisible ? 'PASS' : 'FAIL'}`);
    console.log(`  Message Sent:              ${results.markdownMessageSent ? 'PASS' : 'FAIL'}`);
    console.log(`  Bubble Rendered:           ${results.markdownBubbleRendered ? 'PASS' : 'FAIL'}`);

    console.log('\nContext Menu:');
    console.log('  Reply/Edit/Delete:         SKIP (no P2PChat call site passes the handlers, so the trigger never renders)');

    console.log('\nChat Settings Panel:');
    console.log(`  Opens:                     ${results.chatSettingsOpens ? 'PASS' : 'FAIL'}`);
    console.log(`  Has Tabs:                  ${results.chatSettingsHasTabs ? 'PASS' : 'FAIL'}`);

    harness.finalize(corePassed, results);
    return corePassed;

  } catch (error) {
    console.error('\nTest error:', error);
    throw error;
  } finally {
    await cleanup();
  }
}

// ============================================================================
// Entry Point
// ============================================================================

runTestMain(runTest);
