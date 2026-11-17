/**
 * What one keystroke costs on the wire, end to end, with the workspace protocol's JSON number
 * arrays. A MEASUREMENT, pinned so a change to the framing shows here; the binary framing is a
 * scheduled follow-up and this PR does not change the wire.
 *
 * The update is 22 bytes: cdoc-crdt's own budget for one keystroke's diff in a 1 MB document
 * (`crdt_diff_bytes/after_1_keystroke_in_1MB_doc`, bench/budgets.toml, tolerance 0). The
 * envelopes are written as serde_json writes them: the agent's WebSocket carries
 * `InternalServicePayload` as JSON text, and `message` is a `Vec<u8>`, so the workspace payload
 * (itself JSON, with the update as a number array) is a number array inside JSON again.
 */
import { describe, expect, it } from 'vitest';
import { encodeWorkspacePayload } from 'citadel-workspace-client-ts';

const UPDATE: number[] = Array.from({ length: 22 }, (_: unknown, i: number): number => (i * 37 + 200) % 256);
const AUTHOR: bigint = 18_170_202_856_123_884_154n;
const READER: bigint = 12_818_057_984_821_176_260n;
const NODE: string = '3f2a9c4e-7b1d-4e8a-9f6c-2d5b8a1e7c30';
const UUID: string = '6f1c2b9e-4d3a-4f7e-8b2c-9a0d1e2f3a4b';

const inner = (payload: Parameters<typeof encodeWorkspacePayload>[0]): number[] => Array.from(encodeWorkspacePayload(payload));
const bytes = (text: string): number => new TextEncoder().encode(text).byteLength;

describe('bytes per keystroke', () => {
  it('measures each hop of one 22-byte CRDT update', () => {
    const append: number[] = inner({ Request: { Documents: { Append: { node_id: NODE, doc_version: 2, update: UPDATE, client_seq: 4_294_967_296_123n } } } });
    const toAgent: number = bytes(`{"Request":{"Message":{"request_id":"${UUID}","message":[${append.join(',')}],"cid":${AUTHOR},"peer_cid":null,"security_level":"Standard"}}}`);
    const pushed: number[] = inner({ Response: { Documents: { DocumentUpdated: { node_id: NODE, seq: 1234n, doc_version: 2, update: UPDATE, author_cid: AUTHOR } } } });
    const toReader: number = bytes(`{"Response":{"MessageNotification":{"message":[${pushed.join(',')}],"cid":${READER},"peer_cid":0,"request_id":null}}}`);
    const acked: number[] = inner({ Response: { Documents: { Appended: { node_id: NODE, seq: 1234n, client_seq: 4_294_967_296_123n, compaction: null } } } });
    const ackToAuthor: number = bytes(`{"Response":{"MessageNotification":{"message":[${acked.join(',')}],"cid":${AUTHOR},"peer_cid":0,"request_id":null}}}`);

    const measured: Record<string, number> = {
      update: UPDATE.length,
      appendToServer: append.length,
      authorWebSocket: toAgent,
      pushFromServer: pushed.length,
      readerWebSocket: toReader,
      ackWebSocket: ackToAuthor,
    };
    console.info('bytes per keystroke', measured);
    // 22 bytes of update: 220 to the server (10x: the number array plus the request around it),
    // 881 on the author's socket (40x: that payload as a number array again), 922 to each reader,
    // and 610 back to the author as the acknowledgement.
    expect(measured).toEqual({ update: 22, appendToServer: 220, authorWebSocket: 881, pushFromServer: 248, readerWebSocket: 922, ackWebSocket: 610 });
  });
});
