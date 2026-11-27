/**
 * A request named for pairing, and the pairing frame, through the codec the page loads: with no
 * id the bytes are the codec's own, with one the id goes in front of the payload's first key, and
 * the codec reads the kernel's pairing frame and the capability that turns pairing on.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodeWorkspacePayload,
  encodeWorkspacePayload,
  encodeWorkspaceRequest,
  loadWorkspaceCodecFrom,
  WORKSPACE_CODEC_WASM_URL,
} from '../workspace-codec.js';
import type { WorkspaceProtocolRequest } from '../types/workspace-types.js';

const servedBinary = new URL(`../../../citadel-workspaces/public${WORKSPACE_CODEC_WASM_URL}`, import.meta.url);
before(async () => {
  await loadWorkspaceCodecFrom(fs.readFileSync(fileURLToPath(servedBinary)));
});

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const json = (value: string): Uint8Array => new TextEncoder().encode(value);
const DELETE: WorkspaceProtocolRequest = { DeleteNode: { node_id: 'n1', cascade: false } };
const U64_MAX: bigint = BigInt('18446744073709551615');
const DIGEST: string = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

void test('without an id, a request is the bytes the codec writes for its payload', () => {
  assert.deepEqual(encodeWorkspaceRequest(DELETE, null), encodeWorkspacePayload({ Request: DELETE }));
});

void test('with an id, the frame names it exactly in front of the payload', () => {
  assert.equal(text(encodeWorkspaceRequest(DELETE, U64_MAX)), `{"request_id":${U64_MAX},"Request":{"DeleteNode":{"node_id":"n1","cascade":false}}}`);
  assert.equal(text(encodeWorkspaceRequest('GetServerCapabilities', BigInt(7))), '{"request_id":7,"Request":"GetServerCapabilities"}');
});

void test('an id outside u64 is refused, not written', () => {
  assert.throws(() => encodeWorkspaceRequest(DELETE, BigInt(-1)), RangeError);
  assert.throws(() => encodeWorkspaceRequest(DELETE, U64_MAX + BigInt(1)), RangeError);
});

void test('the kernel’s pairing frame reads, its id an exact bigint', () => {
  const payload = decodeWorkspacePayload(json(`{"Response":{"Answered":{"request_id":${U64_MAX},"digest":"${DIGEST}"}}}`));
  assert.ok('Response' in payload);
  const response = payload.Response;
  assert.ok(typeof response === 'object' && 'Answered' in response);
  assert.equal(response.Answered.request_id, U64_MAX);
  assert.equal(response.Answered.digest, DIGEST);
});

void test('a kernel that pairs says so in its capabilities; one that does not leaves the field out', () => {
  const caps = (wire: string): unknown => {
    const payload = decodeWorkspacePayload(json(wire));
    assert.ok('Response' in payload && typeof payload.Response === 'object' && 'ServerCapabilities' in payload.Response);
    return payload.Response.ServerCapabilities.request_ids;
  };
  const base = '"allow_server_file_transfer":true,"allow_server_revfs_storage":true,"max_file_transfer_size_mb":10,"revfs_storage_quota_mb":10';
  assert.equal(caps(`{"Response":{"ServerCapabilities":{${base},"request_ids":true}}}`), true);
  assert.equal(caps(`{"Response":{"ServerCapabilities":{${base}}}}`), undefined);
});
