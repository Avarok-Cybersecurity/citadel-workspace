/**
 * One member's chat document open in one window and closed in another: the peer's edit that
 * the closed window's inbox records, and the open window's own edits, both stay on the device,
 * and the open window shows the peer's edit. "Open" is known only per window (each has its own
 * open set), so the closed window records while the other writes the same copy; neither write
 * may replace the other's, even when they interleave.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CdocChatCommandEvent } from '@/types/cdoc-chat-sync';
import type { EditorSession } from '../../editor/editor-session';
import { realReplicas, snapshotText, typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC } from '../chat-config';
import type { LocalDbPort } from '../chat-local-db';
import type { StoredBase } from '../chat-ports';
import { newBrowser, openWindow, type Browser, type BrowserWindow, type OpenDocument } from './doubles/browser-windows';
import { ALICE, BLANK, BOB } from './doubles/chat-pair';
import { FakeChannel } from './doubles/fake-channel';

let browser: Browser = newBrowser();

afterEach((): void => {
  browser.shut();
  browser = newBrowser();
});

/** Alice's window with the direct chat's document open; it has written the new document once. */
async function openHere(docId: string): Promise<{ readonly window: BrowserWindow; readonly doc: OpenDocument; readonly base: StoredBase }> {
  const channel: FakeChannel = new FakeChannel();
  // Bob is offline: what Alice's sync sends him is lost.
  channel.up = false;
  const window: BrowserWindow = await openWindow(browser, ALICE, null);
  const doc: OpenDocument = await window.open(docId, channel.transport(ALICE, BOB), BLANK, CHAT_SYNC);
  browser.clock.advance(CHAT_SYNC.storeAfterIdleMs);
  const base: StoredBase = await vi.waitFor(async (): Promise<StoredBase> => {
    const stored: StoredBase | null = await window.store.loadBase(docId);
    if (stored === null) throw new Error('not written yet');
    return stored;
  });
  return { window, doc, base };
}

/** Bob's edit to the document as Alice stored it: a real CRDT update from his replica. */
async function bobsEdit(docId: string, base: StoredBase, text: string): Promise<CdocChatCommandEvent> {
  const bob: EditorSession = await realReplicas().open({ kind: 'snapshot', snapshot: base.snapshot });
  const updates: Uint8Array[] = [];
  bob.on('change', ({ update }: { readonly update: Uint8Array }): void => { updates.push(update); });
  await typeInto(bob, text);
  bob.dispose();
  return { peerCid: BOB, recipient_cid: ALICE, payload: { doc_id: docId, doc_version: CHAT_SYNC.docVersion, sync: { kind: 'update', updates } } };
}

async function reopenedText(docId: string): Promise<string> {
  const channel: FakeChannel = new FakeChannel();
  channel.up = false;
  const again: OpenDocument = await (await openWindow(browser, ALICE, null)).open(docId, channel.transport(ALICE, BOB), BLANK, CHAT_SYNC);
  const text: string = await snapshotText(again.editor());
  await again.close();
  return text;
}

/** `port`, with its first write of a document's updates held until release(). */
function holdingFirstPendingWrite(port: LocalDbPort): { readonly port: LocalDbPort; readonly reached: Promise<void>; release(): void } {
  let reach: () => void = (): void => undefined;
  let release: () => void = (): void => undefined;
  const reached: Promise<void> = new Promise<void>((resolve: () => void): void => { reach = resolve; });
  const released: Promise<void> = new Promise<void>((resolve: () => void): void => { release = resolve; });
  let held: boolean = false;
  return {
    reached,
    release: (): void => release(),
    port: {
      get: (cid: bigint, key: string) => port.get(cid, key),
      set: async (cid: bigint, key: string, value: number[]): Promise<void> => {
        if (!held && key.endsWith('#pending')) {
          held = true;
          reach();
          await released;
        }
        return port.set(cid, key, value);
      },
    },
  };
}

describe('a chat document closed in one window and open in another', () => {
  it('shows the peer\'s edit the closed window recorded, and keeps it through the open window\'s next write', async () => {
    const docId: string = 'chat-doc-closed-beside-open';
    const { doc, base } = await openHere(docId);
    const closedHere: BrowserWindow = await openWindow(browser, ALICE, null);
    expect(await closedHere.record(await bobsEdit(docId, base, 'peer-edit-P'))).toBe('recorded');
    // The open window hears the record and shows it, before it writes anything of its own.
    await vi.waitFor(async (): Promise<void> => {
      expect(await snapshotText(doc.editor())).toContain('peer-edit-P');
    });
    await typeInto(doc.editor(), 'own-edit-Y');
    await doc.close();
    const text: string = await reopenedText(docId);
    expect(text).toContain('peer-edit-P');
    expect(text).toContain('own-edit-Y');
    expect(doc.problems).toEqual([]);
  });

  it('loses neither write when the recording interleaves with the open window\'s write, and shows the peer\'s edit', async () => {
    const docId: string = 'chat-doc-interleaved';
    const { doc, base } = await openHere(docId);
    const held = holdingFirstPendingWrite(browser.db.connection([ALICE]));
    const closedHere: BrowserWindow = await openWindow(browser, ALICE, held.port);
    const recorded = closedHere.record(await bobsEdit(docId, base, 'peer-edit-P'));
    // The closed window has read the stored updates and is about to write them back with Bob's.
    await held.reached;
    await typeInto(doc.editor(), 'own-edit-Y');
    browser.clock.advance(CHAT_SYNC.storeAfterIdleMs);
    // Let the open window's write run as far as it can before the held one lands.
    for (let turn: number = 0; turn < 5; turn += 1) await new Promise<void>((resolve: () => void): void => { setTimeout(resolve, 0); });
    held.release();
    expect(await recorded).toBe('recorded');
    await vi.waitFor(async (): Promise<void> => {
      expect(await snapshotText(doc.editor())).toContain('peer-edit-P');
    });
    await doc.close();
    const text: string = await reopenedText(docId);
    expect(text).toContain('peer-edit-P');
    expect(text).toContain('own-edit-Y');
    expect(doc.problems).toEqual([]);
  });
});
