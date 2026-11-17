/**
 * A Documents answer's bytes are the document's content and its readers' cursors. The debug
 * log shows their lengths and the seqs, never the bytes.
 */
import { inspect } from 'node:util';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { encodeWorkspacePayload, type DocumentsResponse } from 'citadel-workspace-client-ts';
import { eventEmitter } from '@/lib/event-emitter';
import '@/lib/workspace-response-handler';

const CID: bigint = 18_170_202_856_123_884_154n;
// Distinctive values: 211, 223 and 227 appear nowhere else in these messages.
const CONTENT: number[] = [211, 223, 227, 211, 223, 227];

function logged(response: DocumentsResponse): string {
  const lines: string[] = [];
  const spy: ReturnType<typeof vi.spyOn> = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]): void => {
    lines.push(args.map((a: unknown): string => inspect(a, { depth: 10 })).join(' '));
  });
  const message: number[] = Array.from(encodeWorkspacePayload({ Response: { Documents: response } }));
  eventEmitter.emit('websocket-message', { MessageNotification: { message, cid: CID, peer_cid: 0n, request_id: null } });
  spy.mockRestore();
  return lines.join('\n');
}

afterEach((): void => { vi.restoreAllMocks(); });

describe('the debug log of a Documents answer', () => {
  it('names the update by length and seq, never by its bytes', () => {
    const log: string = logged({ DocumentUpdated: { node_id: 'n1', seq: 77n, doc_version: 2, update: CONTENT, author_cid: 5n } });
    expect(log).toContain('DocumentUpdated');
    expect(log).toContain('<6 bytes>');
    expect(log).toContain('77');
    expect(log).not.toMatch(/211|223|227/);
  });

  it('keeps an awareness record out too, envelope included', () => {
    const log: string = logged({ DocumentAwareness: { node_id: 'n1', from_cid: 5n, payload: CONTENT } });
    expect(log).toContain('DocumentAwareness');
    expect(log).not.toMatch(/211|223|227/);
  });

  it('keeps a pulled page\'s snapshot and updates out', () => {
    const log: string = logged({ Updates: { node_id: 'n1', snapshot: { doc_version: 2, bytes: CONTENT, upto_seq: 3n }, updates: [{ seq: 4n, doc_version: 2, update: CONTENT, author_cid: 5n }], has_more: false, latest_seq: 4n } });
    expect(log).toContain('Updates');
    expect(log).not.toMatch(/211|223|227/);
  });
});
