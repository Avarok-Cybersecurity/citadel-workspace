#!/usr/bin/env node
/**
 * Every batch-1116 contract fixture agrees with its schema and its known answers.
 *
 * `docs/contracts/batch-1116/` is what five implementation lanes build against at once (the
 * identity crate, the kernel, the tray host, the synchronized.work crates, the UI). A contract
 * that only a prose file states drifts the day two of them read it differently, and nobody sees
 * the drift until the parties exchange bytes. So the contracts are machine-checkable here:
 *
 *  - every `<name>.schema.json` validates `fixtures/<name>/valid-*.json` (must pass) and
 *    `fixtures/<name>/invalid-*.json` (must FAIL); a schema with `$defs` and matching fixture
 *    subdirectories validates each subdirectory against that definition. Every object in every
 *    schema is `additionalProperties: false`, so an unknown field is a refusal, as
 *    `deny_unknown_fields` makes it in the Rust types;
 *  - every `fixtures/sw-wire/*.json` CBOR fixture decodes canonically to its `model` and the
 *    model re-encodes to the same bytes; `invalid-*` fixtures must be refused;
 *  - every value in the `*-kat.json` files that Node can recompute from the seeds is recomputed
 *    (`scripts/lib/contracts/kat.mjs`), and the signed canonical CBOR of each signed JSON
 *    document is rebuilt from the fixture itself.
 *
 * A schema directory with no valid or no invalid fixture fails: a gate that judged nothing must
 * not report success. No dependencies: it runs in the dependency-free CI job.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './lib/contracts/schema.mjs';
import { decodeCanonical, encodeCanonical, hexToBytes, bytesToHex } from './lib/contracts/cbor.mjs';
import { checkIdentityKat, checkSignInKat, checkTrayKat, checkSwWireKat } from './lib/contracts/kat.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'docs/contracts/batch-1116');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readFixture = (relative) => readJson(join(DIR, relative));
const failures = [];
let fixtures = 0;
let katChecks = 0;

function judge(label, schemaRoot, schema, dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  const valid = files.filter((f) => f.startsWith('valid'));
  const invalid = files.filter((f) => f.startsWith('invalid'));
  if (valid.length === 0 || invalid.length === 0) failures.push(`${label}: needs at least one valid-*.json and one invalid-*.json fixture (has ${valid.length}/${invalid.length})`);
  for (const file of files) {
    if (!valid.includes(file) && !invalid.includes(file)) { failures.push(`${label}/${file}: fixture names start with valid- or invalid-`); continue; }
    fixtures++;
    const errors = validate(schemaRoot, schema, readJson(join(dir, file)));
    if (valid.includes(file) && errors.length > 0) failures.push(`${label}/${file} should validate:\n      ${errors.join('\n      ')}`);
    if (invalid.includes(file) && errors.length === 0) failures.push(`${label}/${file} should be refused and was accepted`);
  }
}

function schemas() {
  const names = readdirSync(DIR).filter((f) => f.endsWith('.schema.json')).sort();
  for (const file of names) {
    const name = file.slice(0, -'.schema.json'.length);
    const schema = readJson(join(DIR, file));
    const dir = join(DIR, 'fixtures', name);
    if (!existsSync(dir)) { failures.push(`${file}: no fixtures/${name}/ directory`); continue; }
    const subdirs = readdirSync(dir).filter((f) => statSync(join(dir, f)).isDirectory()).sort();
    if (subdirs.length === 0) { judge(name, schema, schema, dir); continue; }
    for (const def of subdirs) {
      if (!schema.$defs?.[def]) { failures.push(`fixtures/${name}/${def}/ names no $defs entry of ${file}`); continue; }
      judge(`${name}/${def}`, schema, { $ref: `#/$defs/${def}` }, join(dir, def));
    }
  }
  return names.length;
}

function swWire() {
  const dir = join(DIR, 'fixtures/sw-wire');
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let refused = 0;
  for (const file of files) {
    fixtures++;
    const fixture = readJson(join(dir, file));
    const shouldFail = file.startsWith('invalid-');
    try {
      const bytes = hexToBytes(fixture.cbor_hex);
      const decoded = decodeCanonical(bytes);
      if (JSON.stringify(decoded) !== JSON.stringify(fixture.model)) throw new Error('decodes to something other than its model');
      if (bytesToHex(encodeCanonical(fixture.model)) !== fixture.cbor_hex) throw new Error('the model does not re-encode to cbor_hex');
      if (typeof fixture.typ === 'number') {
        const top = Object.fromEntries(decoded.$map);
        if (top[1] !== fixture.typ) throw new Error(`SwMessage[1] is ${top[1]}, not typ ${fixture.typ}`);
        if ((2 in top) === (3 in top)) throw new Error('an SwMessage holds exactly one of slot 2 (unsigned) and slot 3 (signed)');
        if (3 in top) {
          const signed = Object.fromEntries(top[3].$map);
          const body = Object.fromEntries(decodeCanonical(hexToBytes(signed[3].$hex)).$map);
          if (body[1] !== fixture.typ) throw new Error(`Body[1] is ${body[1]}, not typ ${fixture.typ}`);
          if (hexToBytes(signed[4].$hex).length !== 3309 || hexToBytes(signed[2].$hex).length !== 32) throw new Error('sig or kid length');
        }
      }
      if (shouldFail) failures.push(`sw-wire/${file} should be refused and decoded cleanly`);
    } catch (error) {
      if (shouldFail) refused++;
      else failures.push(`sw-wire/${file}: ${error.message}`);
    }
  }
  if (refused === 0) failures.push('sw-wire: no invalid-*.json fixture was refused, so canonicality was not tested');
  return files.length;
}

function kats() {
  const identityKat = readFixture('identity-kat.json');
  const runs = [
    ['identity-kat.json', checkIdentityKat(identityKat, readFixture)],
    ['sign-in-kat.json', checkSignInKat(readFixture('sign-in-kat.json'), identityKat, readFixture)],
    ['tray-tab-kat.json', checkTrayKat(readFixture('tray-tab-kat.json'), readFixture)],
    ['sw-wire-kat.json', checkSwWireKat(readFixture('sw-wire-kat.json'), identityKat)],
  ];
  for (const [name, tally] of runs) {
    katChecks += tally.checks;
    for (const m of tally.mismatches) failures.push(`${name}: ${m}`);
  }
}

const schemaCount = schemas();
const wireCount = swWire();
kats();

if (failures.length > 0) {
  console.error(`\nbatch-1116 contracts: ${failures.length} problem(s)\n\n  - ${failures.join('\n  - ')}\n`);
  process.exit(1);
}
console.log(`batch-1116 contracts: ${schemaCount} schema(s), ${fixtures} fixture(s) judged (${wireCount} CBOR), ${katChecks} known-answer value(s) recomputed and matched.`);
