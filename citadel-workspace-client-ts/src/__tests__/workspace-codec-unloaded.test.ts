/**
 * Before the codec is loaded it refuses to work, instead of guessing at a JSON shape. Its own
 * file: node --test runs each file in its own process, so nothing has loaded the codec here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeWorkspacePayload, encodeWorkspacePayload } from '../workspace-codec.js';

void test('encode and decode throw until the codec is loaded', () => {
  assert.throws(() => encodeWorkspacePayload('ListWorkspaces' as never), /not loaded/);
  assert.throws(() => decodeWorkspacePayload(new TextEncoder().encode('{"Response":{"Success":"ok"}}')), /not loaded/);
});
