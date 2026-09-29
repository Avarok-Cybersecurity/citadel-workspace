import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WorkspaceClient } from '../WorkspaceClient.js';
import type { CompressionHint } from '../compression-hint.js';
import type { WasmModule } from 'citadel-internal-service-wasm-client';

type ReliableCall = [string, string, Uint8Array, string | null | undefined, string | null | undefined];

/**
 * SBIO: the WASM module is the I/O boundary (it owns the WebSocket). This
 * subclass installs a recorder in its place so the real
 * sendP2PMessageReliable runs and the test reads exactly what reached WASM.
 */
class RecordingClient extends WorkspaceClient {
  public calls: ReliableCall[] = [];

  constructor() {
    super({ websocketUrl: 'ws://test-not-connected' });
    const calls: ReliableCall[] = this.calls;
    this.wasmModule = {
      send_p2p_message_reliable: async (...args: ReliableCall): Promise<void> => {
        calls.push(args);
      },
    } as unknown as WasmModule;
  }
}

const BYTES = new Uint8Array([1, 2, 3]);

void test('a compression hint reaches the WASM call as its fifth argument', async () => {
  const client = new RecordingClient();
  const hint: CompressionHint = 'yjs-update';
  await client.sendP2PMessageReliable('1', '2', BYTES, 'High', hint);
  assert.deepEqual(client.calls, [['1', '2', BYTES, 'High', 'yjs-update']]);
});

void test('without a hint the WASM call receives null, which means no compression', async () => {
  const client = new RecordingClient();
  await client.sendP2PMessageReliable('1', '2', BYTES);
  assert.deepEqual(client.calls, [['1', '2', BYTES, null, null]]);
});

void test('a hint without a security level still arrives, and the level stays null', async () => {
  const client = new RecordingClient();
  await client.sendP2PMessageReliable('1', '2', BYTES, undefined, 'cbor-command');
  assert.deepEqual(client.calls, [['1', '2', BYTES, null, 'cbor-command']]);
});
