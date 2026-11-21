/**
 * What a chat's document tab opens, decided from the id: a Citadel Docs document opens as a
 * canvas from blank (or from the creator's typed text); a document the earlier chat editor made
 * is not opened at all, and the tab says so.
 *
 * The port is the I/O this logic is handed (the canvas's opener), so it is the stand-in here:
 * recording what it was asked, answering as the real one does. The canvas's own behaviour is
 * tested in lib/cdoc/chat, and the two together through the whole chat in components/p2p/__tests__.
 */
import { describe, expect, it } from 'vitest';
import type { ChatDocument, ChatDocumentRequest } from '@/components/documents/chat-replica';
import { createValueStore } from '@/lib/value-store';
import { openChatDocumentTab, type ChatDocumentOpening, type ChatDocumentTarget, type OpeningPorts } from '../chat-document-opening';

function ports(): { readonly ports: OpeningPorts; readonly requests: ChatDocumentRequest[] } {
  const requests: ChatDocumentRequest[] = [];
  const document: ChatDocument = {
    editing: { kind: 'readOnly', reason: 'a stand-in' }, title: createValueStore<string>('t', 'Plan'), rename: async (): Promise<void> => undefined,
  };
  return {
    requests,
    ports: { opener: async () => (request: ChatDocumentRequest): ChatDocument => { requests.push(request); return document; } },
  };
}

const target = (docId: string, seed: string | null): ChatDocumentTarget => ({ docId, title: 'Plan', selfCid: 1n, seed });

describe('a document tab', () => {
  it('opens a Citadel Docs document blank, or from what its creator typed', async () => {
    const { ports: p, requests } = ports();
    const opening: ChatDocumentOpening = await openChatDocumentTab(target('cdoc-1', null), p);
    await openChatDocumentTab(target('cdoc-2', 'Agenda'), p);
    expect(opening.kind).toBe('canvas');
    expect(requests.map((r) => r.origin)).toEqual([{ kind: 'blank' }, { kind: 'seeded', text: 'Agenda' }]);
  });

  it('refuses a document the earlier chat editor made, and opens nothing in its place', async () => {
    const { ports: p, requests } = ports();
    const opening: ChatDocumentOpening = await openChatDocumentTab(target('8b0c3a52-1f7e-4c55-9d1e-3f1c4a0e2b77', null), p);
    expect(opening).toEqual({ kind: 'unopened', reason: { kind: 'earlier-editor' } });
    expect(requests).toEqual([]);
  });

  it('says it did not load, never rejecting, when the editor does not load', async () => {
    const broken: OpeningPorts = { opener: () => Promise.reject(new Error('chunk failed')) };
    const opening: ChatDocumentOpening = await openChatDocumentTab(target('cdoc-1', null), broken);
    expect(opening).toEqual({ kind: 'unopened', reason: { kind: 'load-failed', message: 'chunk failed' } });
  });
});
