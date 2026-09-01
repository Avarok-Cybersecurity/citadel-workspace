import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  WORKSPACE_BIGINT_FIELDS,
  decodeWorkspacePayload,
  encodeWorkspacePayload,
} from '../workspace-json.js';
import type { WorkspaceProtocolPayload } from '../types/workspace-types.js';

// A request exactly as the generated signature demands it: GetGroupMessages
// declares `before_timestamp: bigint | null`.
const paginationRequest: WorkspaceProtocolPayload = {
  Request: {
    GetGroupMessages: {
      group_id: 'group-1',
      before_timestamp: BigInt(1712345678901),
      limit: 50,
    },
  },
};

void test('DEFECT C (request): a payload holding the bigint the signature asks for encodes without throwing', () => {
  const bytes = encodeWorkspacePayload(paginationRequest);
  const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
    Request: { GetGroupMessages: { before_timestamp: number; limit: number } };
  };
  // On the wire it must be a JSON number — that is what serde_json's u64 expects.
  assert.equal(decoded.Request.GetGroupMessages.before_timestamp, 1712345678901);
  assert.equal(typeof decoded.Request.GetGroupMessages.before_timestamp, 'number');
  assert.equal(decoded.Request.GetGroupMessages.limit, 50);
});

void test('DEFECT C (request): the defect was real — bare JSON.stringify throws on the same payload', () => {
  // This is the exact failure any caller hit before the codec existed:
  // JSON.stringify cannot serialize BigInt and throws before anything is sent.
  assert.throws(() => JSON.stringify(paginationRequest), TypeError);
});

void test('encode fails fast on a bigint that cannot survive the JSON transport', () => {
  const payload = {
    Request: {
      GetGroupMessages: {
        group_id: 'g',
        before_timestamp: BigInt('18446744073709551615'), // u64::MAX
        limit: null,
      },
    },
  } as unknown as WorkspaceProtocolPayload;
  assert.throws(() => encodeWorkspacePayload(payload), RangeError);
});

void test('DEFECT C (response): declared-bigint fields decode as bigint, everything else untouched', () => {
  const wire = JSON.stringify({
    Response: {
      GroupMessages: {
        group_id: 'group-1',
        has_more: false,
        messages: [
          {
            id: 'm1',
            timestamp: 1712345678901,
            edited_at: null,
            content: 'hi',
          },
        ],
      },
    },
  });
  const payload = decodeWorkspacePayload(wire) as {
    Response: {
      GroupMessages: {
        group_id: string;
        has_more: boolean;
        messages: Array<{ id: string; timestamp: bigint; edited_at: null; content: string }>;
      };
    };
  };
  const message = payload.Response.GroupMessages.messages[0];
  // Without the reviver this was a plain number, so `=== 1712345678901n`
  // comparisons downstream silently failed.
  assert.equal(typeof message.timestamp, 'bigint');
  assert.equal(message.timestamp, BigInt(1712345678901));
  assert.equal(message.edited_at, null);
  assert.equal(payload.Response.GroupMessages.has_more, false);
  assert.equal(typeof payload.Response.GroupMessages.group_id, 'string');
});

void test('decode accepts number[], Uint8Array and string inputs identically', () => {
  const wire = JSON.stringify({ Response: { ServerShutdown: { message: 'bye', drain_seconds: 30 } } });
  const asBytes = Array.from(new TextEncoder().encode(wire));
  for (const input of [wire, new Uint8Array(asBytes), asBytes] as const) {
    const payload = decodeWorkspacePayload(input) as {
      Response: { ServerShutdown: { drain_seconds: bigint } };
    };
    assert.equal(payload.Response.ServerShutdown.drain_seconds, BigInt(30));
  }
});

void test('decode fails fast on an unsafe integer in a declared-bigint field', () => {
  // 2^60 has already lost precision inside JSON.parse; silently returning a
  // wrong bigint would be corruption, so the codec throws instead.
  const wire = '{"Response":{"ServerShutdown":{"message":"x","drain_seconds":1152921504606846976}}}';
  assert.throws(() => decodeWorkspacePayload(wire), RangeError);
});

void test('SSOT: WORKSPACE_BIGINT_FIELDS matches the generated workspace types exactly', () => {
  // The runtime field set shadows the generated types (which must not be
  // hand-edited). Re-derive the set from the generated sources so a type
  // regeneration that adds/removes/renames a bigint field fails this test
  // instead of silently desynchronizing the codec.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const generatedDir = path.resolve(here, '../../src/types/generated');
  const derived = new Set<string>();
  for (const file of fs.readdirSync(generatedDir)) {
    if (!file.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(generatedDir, file), 'utf8');
    for (const match of source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*bigint/g)) {
      derived.add(match[1]);
    }
  }
  assert.deepEqual(
    Array.from(derived).sort(),
    Array.from(WORKSPACE_BIGINT_FIELDS).sort()
  );
});
