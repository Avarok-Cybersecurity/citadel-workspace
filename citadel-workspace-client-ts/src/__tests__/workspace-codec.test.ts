/**
 * The workspace codec as the page uses it: the vendored Rust module (../codec), loaded from the
 * binary the page serves. What comes out has the shapes the generated types promise, and what
 * goes in is written as the JSON the kernel reads.
 */
import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  decodeWorkspacePayload,
  encodeWorkspacePayload,
  loadWorkspaceCodecFrom,
  WORKSPACE_CODEC_WASM_URL,
} from '../workspace-codec.js';
import type { WorkspaceProtocolPayload } from '../types/workspace-types.js';

const servedBinary = new URL(`../../../citadel-workspaces/public${WORKSPACE_CODEC_WASM_URL}`, import.meta.url);
const glue = new URL('../../codec/workspace_codec.js', import.meta.url);
before(async () => {
  await loadWorkspaceCodecFrom(fs.readFileSync(fileURLToPath(servedBinary)));
});

const text = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);
const json = (value: string): Uint8Array => new TextEncoder().encode(value);
// Account ids are random 63-bit values: a double rounds this one to an id nobody holds.
const PEER_CID = '7340187244936118791';

void test('the glue fetches the binary from the URL this module names', () => {
  assert.ok(fs.readFileSync(glue, 'utf8').includes(JSON.stringify(WORKSPACE_CODEC_WASM_URL)));
});

void test('a bigint is written as the exact JSON integer serde reads into u64', () => {
  const payload: WorkspaceProtocolPayload = {
    Request: { GetGroupMessages: { group_id: 'g', before_timestamp: BigInt('18446744073709551615'), limit: null } },
  };
  assert.equal(text(encodeWorkspacePayload(payload)), '{"Request":{"GetGroupMessages":{"group_id":"g","before_timestamp":18446744073709551615,"limit":null}}}');
});

void test('bytes go in as a Uint8Array and are written as the array of numbers serde reads', () => {
  const payload: WorkspaceProtocolPayload = {
    Request: { Documents: { Append: { node_id: 'n', doc_version: 1, update: new Uint8Array([0, 1, 255]), client_seq: BigInt(2) } } },
  };
  assert.equal(text(encodeWorkspacePayload(payload)), '{"Request":{"Documents":{"Append":{"node_id":"n","doc_version":1,"update":[0,1,255],"client_seq":2}}}}');
});

void test('u64 fields come back as exact bigints, bytes as a Uint8Array, other numbers as numbers', () => {
  const wire = `{"Response":{"Documents":{"DocumentUpdated":{"node_id":"n","seq":3,"doc_version":4,"update":[9,8,7],"author_cid":${PEER_CID}}}}}`;
  const payload = decodeWorkspacePayload(json(wire));
  assert.ok('Response' in payload);
  const response = payload.Response;
  assert.ok(typeof response === 'object' && 'Documents' in response);
  const documents = response.Documents;
  assert.ok('DocumentUpdated' in documents);
  const updated = documents.DocumentUpdated;
  assert.equal(updated.author_cid, BigInt(PEER_CID));
  assert.equal(updated.seq, BigInt(3));
  assert.equal(updated.doc_version, 4);
  assert.ok(ArrayBuffer.isView(updated.update));
  assert.deepEqual(Array.from(updated.update), [9, 8, 7]);
});

void test('None comes back as null and a map as a plain object, as JSON.parse gave them', () => {
  const wire = '{"Response":{"Members":{"domain_id":"d","members":[],"inherited_from":{"u1":"office-1"},"guests":[]}}}';
  const payload = decodeWorkspacePayload(json(wire)) as unknown as {
    Response: { Members: { inherited_from: Record<string, string> } };
  };
  assert.equal(Object.getPrototypeOf(payload.Response.Members.inherited_from), Object.prototype);
  assert.equal(payload.Response.Members.inherited_from.u1, 'office-1');
  const updates = decodeWorkspacePayload(json('{"Response":{"Documents":{"Updates":{"node_id":"n","snapshot":null,"updates":[],"has_more":false,"latest_seq":0}}}}')) as unknown as {
    Response: { Documents: { Updates: { snapshot: unknown } } };
  };
  assert.equal(updates.Response.Documents.Updates.snapshot, null);
});

void test('a peer CID survives encode then decode exactly', () => {
  const wire = `{"Response":{"Documents":{"DocumentAwareness":{"node_id":"n","from_cid":${PEER_CID},"payload":[]}}}}`;
  assert.equal(text(encodeWorkspacePayload(decodeWorkspacePayload(json(wire)))), wire);
});

void test('bytes that are not a workspace payload are refused, not cast', () => {
  for (const bad of [
    '{"Response":{"X":{"drain_seconds":1}}}',
    '{"Response":{"ServerShutdown":{"message":"bye","drain_seconds":1.5}}}',
    '{"Response":{"ServerShutdown":{"message":"bye"}}}',
    `{"Response":{"Documents":{"DocumentAwareness":{"node_id":"n","from_cid":${PEER_CID},"payload":"AAE="}}}}`,
    '{',
  ]) {
    assert.throws(() => decodeWorkspacePayload(json(bad)), /not a workspace payload/, bad);
  }
});

void test('a value that is not a workspace payload is refused before anything is sent', () => {
  const notOne = { Request: { GetGroupMessages: { group_id: 7 } } } as unknown as WorkspaceProtocolPayload;
  assert.throws(() => encodeWorkspacePayload(notOne), /not a workspace payload/);
});
