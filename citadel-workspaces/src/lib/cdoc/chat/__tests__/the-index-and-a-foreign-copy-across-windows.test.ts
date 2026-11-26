/**
 * Two more shared records across one member's windows. The documents index is read-modify-write
 * (each entry names a document's chat and title): two windows adding a document at once must
 * both stay listed, or the inbox drops the peer's edits for the one that vanished. And a copy
 * written meanwhile by a client of another CRDT format is never merged into, nor written over.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { typeInto } from '../../collab/__tests__/doubles/real-replicas';
import { CHAT_SYNC } from '../chat-config';
import { localChatTransport } from '../chat-local-transport';
import type { StoredBase } from '../chat-ports';
import { newBrowser, openWindow, type Browser, type BrowserWindow, type OpenDocument } from './doubles/browser-windows';
import { ALICE, BLANK, BOB } from './doubles/chat-pair';

let browser: Browser = newBrowser();

afterEach((): void => {
  browser.shut();
  browser = newBrowser();
});

describe('one member\'s windows', () => {
  it('both keep the document each added to the index at the same time', async () => {
    const one: BrowserWindow = await openWindow(browser, ALICE, null);
    const other: BrowserWindow = await openWindow(browser, ALICE, null);
    await Promise.all([one.store.saveEntry('chat-doc-from-one', { peerCid: BOB, title: null }), other.store.saveEntry('chat-doc-from-other', { peerCid: BOB, title: null })]);
    expect(await one.store.loadEntry('chat-doc-from-one')).toEqual({ peerCid: BOB, title: null });
    expect(await one.store.loadEntry('chat-doc-from-other')).toEqual({ peerCid: BOB, title: null });
  });

  it('neither merge nor overwrite a copy another window stored in another format', async () => {
    const docId: string = 'scratch-doc-foreign';
    const window: BrowserWindow = await openWindow(browser, ALICE, null);
    const doc: OpenDocument = await window.open(docId, localChatTransport(ALICE), BLANK, CHAT_SYNC);
    const foreign: StoredBase = { docVersion: CHAT_SYNC.docVersion + 1, snapshot: new Uint8Array([9, 9, 9]) };
    await (await openWindow(browser, ALICE, null)).store.saveBase(docId, foreign);
    await typeInto(doc.editor(), 'kept in this window');
    await doc.close();
    expect(doc.problems.map((p): string => p.kind)).toContain('docVersionMismatch');
    expect(await window.store.loadBase(docId)).toEqual(foreign);
  });
});
