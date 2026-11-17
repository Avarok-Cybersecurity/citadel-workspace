/**
 * A document made in a 1:1 chat opens in the Citadel Docs canvas and is shared live with the
 * peer, both ways:
 *  1. two people, P2P registered;
 *  2. the first makes a document from the composer: the canvas opens for it at once (a cdoc-
 *     document, its title as the heading, its first page painted), and its invitation's bubble
 *     is in the conversation;
 *  3. the first types; the second opens the invitation and the canvas comes to say it;
 *  4. the second types; the first's canvas comes to say that too.
 *
 * What a document says is read as the person reads it, from its plain-text download.
 */
import type { Page } from 'playwright';
import { expect, type Locator } from '@playwright/test';
import {
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  takeScreenshot,
  setupConsoleCapture,
  TestHarness,
  runTestMain,
  createChatDocument,
  openChatDocument,
  expectCanvasOpen,
  typeInChatDocument,
  chatDocumentSays,
  chatDocumentText,
} from '../test-lib.js';

interface LiveDocTestResults {
  accountCreation: boolean;
  p2pRegistration: boolean;
  p2pAccept: boolean;
  canvasOpened: boolean;
  invitationShown: boolean;
  peerOpenedTheSameDocument: boolean;
  user1ToUser2Sync: boolean;
  user2ToUser1Sync: boolean;
}

const timestamp: number = Date.now();
const USER1: string = `livedoc_a_${timestamp}`;
const USER2: string = `livedoc_b_${timestamp}`;
const DOC_TITLE: string = `TestDoc_${timestamp}`;
const SYNC_MS: number = 60_000;

function step(title: string): void {
  console.log(`\n${'─'.repeat(50)}\n${title}\n${'─'.repeat(50)}`);
}

/**
 * The invitation's bubble (not the document's tab, which carries the same title). The bubble lives
 * in the Messages tab, which is not on screen while the document's tab is, so it is looked for
 * there and the document's tab is returned to.
 */
async function invitationShown(page: Page, docId: string): Promise<boolean> {
  await page.getByTestId('chat-tab-messages').click();
  const bubble: Locator = page.getByRole('button', { name: new RegExp(`${DOC_TITLE}.*Live Document`) });
  // `isVisible({ timeout })` never waits; the expect does.
  const shown: boolean = await expect(bubble.first()).toBeVisible({ timeout: SYNC_MS }).then((): boolean => true, (): boolean => false);
  await page.getByTestId(`chat-tab-doc-${docId}`).click();
  return shown;
}

async function runTest(): Promise<boolean> {
  const harness: TestHarness = await TestHarness.create({
    restartBackend: true,
    testName: 'Live Doc Bidirectional Sync Test',
    reportFileName: 'LIVE_DOC_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2, docTitle: DOC_TITLE },
  });
  // Separate browser contexts, so each person is their own leader tab.
  const { pages: [page1, page2], cleanup } = await createSeparateBrowsers(2);
  const results: LiveDocTestResults = {
    accountCreation: false, p2pRegistration: false, p2pAccept: false, canvasOpened: false,
    invitationShown: false, peerOpenedTheSameDocument: false, user1ToUser2Sync: false, user2ToUser1Sync: false,
  };

  try {
    const logs1: string[] = setupConsoleCapture(page1, 'User1', ['cdoc', 'sync', 'Sync', 'P2P']);
    const logs2: string[] = setupConsoleCapture(page2, 'User2', ['cdoc', 'sync', 'Sync', 'P2P']);

    step('STEP 1: Accounts and P2P registration');
    await createAccount(page1, USER1, { isFirstUser: true });
    await createAccount(page2, USER2, { isFirstUser: false });
    results.accountCreation = true;
    results.p2pRegistration = await p2pRegister(page1, USER1, USER2);
    results.p2pAccept = await acceptP2PRequest(page2, USER2, null, USER1);

    step('STEP 2: User 1 makes a document; the canvas opens for it');
    await openConversation(page1, USER1, USER2);
    const docId: string = await createChatDocument(page1, USER1, DOC_TITLE);
    results.canvasOpened = true;
    results.invitationShown = await invitationShown(page1, docId);

    step('STEP 3: User 1 types; User 2 opens the invitation and sees it');
    // Unique per run, so text left from an earlier run cannot pass the check.
    const RUN: string = Date.now().toString(36);
    const TEXT1: string = `Hello from User 1 [${RUN}]`;
    await typeInChatDocument(page1, TEXT1);
    await openConversation(page2, USER2, USER1);
    await openChatDocument(page2, USER2, DOC_TITLE);
    results.peerOpenedTheSameDocument = (await expectCanvasOpen(page2, DOC_TITLE)) === docId;
    results.user1ToUser2Sync = await chatDocumentSays(page2, TEXT1, SYNC_MS);
    console.log(`  User 2's copy says User 1's text: ${results.user1ToUser2Sync}`);

    step('STEP 4: User 2 types; User 1 sees it');
    const TEXT2: string = ` And hello from User 2 [${RUN}]`;
    await typeInChatDocument(page2, TEXT2);
    results.user2ToUser1Sync = await chatDocumentSays(page1, TEXT2.trim(), SYNC_MS);
    console.log(`  User 1's copy says User 2's text: ${results.user2ToUser1Sync}`);

    const content1: string = await chatDocumentText(page1);
    const content2: string = await chatDocumentText(page2);
    console.log('\nUser 1 logs:'); logs1.slice(-20).forEach((line: string): void => console.log(`  ${line}`));
    console.log('\nUser 2 logs:'); logs2.slice(-20).forEach((line: string): void => console.log(`  ${line}`));
    await takeScreenshot(page1, 'FINAL_user1');
    await takeScreenshot(page2, 'FINAL_user2');

    console.log(`  Results: ${JSON.stringify(results)}`);
    const testPassed: boolean = results.canvasOpened && results.invitationShown && results.peerOpenedTheSameDocument
      && results.user1ToUser2Sync && results.user2ToUser1Sync;
    console.log(`\nTEST ${testPassed ? 'PASSED' : 'FAILED'}`);
    harness.finalize(testPassed, { ...results, docId, content1Final: content1, content2Final: content2 });
    return testPassed;
  } finally {
    await cleanup();
  }
}

runTestMain(runTest);
