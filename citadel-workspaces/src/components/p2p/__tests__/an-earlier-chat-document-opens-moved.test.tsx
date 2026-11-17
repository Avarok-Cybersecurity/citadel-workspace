/**
 * An invitation from before this release names a document made in the earlier chat editor.
 * Opened, it is moved to Citadel Docs once on this device by the real importer (the vendored
 * engine's tiptap_to_crdt_snapshot), and the canvas opens over the moved document, with the
 * move's report above it and the original, untouched, on offer. When the peer's copy was moved
 * from a different original, the two are held apart and the banner says whose is the document:
 * the creator's, and the creator is whoever SENT the invitation, never the creatorCid stored
 * with the original (which named the recipient on the recipient's device).
 *
 * Rendered: the whole P2PChat, unmodified. Faked: the network, the agent's LocalDB and the
 * conversation store (doubles/chat-document-world.tsx), and the engine binary's fetch (read
 * from disk instead: jsdom has no fetch of a page URL).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import type { CdocRuntime } from '@/lib/cdoc/runtime';
import type { CdocWasm, PdfWasm } from '@/lib/cdoc/engine/cdoc-wasm-api';
import { statedViewport } from '@/components/documents/__tests__/editor-harness';
import { eventEmitter } from '@/lib/event-emitter';
import { CHAT_SYNC } from '@/lib/cdoc/chat/chat-config';
import { CDOC_CHAT_COMMAND_EVENT, type CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import { ALICE, BOB, ChatDocumentWorld, chatOf, renderChats } from './doubles/chat-document-world';
import { canvasOpen, chatPane, storedText, CANVAS_MS, FLOW_MS } from './doubles/chat-document-steps';

vi.mock('@/lib/cdoc/runtime-loader', async () => {
  const { inProcessRuntime } = await import('@/lib/cdoc/__tests__/wasm-rig');
  return { loadCdocRuntime: (): Promise<CdocRuntime> => Promise.resolve(inProcessRuntime('main-thread')) };
});

// The browser adapter fetches the binary by URL, which jsdom cannot; the same vendored binary,
// read from disk, is what the importer runs on here.
vi.mock('@/lib/cdoc/engine/load-wasm', async () => {
  const { realWasm, realPdfWasm } = await import('@/lib/cdoc/__tests__/wasm-rig');
  return { loadCdocEditorWasm: async (): Promise<CdocWasm> => realWasm(), loadCdocPdfWasm: async (): Promise<PdfWasm> => realPdfWasm() };
});

statedViewport();

const DOC: string = '5d1f6a0e-3b7c-4e2a-8f19-6c0d2b4a7e91';
const THEIRS: string = 'f'.repeat(64);

let world: ChatDocumentWorld;
beforeEach(() => {
  world = new ChatDocumentWorld();
  world.install();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Alice's device holds the earlier "Plan", stored as the earlier editor stored it, Alice recorded as its creator. */
const storeAlicesEarlierPlan = (): Promise<void> => world.storeEarlierDocument(DOC, ALICE, BOB, 'Plan', ['Ship Friday']);

/** Alice opens it from the invitation in her chat with Bob, which `sender` sent. */
async function openAlicesEarlierPlan(user: UserEvent, sender: bigint): Promise<HTMLElement> {
  world.received(BOB, world.earlierInvitation(sender, sender === ALICE ? BOB : ALICE, DOC, 'Plan'));
  renderChats(chatOf(ALICE, BOB));
  await user.click(await within(chatPane('Alice')).findByRole('button', { name: /Plan/ }));
  return canvasOpen(chatPane('Alice'), 'Plan');
}

/** Bob's copy says it was moved from another original. */
function bobsHelloFromAnotherOriginal(): void {
  const event: CdocChatCommandEvent = {
    peerCid: BOB, recipientCid: ALICE,
    payload: { doc_id: DOC, doc_version: CHAT_SYNC.docVersion, sync: { kind: 'hello', state_vector: new Uint8Array(0), answer: false, migration_origin: THEIRS, title: null } },
  };
  eventEmitter.emit(CDOC_CHAT_COMMAND_EVENT, event);
}

describe('an earlier chat document opened on the device that holds it', () => {
  it('opens moved, says what the original said, shows the move\'s report and keeps the original', async () => {
    const user: UserEvent = userEvent.setup();
    await storeAlicesEarlierPlan();
    const original: readonly number[] | null = await world.stored(0n, `live_doc_${DOC}`);
    const pane: HTMLElement = await openAlicesEarlierPlan(user, ALICE);
    expect(within(pane).getByTestId('migration-loss-banner')).toBeTruthy();
    await user.click(within(pane).getByTestId('migration-show-original'));
    expect(await within(pane).findByTestId('migration-original', {}, { timeout: CANVAS_MS })).toBeTruthy();
    expect(await storedText(world, chatPane('Alice'), ALICE, DOC)).toContain('Ship Friday');
    expect(original).not.toBeNull();
    expect(await world.stored(0n, `live_doc_${DOC}`)).toEqual(original);
  }, FLOW_MS);

  for (const [sender, side, note] of [[ALICE, 'its creator', /Yours stays the document/], [BOB, 'not its creator', /Theirs is the document/]] as const) {
    it(`is held apart from a copy moved from another original, and, ${side}, says whose is the document`, async () => {
      await storeAlicesEarlierPlan();
      const pane: HTMLElement = await openAlicesEarlierPlan(userEvent.setup(), sender);
      await waitFor(() => expect(world.carried).toContain('hello'), { timeout: CANVAS_MS });
      bobsHelloFromAnotherOriginal();
      const conflict: HTMLElement = await within(pane).findByTestId('migration-conflict', {}, { timeout: CANVAS_MS });
      expect(conflict).toHaveTextContent(note);
    }, FLOW_MS);
  }
});
