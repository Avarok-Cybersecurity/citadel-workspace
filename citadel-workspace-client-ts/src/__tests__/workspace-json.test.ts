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

void test('encode writes a bigint above 2^53 as the exact integer serde reads into u64', () => {
  const payload = {
    Request: {
      GetGroupMessages: {
        group_id: 'g',
        before_timestamp: BigInt('18446744073709551615'), // u64::MAX
        limit: null,
      },
    },
  } as unknown as WorkspaceProtocolPayload;
  const text = new TextDecoder().decode(encodeWorkspacePayload(payload));
  assert.equal(text, '{"Request":{"GetGroupMessages":{"group_id":"g","before_timestamp":18446744073709551615,"limit":null}}}');
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

// Account ids are random 63-bit values (citadel_crypt entropy_bank: gen::<u64>() >> 1).
const PEER_CID = '7340187244936118791';

void test('a peer CID above 2^53 decodes to its exact value', () => {
  // A double rounds this id to 7340187244936118784, which names no account.
  const wire = `{"Response":{"Telemetry":{"entries":[{"peer_cid":${PEER_CID},"message":"x"}]}}}`;
  const payload = decodeWorkspacePayload(wire) as unknown as {
    Response: { Telemetry: { entries: Array<{ peer_cid: bigint; message: string }> } };
  };
  assert.equal(payload.Response.Telemetry.entries[0].peer_cid, BigInt(PEER_CID));
});

void test('a peer CID survives encode then decode exactly', () => {
  const request = { Request: { Telemetry: { ListTelemetry: { filter: { peer_cid: BigInt(PEER_CID) } } } } };
  const bytes = encodeWorkspacePayload(request as unknown as WorkspaceProtocolPayload);
  const back = decodeWorkspacePayload(bytes) as unknown as typeof request;
  assert.equal(back.Request.Telemetry.ListTelemetry.filter.peer_cid, BigInt(PEER_CID));
});

void test('digits and marker-like text inside strings are left alone', () => {
  const message = `cid ${PEER_CID} said "u64:00:${PEER_CID}" \\ done`;
  const bytes = encodeWorkspacePayload({ Request: { Note: { message, peer_cid: BigInt(PEER_CID) } } } as unknown as WorkspaceProtocolPayload);
  const back = decodeWorkspacePayload(bytes) as unknown as { Request: { Note: { message: string; peer_cid: bigint } } };
  assert.equal(back.Request.Note.message, message);
  assert.equal(back.Request.Note.peer_cid, BigInt(PEER_CID));
});

void test('decode fails fast on an unsafe integer in a field that is not u64', () => {
  // Returning it as a number would hand back a silently rounded value.
  const wire = `{"Response":{"Other":{"count":${PEER_CID}}}}`;
  assert.throws(() => decodeWorkspacePayload(wire), RangeError);
});

void test('decode fails fast on a fraction in a u64 field', () => {
  assert.throws(() => decodeWorkspacePayload('{"Response":{"X":{"drain_seconds":1.5}}}'), RangeError);
});

void test('floats and exponents outside u64 fields are untouched', () => {
  const back = decodeWorkspacePayload('{"Response":{"X":{"ratio":-1.25e+30,"n":-3}}}') as unknown as {
    Response: { X: { ratio: number; n: number } };
  };
  assert.equal(back.Response.X.ratio, -1.25e30);
  assert.equal(back.Response.X.n, -3);
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

void test('no field name is bigint in one generated type and something else in another', () => {
  // The decoder converts by field NAME, wherever it appears. A name that is a u64 in one type and
  // an array in another makes every message carrying the array fail to decode: a document
  // refusal's size was once `bytes: bigint` beside a snapshot's `bytes: Array<number>`.
  const here = path.dirname(fileURLToPath(import.meta.url));
  const generatedDir = path.resolve(here, '../../src/types/generated');
  const kinds = new Map<string, Set<string>>();
  for (const file of fs.readdirSync(generatedDir)) {
    if (!file.endsWith('.ts')) continue;
    const source = fs.readFileSync(path.join(generatedDir, file), 'utf8');
    for (const match of source.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^,}]+)/g)) {
      if (!WORKSPACE_BIGINT_FIELDS.has(match[1])) continue;
      const kind = match[2].trim().startsWith('bigint') ? 'bigint' : match[2].trim();
      kinds.set(match[1], (kinds.get(match[1]) ?? new Set<string>()).add(kind));
    }
  }
  const mixed = [...kinds].filter(([, seen]) => seen.size > 1).map(([name, seen]) => `${name}: ${[...seen].join(' | ')}`);
  assert.ok(kinds.size > 0, 'no bigint field was found, so nothing was checked');
  assert.deepEqual(mixed, []);
});
