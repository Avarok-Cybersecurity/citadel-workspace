/**
 * The rules of check-no-hand-copies-of-generated-types, on small sources: each copy shape it must
 * refuse, and each derivation it must accept. Run: node --test scripts/lib/hand-copy-scan.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { declarationsOf, findHandCopies } from './hand-copy-scan.mjs';

const ts = createRequire(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'))('typescript');

const GENERATED = `
export type ServerReconnected = { cid: bigint, attempt: number, server_address: string, request_id: string | null, };
export type ChatSecurityLevel = "Standard" | "Reinforced" | "High" | "Extreme";
export type Answer = { "Created": { id: string, name: string, owner: string, } } | "Gone";
`;

function scan(hand, { allow = new Map(), scope = null, path = 'src/a.ts' } = {}) {
  const generated = declarationsOf(ts, 'gen/Types.ts', GENERATED).map((d) => ({ ...d, scope }));
  return findHandCopies(generated, declarationsOf(ts, path, hand), allow).map((f) => `${f.name}:${f.rule}`);
}

test('a declaration that takes a generated name is a copy', () => {
  assert.deepEqual(scan('export interface ServerReconnected { cid: bigint; attempt: number }'), ['ServerReconnected:same-name']);
});

test('restating most of a generated shape under another name is a copy', () => {
  assert.deepEqual(scan('interface Back { cid: bigint; attempt: number; server_address: string }'), ['Back:shape']);
});

test('restating a tagged variant\'s body is a copy of that variant', () => {
  assert.deepEqual(scan('type Made = { id: string; name: string; owner: string }'), ['Made:shape']);
});

test('a literal union or a string list of an enum\'s variants is a copy', () => {
  assert.deepEqual(scan("type Level = 'Standard' | 'Reinforced' | 'High' | 'Extreme';"), ['Level:variants']);
  assert.deepEqual(scan("const LEVELS: readonly string[] = ['Standard', 'High', 'Extreme'];"), ['LEVELS:variants']);
});

test('an untyped object of a generated type\'s field names is a copy', () => {
  assert.deepEqual(scan("const made = { id: 'a', name: 'b', owner: 'c' };"), ['made:untyped-fields']);
});

test('a view derived from the generated type is not a copy', () => {
  const hand = `
    import type { ServerReconnected as Wire, ChatSecurityLevel } from 'gen';
    type Back = Pick<Wire, 'cid' | 'attempt' | 'server_address'>;
    type Level = Extract<ChatSecurityLevel, 'Standard' | 'High' | 'Extreme'>;
    const LEVELS: readonly ChatSecurityLevel[] = ['Standard', 'High', 'Extreme'];
    const back: Wire = { attempt: 1, server_address: 'a', cid: 1n, request_id: null };
  `;
  assert.deepEqual(scan(hand), []);
});

test('an alias of an alias of a generated type is derived too', () => {
  assert.deepEqual(scan('type A = Pick<ServerReconnected, "cid" | "attempt">; type B = A & { server_address: string; x: 1 };'), []);
});

test('a scoped generated type is invisible outside its scope', () => {
  const hand = 'interface ServerReconnected { cid: bigint; attempt: number; server_address: string }';
  assert.deepEqual(scan(hand, { scope: ['apps/'], path: 'src/a.ts' }), []);
  assert.deepEqual(scan(hand, { scope: ['apps/'], path: 'apps/x/a.ts' }), ['ServerReconnected:same-name']);
});

test('an allowed declaration is skipped, and a global augmentation is never examined', () => {
  const allow = new Map([['src/a.ts#Back', 'a reason']]);
  assert.deepEqual(scan('interface Back { cid: bigint; attempt: number; server_address: string }', { allow }), []);
  assert.deepEqual(scan('declare global { interface ServerReconnected { cid: bigint } }'), []);
});

test('field names that merely overlap a few envelope fields are not a copy', () => {
  assert.deepEqual(scan('interface Row { cid: bigint; request_id: string; label: string; colour: string }'), []);
});
