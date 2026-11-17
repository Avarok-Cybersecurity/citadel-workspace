/**
 * The one table of which reliable payload is sent with which compression hint.
 *
 * Pure: no stand-ins. The expected values are written out rather than read
 * from the module, so a changed row fails here instead of agreeing with itself.
 */
import { describe, it, expect } from 'vitest';
import { compressionHintFor, isCompressionHint } from '../compression-hints';
import {
  P2PCommandType,
  createMessagingLayerCommand,
  createMessageAckCommand,
  type P2PCommand,
  type P2PYjsSyncPayload,
  type CallSignalPayload,
} from '@/types/p2p-commands';
import {
  MessagingLayerType,
  createMessage,
  createTyping,
  createCheckState,
  createFileTransferResponse,
  type MessagingLayer,
} from '@/types/messaging-layer';
import type { RevfsOperation } from '@/types/revfs-types';

const A: bigint = 1n;
const B: bigint = 2n;

function layered(layer: MessagingLayer): P2PCommand {
  return createMessagingLayerCommand(layer, A, B, 0);
}

describe('the compression hint a payload is sent with', () => {
  it('is cbor-command for chat, typing, control and acknowledgement commands', () => {
    expect(compressionHintFor(layered(createMessage('hello')))).toBe('cbor-command');
    expect(compressionHintFor(layered(createTyping()))).toBe('cbor-command');
    expect(compressionHintFor(layered(createCheckState()))).toBe('cbor-command');
    expect(compressionHintFor(layered(createFileTransferResponse('t', true)))).toBe('cbor-command');
    expect(compressionHintFor(createMessageAckCommand('m', 'read'))).toBe('cbor-command');
    const call: P2PCommand = { type: P2PCommandType.CallSignal, payload: {} as CallSignalPayload };
    expect(compressionHintFor(call)).toBe('cbor-command');
  });

  it('is yjs-update for live-document sync and awareness', () => {
    for (const type of ['yjs_sync', 'yjs_awareness']) {
      const sync: P2PCommand = { type: P2PCommandType.YjsP2PSync, payload: { type } as P2PYjsSyncPayload };
      expect(compressionHintFor(sync)).toBe('yjs-update');
    }
  });

  it('is json for RE-VFS tree operations, which carry paths, metadata and tree snapshots', () => {
    const operation: RevfsOperation = { op_id: 'o', op_type: 'SyncResponse', path: '/', timestamp: 1 } as RevfsOperation;
    const layer: MessagingLayer = { type: MessagingLayerType.RevfsOperation, operation } as MessagingLayer;
    expect(compressionHintFor(layered(layer))).toBe('json');
  });

  it('is opaque for file bytes, whichever envelope carries them', () => {
    const chunkLayer: MessagingLayer = { type: MessagingLayerType.FileTransferChunk } as MessagingLayer;
    expect(compressionHintFor(layered(chunkLayer))).toBe('opaque');
    const chunk: P2PCommand = { type: P2PCommandType.FileTransferChunk, payload: {} as P2PCommand['payload'] };
    expect(compressionHintFor(chunk)).toBe('opaque');
  });

  it('is absent for a layered command whose payload is not a messaging layer', () => {
    const odd: P2PCommand = { type: P2PCommandType.MessagingLayerCommand, payload: {} as P2PCommand['payload'] };
    expect(compressionHintFor(odd)).toBeUndefined();
  });
});

describe('a compression hint that crossed a tab boundary', () => {
  it('is accepted when it is one the WASM client knows', () => {
    for (const hint of ['opaque', 'text', 'json', 'yjs-update', 'cbor-command']) {
      expect(isCompressionHint(hint)).toBe(true);
    }
  });

  it('is refused otherwise, including inherited property names', () => {
    for (const value of ['zstd', '', 'JSON', 'toString', '__proto__', undefined, null, 1, {}]) {
      expect(isCompressionHint(value)).toBe(false);
    }
  });
});
