import { describe, it, expect } from 'vitest';

/**
 * Round-trip tests for `P2PCommandType.YjsP2PSync` — the CBOR wire
 * envelope that the Yjs collaborative-editor provider uses to ride
 * the same P2P command channel as the chat layer.
 *
 * Why this exists: PR #13 originally shipped the Yjs provider with
 * `JSON.stringify(message)` on the send side while the unified
 * receiver (`lib/p2p/message-handler.ts`) decoded with cbor-x — every
 * Yjs message logged "Failed to deserialize P2P command: Error:
 * JavaScript does not support arrays, maps, or strings with length
 * over 4294967295" and the integration test:live-doc never reached a
 * stable sync. These tests pin three things so the regression cannot
 * silently recur:
 *
 *   1. `serializeP2PCommand` → `deserializeP2PCommand` preserves the
 *      Yjs payload structure across CBOR encode/decode (including
 *      number arrays — the `data` field is a Uint8Array serialized as
 *      `number[]`, which is the exact shape the wire format uses).
 *   2. `isYjsSyncPayload` accepts every concrete `yjs_*` variant and
 *      rejects shapes that lack the `type` discriminator.
 *   3. The envelope discriminator (`P2PCommandType.YjsP2PSync`) is the
 *      single way to identify Yjs traffic — so the receiver's
 *      `handleP2PCommand` switch can dispatch on `command.type`
 *      without inspecting the payload shape first.
 */

import {
  P2PCommandType,
  serializeP2PCommand,
  deserializeP2PCommand,
  isYjsSyncPayload,
  type P2PCommand,
  type P2PYjsSyncPayload,
} from '../p2p-commands';

function makeYjsSyncCommand(payload: P2PYjsSyncPayload): P2PCommand {
  return { type: P2PCommandType.YjsP2PSync, payload };
}

describe('P2PCommandType.YjsP2PSync — CBOR round-trip', () => {
  it('preserves a yjs_sync (sync_step2) payload across encode/decode', () => {
    const original: P2PCommand = makeYjsSyncCommand({
      type: 'yjs_sync',
      sub_type: 'sync_step2',
      document_id: 'doc-42',
      data: [0x01, 0xCA, 0xFE, 0xBA, 0xBE], // wire shape of a Uint8Array
      doc_hash: '0123456789abcdef',
      revision: 7,
      message_id: 'msg-abc',
      requires_ack: true,
      is_creator: false,
    });

    const decoded: P2PCommand = deserializeP2PCommand(serializeP2PCommand(original));
    expect(decoded.type).toBe(P2PCommandType.YjsP2PSync);
    expect(decoded.payload).toEqual(original.payload);
  });

  it('preserves a yjs_awareness payload across encode/decode', () => {
    const original: P2PCommand = makeYjsSyncCommand({
      type: 'yjs_awareness',
      document_id: 'doc-42',
      awareness: [0xDE, 0xAD, 0xBE, 0xEF],
    });

    const decoded: P2PCommand = deserializeP2PCommand(serializeP2PCommand(original));
    expect(decoded.payload).toEqual(original.payload);
  });

  it('preserves a yjs_ack payload across encode/decode', () => {
    const original: P2PCommand = makeYjsSyncCommand({
      type: 'yjs_ack',
      document_id: 'doc-42',
      message_id: 'msg-abc',
      local_hash: '0123456789abcdef',
      revision: 8,
    });

    const decoded: P2PCommand = deserializeP2PCommand(serializeP2PCommand(original));
    expect(decoded.payload).toEqual(original.payload);
  });

  it('preserves a yjs_divergence payload (with optional diverged_chunks)', () => {
    const original: P2PCommand = makeYjsSyncCommand({
      type: 'yjs_divergence',
      document_id: 'doc-42',
      local_hash: 'aaaaaaaaaaaaaaaa',
      remote_hash: 'bbbbbbbbbbbbbbbb',
      diverged_chunks: [1, 3, 5],
      action: 'request_chunks',
    });

    const decoded: P2PCommand = deserializeP2PCommand(serializeP2PCommand(original));
    expect(decoded.payload).toEqual(original.payload);
  });
});

describe('isYjsSyncPayload', () => {
  it('accepts every yjs_* variant', () => {
    expect(isYjsSyncPayload({ type: 'yjs_sync', document_id: 'd', sub_type: 'update', data: [], message_id: 'x' })).toBe(true);
    expect(isYjsSyncPayload({ type: 'yjs_awareness', document_id: 'd', awareness: [] })).toBe(true);
    expect(isYjsSyncPayload({ type: 'yjs_ack', document_id: 'd', message_id: 'x', local_hash: '', revision: 0 })).toBe(true);
    expect(isYjsSyncPayload({ type: 'yjs_divergence', document_id: 'd', local_hash: '', remote_hash: '', action: 'full_resync' })).toBe(true);
  });

  it('rejects payloads without the type discriminator', () => {
    expect(isYjsSyncPayload({ document_id: 'd' })).toBe(false);
    expect(isYjsSyncPayload({})).toBe(false);
    expect(isYjsSyncPayload(null)).toBe(false);
    expect(isYjsSyncPayload(undefined)).toBe(false);
    expect(isYjsSyncPayload('yjs_sync')).toBe(false);
  });

  it('rejects payloads whose type is not a yjs_* prefix', () => {
    // A `MessagingLayerCommand` payload would have `layer`/`sender_cid`/etc
    // and (if it had a `type` at all) it would not start with `yjs_`. Pin
    // the discriminator strictness so a future generic command with an
    // unrelated `type: 'something'` field doesn't get misrouted.
    expect(isYjsSyncPayload({ type: 'text', message_id: 'x' })).toBe(false);
    expect(isYjsSyncPayload({ type: 'YJS_SYNC' })).toBe(false); // case-sensitive
    expect(isYjsSyncPayload({ type: '' })).toBe(false);
  });
});
