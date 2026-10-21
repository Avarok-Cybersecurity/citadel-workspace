/**
 * The catalogue gate's checks, each refusal beside its control: the repository's catalogue reads;
 * a refused entry, a second entry for an id and a signature that does not verify are problems;
 * a module that imports a group nothing declared opens, imports outside the ABI, or does not
 * match its hash is a problem, and one importing only what it declared (or intrinsic groups) is not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCatalogueRules } from './app-catalogue-rules.mjs';
import { checkCatalogue, readAbiConstants } from './app-catalogue.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = JSON.parse(readFileSync(join(ROOT, 'apps/catalogue/fixtures/manifest-cases.json'), 'utf8')).base;
const rules = await loadCatalogueRules();

/** The generated constants' shape, cut to what the check reads. */
const ABI_TEXT = `export const ABI_NAMESPACE = "citadel_app_abi_1" as const;
export const INTRINSIC_CAPABILITIES = ["canvas", "ui", "events", "navigate", "log"] as const satisfies readonly Capability[];
export const CAPABILITY_GROUP: Readonly<Record<Capability, Group>> = {
  "canvas": "canvas", "ui": "ui", "events": "events", "navigate": "navigate", "log": "log",
  "nodes.read": "nodes", "storage.user": "storage", "net.server": "net", "ihttp.serve": "ihttp", "ihttp.call": "ihttp", "chat.send": "chat",
};`;
const abi = readAbiConstants(ABI_TEXT);

/** A minimal module importing each `[module, name]` as `(i32, i32, i32) -> i32`. */
function wasmImporting(imports) {
  const str = (s) => [s.length, ...Buffer.from(s)];
  const section = (id, body) => [id, body.length, ...body];
  const type = [1, 0x60, 3, 0x7f, 0x7f, 0x7f, 1, 0x7f];
  const entries = imports.flatMap(([m, n]) => [...str(m), ...str(n), 0x00, 0]);
  return Uint8Array.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0, ...section(1, type), ...section(2, [imports.length, ...entries])]);
}

function entry(changes = {}, over = {}) {
  const m = { ...structuredClone(BASE), ...changes };
  if (changes.version !== undefined) delete m.previous_versions;
  const bytes = Buffer.from(JSON.stringify(m));
  return { id: m.id, version: m.version, manifest_url: 'https://acme.example/m.json', manifest_base64: bytes.toString('base64'), signature: 'a'.repeat(6618), ...over };
}
const file = (entries) => JSON.stringify({ format: 1, catalogue_version: 2, entries });
const run = (text, io = {}) => checkCatalogue(text, { rules, verifySignature: () => 'unchecked', artifactFor: () => null, abi, ...io });
const withModule = (bytes, caps) => {
  const sha = createHash('sha256').update(bytes).digest('hex');
  return run(file([entry({ capabilities: caps, artifact: { ...BASE.artifact, sha256: sha } })]), { artifactFor: () => bytes });
};
const cap = (name) => ({ cap: name, why: `Needs ${name}`, optional: false });

test('the repository catalogue reads, examining what it holds', () => {
  const r = run(readFileSync(join(ROOT, 'apps/catalogue/catalogue.json'), 'utf8'));
  assert.deepEqual(r.problems, []);
});

test('a valid entry has no problem; control for the refusals below', () => {
  const r = run(file([entry()]));
  assert.deepEqual(r.problems, []);
  assert.equal(r.entries, 1);
  assert.equal(r.signatures.unchecked, 1);
  assert.equal(r.modules.notToHand, 1);
});

test('an entry the manifest rules refuse is a problem', () => {
  assert.match(run(file([entry({ id: 'Kanban' }, { id: 'Kanban' })])).problems[0], /the manifest is refused/);
});

test('a second entry for an id is a problem', () => {
  assert.match(run(file([entry(), entry()])).problems.join('\n'), /a second entry for this id/);
});

test('a file that is not a catalogue is refused whole', () => {
  assert.match(run('{"format":2}').problems[0], /the catalogue is refused/);
});

test('a signature the verifier refuses is a problem; control: one it accepts is counted', () => {
  assert.match(run(file([entry()]), { verifySignature: () => 'invalid' }).problems[0], /signature does not verify/);
  const ok = run(file([entry()]), { verifySignature: () => 'valid' });
  assert.deepEqual([ok.problems, ok.signatures.valid], [[], 1]);
  assert.throws(() => run(file([entry()]), { verifySignature: () => true }), /a signature verifier answered/);
});

test('a module importing a group its manifest does not open is a problem; control: declared, it is not', () => {
  const bytes = wasmImporting([['citadel_app_abi_1', 'chat']]);
  assert.match(withModule(bytes, [cap('canvas')]).problems[0], /imports the "chat" group but declares no capability that opens it/);
  const declared = withModule(bytes, [cap('canvas'), cap('chat.send')]);
  assert.deepEqual([declared.problems, declared.modules.checked], [[], 1]);
});

test('intrinsic groups and the reply functions need no declaration', () => {
  const bytes = wasmImporting([['citadel_app_abi_1', 'ui'], ['citadel_app_abi_1', 'log'], ['citadel_app_abi_1', 'reply_len']]);
  assert.deepEqual(withModule(bytes, [cap('nodes.read')]).problems, []);
});

test('an import outside the ABI, or of no group, is a problem', () => {
  assert.match(withModule(wasmImporting([['env', 'fetch']]), [cap('canvas')]).problems[0], /outside citadel_app_abi_1/);
  assert.match(withModule(wasmImporting([['citadel_app_abi_1', 'sockets']]), [cap('canvas')]).problems[0], /not an ABI group/);
});

test('a module that does not hash to its manifest is a problem', () => {
  const r = run(file([entry({ capabilities: [cap('canvas')] })]), { artifactFor: () => wasmImporting([]) });
  assert.match(r.problems[0], /the module hashes to/);
});

test('the ABI constants are read from the generated text; control: text without them is null', () => {
  assert.deepEqual(abi.intrinsic, ['canvas', 'ui', 'events', 'navigate', 'log']);
  assert.equal(abi.capabilityGroup['chat.send'], 'chat');
  assert.equal(readAbiConstants('export const OTHER = 1;'), null);
});
