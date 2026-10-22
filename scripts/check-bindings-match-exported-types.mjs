#!/usr/bin/env node
/**
 * Every generated binding must correspond to a type that still exists, and
 * every exported type must have one.
 *
 * CI checks binding freshness with `git diff --exit-code -- .../bindings` after
 * regenerating them, under a comment calling it "the freshness check the parity
 * gate cannot make". It cannot make this one either, and for a structural
 * reason:
 *
 *   - ts-rs WRITES files and never deletes them. Remove a `#[ts(export)]` type
 *     and its binding file is simply not rewritten — the diff stays clean,
 *     forever.
 *   - a NEWLY exported type produces an UNTRACKED file, and `git diff` does not
 *     report untracked files either.
 *
 * So that step goes red only when an EXISTING exported type changes shape. Add
 * and remove are both invisible to it.
 *
 * Found by counting: 26 binding files against 23 `#[ts(export)]` sites.
 * `Office`, `Room` and `ListType` were deleted from the Rust source in Feb 2026
 * ("eliminate legacy Office/Room hardcoded references") and their bindings have
 * sat there since, still re-exported by `citadel-workspace-client-ts` — so a
 * consumer can import a type the server has no definition for and will never
 * send.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'citadel-workspace-types/src');
const BINDINGS = join(ROOT, 'citadel-workspace-types/bindings');

/**
 * Type names carrying `#[ts(export)]`.
 *
 * The attribute sits in a derive block above the definition, so the name is the
 * first `pub struct`/`pub enum` after it. Read as text rather than parsed:
 * this gate runs in a job that installs nothing.
 */
function exportedTypes() {
  const names = new Set();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.rs'))) {
    const lines = readFileSync(join(SRC, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/#\[ts\(export/.test(line.split('//')[0])) return;
      for (let j = i + 1; j < Math.min(i + 12, lines.length); j += 1) {
        const m = lines[j].match(/^\s*pub\s+(?:struct|enum)\s+([A-Za-z0-9_]+)/);
        if (m) { names.add(m[1]); return; }
      }
    });
  }
  return names;
}

/** `.rs` files under `dir`, recursively. */
function rustFilesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? rustFilesUnder(join(dir, e.name)) : e.name.endsWith('.rs') ? [join(dir, e.name)] : []);
}

/** Whether `name` is defined with a ts-rs export (`#[ts(export)]`, or `ts(export)` in a `cfg_attr`) under `dir`. */
function exportsType(dir, name) {
  return rustFilesUnder(dir).some((file) => {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.some((line, i) => /\bts\(export/.test(line.split('//')[0])
      && lines.slice(i + 1, i + 12).some((l) => new RegExp(`^\\s*pub\\s+(?:struct|enum)\\s+${name}\\b`).test(l)));
  });
}

/**
 * Types this crate re-exports from a path dependency (`pub use dep_crate::Name;`) that the
 * dependency itself exports to TypeScript: ts-rs writes their binding here too, as a dependency of
 * the types that use them. Each must resolve to a real exported definition, or it is not counted.
 */
function reexportedTypes() {
  const manifest = readFileSync(join(ROOT, 'citadel-workspace-types/Cargo.toml'), 'utf8');
  const deps = new Map([...manifest.matchAll(/^([A-Za-z0-9_-]+)\s*=\s*\{[^}]*\bpath\s*=\s*"([^"]+)"/gm)]
    .map((m) => [m[1].replaceAll('-', '_'), resolve(ROOT, 'citadel-workspace-types', m[2], 'src')]));
  const names = new Set();
  for (const file of readdirSync(SRC).filter((f) => f.endsWith('.rs'))) {
    for (const m of readFileSync(join(SRC, file), 'utf8').matchAll(/^\s*pub use ([a-z0-9_]+)::([A-Za-z0-9_]+);/gm)) {
      const dir = deps.get(m[1]);
      if (dir !== undefined && existsSync(dir) && exportsType(dir, m[2])) names.add(m[2]);
    }
  }
  return names;
}

if (!existsSync(BINDINGS)) {
  console.error(`check-bindings-match-exported-types: ${BINDINGS} does not exist.`);
  process.exit(1);
}

const exported = new Set([...exportedTypes(), ...reexportedTypes()]);
const files = new Set(
  readdirSync(BINDINGS).filter((f) => f.endsWith('.ts')).map((f) => f.replace(/\.ts$/, '')),
);

// Both sets must be real. Either being empty means the layout moved and this
// gate is comparing nothing against nothing, which is a pass it has not earned.
if (exported.size === 0 || files.size === 0) {
  console.error(
    `check-bindings-match-exported-types: found ${exported.size} exported type(s) and ` +
      `${files.size} binding file(s). One of those is zero, so nothing was compared — ` +
      'the source layout or the ts-rs output directory moved.',
  );
  process.exit(1);
}

const orphaned = [...files].filter((f) => !exported.has(f)).sort();
const missing = [...exported].filter((t) => !files.has(t)).sort();

if (orphaned.length > 0 || missing.length > 0) {
  console.error('The generated bindings do not match the exported Rust types:\n');
  for (const f of orphaned) {
    console.error(`  citadel-workspace-types/bindings/${f}.ts — no #[ts(export)] type named ${f}`);
  }
  for (const t of missing) {
    console.error(`  ${t} is #[ts(export)] but has no bindings/${t}.ts`);
  }
  console.error(
    '\n  ts-rs writes files and never deletes them, and `git diff` does not report\n' +
      '  untracked files — so the freshness check in CI can see neither of these.\n' +
      '\n  Delete an orphaned binding (and any re-export of it in\n' +
      '  citadel-workspace-client-ts), or regenerate and COMMIT a missing one.\n',
  );
  process.exit(1);
}

console.log(
  `check-bindings-match-exported-types: all ${exported.size} exported type(s) have a binding, ` +
    'and no binding is orphaned.',
);
