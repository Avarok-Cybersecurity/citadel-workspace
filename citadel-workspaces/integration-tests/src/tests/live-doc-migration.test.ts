/**
 * A document made in the earlier chat editor moves to Citadel Docs once on this device, the
 * first time its invitation is opened, and the original is kept read-only:
 *  1. two people, P2P registered;
 *  2. on the creator's device, an earlier document is stored the way the earlier editor stored
 *     it (live_doc_<id> under the device-wide cid 0: its metadata, and the Yjs state that editor
 *     really wrote, recorded in src/lib/live-doc-migration/__tests__/recorded/), and its
 *     invitation is sent as that editor sent it: a live_document message naming a bare UUID;
 *  3. the creator opens it: the canvas opens over the moved document, which says what the
 *     original said, with the move's report above it and the original on offer;
 *  4. opened again, it is not moved again, and the original is untouched;
 *  5. the peer never opened it on their device: their tab says so, and opens nothing blank.
 *
 * Seeding goes through the page's own modules (the dev server serves them by path), so the
 * stored bytes reach the agent's LocalDB exactly as the app writes them.
 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, type Locator, type Page } from '@playwright/test';
import {
  createSeparateBrowsers,
  createAccount,
  p2pRegister,
  acceptP2PRequest,
  openConversation,
  takeScreenshot,
  TestHarness,
  runTestMain,
  CHAT_DOCUMENT_MS,
  chatDocumentPane,
  openChatDocument,
  expectCanvasOpen,
  chatDocumentSays,
} from '../test-lib.js';

interface MigrationResults {
  seeded: boolean;
  creatorOpenedTheMovedDocument: boolean;
  movedDocumentSaysTheOriginal: boolean;
  reportAndOriginalShown: boolean;
  movedOnce: boolean;
  peerToldItIsNotOnTheirDevice: boolean;
}

const timestamp: number = Date.now();
const USER1: string = `ldmig_a_${timestamp}`;
const USER2: string = `ldmig_b_${timestamp}`;
const DOC_TITLE: string = `Earlier_${timestamp}`;
const DOC_ID: string = randomUUID();

/** What the earlier editor stored for "Plan / Ship **Friday**", recorded while it was in the app. */
const RECORDED: { readonly sample: { readonly update: string } } = JSON.parse(readFileSync(
  new URL('../../../src/lib/live-doc-migration/__tests__/recorded/chat-editor-documents.json', import.meta.url), 'utf-8',
)) as { readonly sample: { readonly update: string } };

/**
 * The parts of the page's own modules this uses, served by path by the dev server. Typed here
 * because the spec cannot import the app's sources; each matches the module it names.
 */
interface CidResolverModule { readonly resolveCurrentCid: () => Promise<bigint | null> }
interface WebSocketServiceModule {
  readonly websocketService: {
    readonly sendLocalDBGet: (cid: bigint, key: string) => Promise<{ readonly value: number[] } | null>;
    readonly sendLocalDBSet: (cid: bigint, key: string, value: number[]) => Promise<void>;
  };
}
interface MessengerModule {
  readonly P2PMessengerManager: {
    readonly getInstance: () => {
      readonly sendMessage: (peer: bigint, content: string, options: { messageType: string; documentId: string; documentTitle: string }) => Promise<unknown>;
    };
  };
}

function step(title: string): void {
  console.log(`\n${'─'.repeat(50)}\n${title}\n${'─'.repeat(50)}`);
}

/** This page's session CID, as the app resolves it. */
async function cidOf(page: Page): Promise<string> {
  return page.evaluate(async (): Promise<string> => {
    const resolverPath: string = '/src/lib/p2p/messenger-cid-resolver.ts';
    const { resolveCurrentCid }: CidResolverModule = await import(/* @vite-ignore */ resolverPath) as CidResolverModule;
    const cid: bigint | null = await resolveCurrentCid();
    if (cid === null) throw new Error('this page has no session');
    return cid.toString();
  });
}

/** The bytes stored under `key` for the device (cid 0), or null. */
async function storedOnDevice(page: Page, key: string): Promise<number[] | null> {
  return page.evaluate(async (k: string): Promise<number[] | null> => {
    const servicePath: string = '/src/lib/websocket-service/index.ts';
    const { websocketService }: WebSocketServiceModule = await import(/* @vite-ignore */ servicePath) as WebSocketServiceModule;
    try {
      return (await websocketService.sendLocalDBGet(0n, k))?.value ?? null;
    } catch {
      return null;
    }
  }, key);
}

/** Stores the earlier document on `creator`'s device and sends its invitation to `peerCid`, as the earlier editor did. */
async function seedEarlierDocument(creator: Page, peerCid: string): Promise<void> {
  await creator.evaluate(async ({ docId, title, update, peer }: { docId: string; title: string; update: string; peer: string }): Promise<void> => {
    const servicePath: string = '/src/lib/websocket-service/index.ts';
    const resolverPath: string = '/src/lib/p2p/messenger-cid-resolver.ts';
    const messengerPath: string = '/src/lib/p2p/index.ts';
    const { websocketService }: WebSocketServiceModule = await import(/* @vite-ignore */ servicePath) as WebSocketServiceModule;
    const { resolveCurrentCid }: CidResolverModule = await import(/* @vite-ignore */ resolverPath) as CidResolverModule;
    const { P2PMessengerManager }: MessengerModule = await import(/* @vite-ignore */ messengerPath) as MessengerModule;
    const self: bigint | null = await resolveCurrentCid();
    if (self === null) throw new Error('the creator has no session');
    const now: number = Date.now();
    const stored: { readonly metadata: Record<string, string | number>; readonly state: number[] } = {
      metadata: { id: docId, title, peerCid: peer, creatorCid: self.toString(), createdAt: now, updatedAt: now, revision: 0 },
      state: Array.from(atob(update), (c: string): number => c.charCodeAt(0)),
    };
    const bytes = (value: unknown): number[] => Array.from(new TextEncoder().encode(JSON.stringify(value)));
    await websocketService.sendLocalDBSet(0n, `live_doc_${docId}`, bytes(stored));
    await websocketService.sendLocalDBSet(0n, 'live_doc_index', bytes([docId]));
    await P2PMessengerManager.getInstance().sendMessage(BigInt(peer), `Created live document: ${title}`, {
      messageType: 'live_document', documentId: docId, documentTitle: title,
    });
  }, { docId: DOC_ID, title: DOC_TITLE, update: RECORDED.sample.update, peer: peerCid });
}

async function runTest(): Promise<boolean> {
  const harness: TestHarness = await TestHarness.create({
    restartBackend: true,
    testName: 'Live Doc Migration Test',
    reportFileName: 'LIVE_DOC_MIGRATION_TEST_REPORT.json',
    metadata: { user1: USER1, user2: USER2, docTitle: DOC_TITLE, docId: DOC_ID },
  });
  const { pages: [page1, page2], cleanup } = await createSeparateBrowsers(2);
  const results: MigrationResults = {
    seeded: false, creatorOpenedTheMovedDocument: false, movedDocumentSaysTheOriginal: false,
    reportAndOriginalShown: false, movedOnce: false, peerToldItIsNotOnTheirDevice: false,
  };

  try {
    step('STEP 1: Accounts and P2P registration');
    await createAccount(page1, USER1, { isFirstUser: true });
    await createAccount(page2, USER2, { isFirstUser: false });
    await p2pRegister(page1, USER1, USER2);
    await acceptP2PRequest(page2, USER2, null, USER1);

    step('STEP 2: The creator\'s device holds an earlier document, and its invitation is sent');
    await openConversation(page1, USER1, USER2);
    await seedEarlierDocument(page1, await cidOf(page2));
    const original: number[] | null = await storedOnDevice(page1, `live_doc_${DOC_ID}`);
    results.seeded = original !== null;

    step('STEP 3: The creator opens it: moved, and the canvas opens over it');
    await openChatDocument(page1, USER1, DOC_TITLE);
    const openedId: string = await expectCanvasOpen(page1, DOC_TITLE);
    results.creatorOpenedTheMovedDocument = openedId === DOC_ID;
    results.movedDocumentSaysTheOriginal = await chatDocumentSays(page1, 'Ship Friday', CHAT_DOCUMENT_MS);
    const pane: Locator = chatDocumentPane(page1);
    await expect(pane.getByTestId('migration-loss-banner')).toBeVisible({ timeout: CHAT_DOCUMENT_MS });
    await pane.getByTestId('migration-show-original').click();
    await expect(pane.getByTestId('migration-original')).toBeVisible({ timeout: CHAT_DOCUMENT_MS });
    results.reportAndOriginalShown = true;
    await takeScreenshot(page1, `${USER1}_moved_document`);

    step('STEP 4: Opened again, it is not moved again, and the original is untouched');
    await page1.getByTestId('chat-tab-messages').click();
    await openChatDocument(page1, USER1, DOC_TITLE);
    await expectCanvasOpen(page1, DOC_TITLE);
    results.movedOnce = await chatDocumentSays(page1, 'Ship Friday', CHAT_DOCUMENT_MS)
      && JSON.stringify(await storedOnDevice(page1, `live_doc_${DOC_ID}`)) === JSON.stringify(original);

    step('STEP 5: The peer never opened it on their device, and is told so');
    await openConversation(page2, USER2, USER1);
    await openChatDocument(page2, USER2, DOC_TITLE);
    const notice: Locator = page2.getByTestId('chat-document-unmoved');
    await expect(notice).toHaveAttribute('data-reason', 'not-stored', { timeout: CHAT_DOCUMENT_MS });
    await expect(chatDocumentPane(page2)).toHaveCount(0);
    results.peerToldItIsNotOnTheirDevice = true;
    await takeScreenshot(page2, `${USER2}_not_on_this_device`);

    const testPassed: boolean = Object.values(results).every((passed: boolean): boolean => passed);
    console.log(`\nTEST ${testPassed ? 'PASSED' : 'FAILED'}`, results);
    harness.finalize(testPassed, { ...results });
    return testPassed;
  } finally {
    await cleanup();
  }
}

runTestMain(runTest);
