#!/usr/bin/env node
/**
 * Fails if the UI reads a storage key nothing ever writes.
 *
 * Three real defects in one session shared this exact signature, all in the
 * chat settings panel, all invisible to every other check because the code RAN
 * correctly — it just operated on nothing:
 *
 *   `chat-history:{cid}`   "Clear Chat History" removed a key that has never
 *                          existed, under a dialog promising the messages were
 *                          gone. Nothing was deleted.
 *   `p2p-messages:{cid}`   the Stats tab rendered "0 Messages" for every
 *   `file-transfers:{cid}` conversation, however long, from the same fiction.
 *
 * Each appeared exactly once in the whole repository — in the read itself.
 * Neither TypeScript, ESLint, axe nor any spec can see that: the call is valid,
 * the fallback is reasonable, and the UI renders a confident answer.
 *
 * A key that is written but never read is NOT reported: writing state for a
 * future reader, or for another tool to consume, is legitimate. The asymmetry
 * is the point — a read with no writer always returns the default, so the
 * feature is inert.
 *
 * Pure file reads: no toolchain, no browser, no network.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspaces', 'src');

if (!existsSync(SRC)) {
  // A guard that cannot find what it guards has verified NOTHING, so this is a
  // failure, not a skip. Every CI job that runs these uses
  // `submodules: recursive`, so an absent path means a broken checkout — which
  // used to be reported as a pass.
  console.error('check-storage-keys: citadel-workspaces/src is missing, so nothing was checked.');
  process.exit(1);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue;
      out.push(...walk(p));
    } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(SRC);

// `const STORAGE_KEY = 'citadel-privacy'` — so a key held in a constant compares
// equal to the same key written literally elsewhere.
const constants = new Map();
for (const file of files) {
  for (const m of readFileSync(file, 'utf8').matchAll(
    /const\s+([A-Z_][A-Z0-9_]*)\s*=\s*['"]([^'"]+)['"]/g,
  )) {
    constants.set(m[1], m[2]);
  }
}

/** The comparable key for one call argument. */
function keyOf(rawArg) {
  const arg = rawArg.trim();
  if (arg.startsWith("'") || arg.startsWith('"')) return arg.slice(1, -1);
  // Template literal: compare the literal prefix, since `foo:${cid}` and
  // `foo:${peerCid}` are the same namespace written by different callers.
  if (arg.startsWith('`')) return arg.slice(1).split('${')[0];
  if (constants.has(arg)) return constants.get(arg);
  return null; // computed at runtime — cannot be compared, so not judged
}

const reads = new Map();
const writes = new Set();

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(
    /(?:localStorage|sessionStorage)\.(getItem|setItem|removeItem)\(([^,)]+)/g,
  )) {
    const key = keyOf(m[2]);
    if (key === null || key === '') continue;
    if (m[1] === 'getItem') {
      const line = source.slice(0, m.index).split('\n').length;
      if (!reads.has(key)) reads.set(key, `${relative(ROOT, file)}:${line}`);
    } else {
      writes.add(key);
    }
  }
}

const orphaned = [...reads.keys()].filter((k) => !writes.has(k)).sort();

if (orphaned.length > 0) {
  console.error(
    `check-storage-keys: ${orphaned.length} storage key(s) are read but never written.\n` +
      'The read always returns its default, so whatever depends on it is inert while looking correct.\n',
  );
  for (const key of orphaned) console.error(`  '${key}'  read at ${reads.get(key)}`);
  console.error('');
  process.exit(1);
}

console.log(
  `check-storage-keys: OK — all ${reads.size} key(s) read are written somewhere (${writes.size} written).`,
);
