/**
 * The scratchpad's transport: the direct chat's messenger with the account's own cid as the
 * peer, minus everything that needs someone at the other end (lib/scratchpad).
 *
 * Real: the transport, its file port over the real blob store and SHA-256, the history wrapper,
 * and the chat-document keeper ports. Stood in: the messenger (a recorder of what the pane asks
 * it; the real one needs a WASM client), the agent's LocalDB (a Map), and the websocket service's
 * byte send, whose spy is the evidence that a scratchpad document sends nothing.
 */
import { describe, it, expect, afterEach, vi, type MockInstance } from 'vitest';
import type { SharedFile } from '@/lib/chat/attachments/shared-file';
import { createScratchpadTransport, notesHistory, scratchpadGate } from '../scratchpad-transport';
import { scratchpadBlobs } from '@/lib/scratchpad/scratchpad-blobs';
import { sha256Hex } from '@/lib/chat/attachments/attachment-wire';
import { chatKeeperPorts } from '@/lib/cdoc/chat/chat-app-ports';
import { websocketService } from '@/lib/websocket-service';
import type { P2PMessengerManager } from '@/lib/p2p/p2p-messenger-manager';
import type { SendMessageOptions } from '@/lib/p2p/message-sender-types';
import type { ChatMessage, ChatTransport, HistoryEvent, HistoryPort } from '../chat-transport';
import type { LocalDbPort } from '@/lib/cdoc/chat/chat-local-db';

const ME: bigint = 41n;
const BOB: bigint = 42n;
const picked: Map<string, Uint8Array> = new Map([['list.txt', new Uint8Array([1, 2, 3])]]);

interface Sent { to: bigint; content: string; options: SendMessageOptions | undefined }

function world(): { transport: ChatTransport; sent: Sent[] } {
  const sent: Sent[] = [];
  const messenger: P2PMessengerManager = {
    sendMessage: async (to: bigint, content: string, options?: SendMessageOptions) => { sent.push({ to, content, options }); options?.onOptimisticAppend?.(); },
  } as unknown as P2PMessengerManager;
  const rows: Map<string, Uint8Array> = new Map();
  const db: LocalDbPort = {
    get: async (_c: bigint, k: string) => { const v: Uint8Array | undefined = rows.get(k); if (v === undefined) throw new Error(`Key not found: ${k}`); return { value: v }; },
    set: async (_c: bigint, k: string, v: Uint8Array) => { rows.set(k, v); },
  };
  const transport: ChatTransport = createScratchpadTransport({
    messenger,
    self: { cid: ME, username: 'me', displayName: 'Me' },
    opening: { opener: async () => { throw new Error('not opened here'); } },
    blobs: scratchpadBlobs(ME, db, sha256Hex),
    // jsdom's File has no arrayBuffer(); the bytes the picker would hand over, by name.
    readFile: async (file: File) => picked.get(file.name) ?? new Uint8Array(),
    sendGate: scratchpadGate(ME),
  });
  return { transport, sent };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('the scratchpad transport', () => {
  it('is titled as a scratchpad and has no presence, typing, settings, read receipts or ticks', () => {
    const { transport } = world();
    expect(transport.kind).toBe('scratchpad');
    expect(transport.counterpart).toEqual({ name: 'Scratchpad', username: null, greeting: 'Your private scratchpad — notes, drafts and documents only you can see.', emptyHeading: null });
    expect([transport.status, transport.settings]).toEqual([null, null]);
    expect(transport.features).toMatchObject({ typing: false, presence: false, settings: false, readReceipts: false, deliveryTicks: false, securityLevel: false });
    expect(transport.features).toMatchObject({ markdown: true, revise: true, reactions: true, files: true, documents: true });
  });

  it('writes notes, edits and documents to the account\'s own conversation', async () => {
    const { transport, sent } = world();
    await transport.send.text({ content: 'buy oat milk', messageType: 'text', reply_to: null, onRecorded: () => undefined });
    await transport.documents?.invite({ docId: 'd1', title: 'Plan', onRecorded: () => undefined });
    expect(sent.map((s: Sent) => [s.to, s.content, s.options?.messageType])).toEqual([[ME, 'buy oat milk', 'text'], [ME, 'Created live document: Plan', 'live_document']]);
    expect(transport.documents?.sharedWith).toBe('Only you can see this document');
  });

  it('keeps a file on this device and notes it, then reads the same bytes back', async () => {
    const { transport, sent } = world();
    const file: File = new File([new Uint8Array([1, 2, 3])], 'list.txt', { type: 'text/plain' });
    await expect(transport.files?.send(file, () => undefined)).resolves.toEqual({ outcome: 'kept' });
    const kept: NonNullable<SendMessageOptions['attachments']>[number] | undefined = sent[0].options?.attachments?.[0];
    expect(sent[0].to).toBe(ME);
    expect(kept).toMatchObject({ file_name: 'list.txt', file_size: 3, file_type: 'text/plain' });
    const bytes: Uint8Array | undefined = await transport.files?.read?.({ id: kept?.file_id ?? '', name: 'list.txt', size: 3, mime: 'text/plain' });
    expect(Array.from(bytes ?? [])).toEqual([1, 2, 3]);
    expect(transport.files?.modes).toEqual(['device']);
  });

  it('shows a noted file on its card', async () => {
    const note: ChatMessage = { id: 'm1', content: 'list.txt', attachments: [{ file_id: 'f'.repeat(64), file_name: 'list.txt', file_size: 3, file_type: 'text/plain' }] } as unknown as ChatMessage;
    const events: HistoryEvent[] = [];
    let push: (e: HistoryEvent) => void = () => undefined;
    const inner: HistoryPort = { cached: (): ChatMessage[] => [note], subscribe: (l: (e: HistoryEvent) => void): (() => void) => { push = l; return () => undefined; } } as unknown as HistoryPort;
    const history: HistoryPort = notesHistory(inner);
    history.subscribe((e: HistoryEvent) => events.push(e));
    push({ kind: 'arrived', message: note, incoming: false } as HistoryEvent);
    const card: SharedFile = { id: 'f'.repeat(64), name: 'list.txt', size: 3, mime: 'text/plain' };
    expect(history.cached()[0].attachment).toEqual(card);
    expect((events[0] as { message: ChatMessage }).message.attachment).toEqual(card);
  });
});

describe('a scratchpad document', () => {
  it('sends nothing, where a direct chat\'s document sends to its peer', async () => {
    const bytes: MockInstance<typeof websocketService.sendP2PMessageBytes> = vi.spyOn(websocketService, 'sendP2PMessageBytes').mockResolvedValue(undefined);
    await chatKeeperPorts(ME, { cid: ME, name: 'Scratchpad', username: 'me' }).transport.send(new Uint8Array([1]));
    expect(bytes).not.toHaveBeenCalled();
    await chatKeeperPorts(ME, { cid: BOB, name: 'Bob', username: 'bob' }).transport.send(new Uint8Array([1]));
    expect(bytes).toHaveBeenCalledWith(ME, BOB, new Uint8Array([1]), 'background');
  });
});
