#!/usr/bin/env node
/**
 * Every module under src/ is reached by an import.
 *
 * The Rust half of this (`check-rust-modules-are-compiled.mjs`) was written
 * after `handlers/permissions.rs` turned out to sit behind a commented-out
 * `mod` declaration, carrying a role table that contradicted the one
 * enforcement should use. TypeScript has no `mod` line, so the same thing hides
 * differently: the file compiles, type-checks, lints and reads as maintained,
 * and nothing imports it.
 *
 * That is how a second answer survives: `lib/live-document-store/document-queries.ts`
 * once exported `getRootHash`, `getCreatorCid`, `isCreator` and `getRevisionChain`
 * while `lib/yjs-merkle-strategy/tree.ts` had all four as methods callers used, so
 * one of the two answered nobody. (Both went with the earlier chat editor.)
 *
 * Config-referenced files are entry points, not orphans: `vitest.config.ts`
 * names `test/setup.ts` in `setupFiles` and `test/pwa-register-stub.ts` in
 * `resolve.alias`, so both are read from there rather than imported.
 */
import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const SRC = join(ROOT, 'src');

/**
 * Modules nothing imports today, held at this set.
 *
 * Listed rather than deleted: deciding whether a planned API should be wired up
 * or dropped belongs to whoever planned it. The list may only SHRINK — a new
 * orphan fails, and so does an entry naming a file that no longer exists, so
 * the baseline cannot rot.
 */
const KNOWN_ORPHANS = new Set([
  'contexts/index.ts',
  'types/files.ts',
  'types/workspace.ts',
]);

/** Reached by the bundler, the test runner, or the type system, not by an import. */
const ENTRY = /(^|\/)(main|App|vite-env)\.tsx?$|(^|\/)test\/(setup|pwa-register-stub)\.ts$|\.d\.ts$|\.test\.tsx?$/;

function* files(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(entry)) yield full;
  }
}

const all = [...files(SRC)];
const imported = new Set();
/**
 * The build config imports from src too (the PWA manifest's kit fields, the /ws proxy path), and
 * a module only it imports is reached by every build. Scanned as an importer, never as a module.
 */
const CONFIG_IMPORTERS = [join(ROOT, 'vite.config.ts')];

for (const file of [...all, ...CONFIG_IMPORTERS]) {
  const source = readFileSync(file, 'utf8');
  // Static imports/re-exports, dynamic `import()`, and SIDE-EFFECT imports
  // (`import './x';`) alike. The last was missing from the first draft, which
  // its own control caught: a module imported only for its side effects would
  // have been reported as an orphan.
  // And `new URL('./x.ts', import.meta.url)`, which is how Vite reaches a Web Worker's entry
  // (`new Worker(new URL(...), { type: 'module' })`): the worker module is bundled from it.
  for (const m of source.matchAll(/from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]|import\s+['"]([^'"]+)['"]|new\s+URL\(\s*['"]([^'"]+)['"]\s*,\s*import\.meta\.url/g)) {
    const spec = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (!spec) continue;
    let base = null;
    if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
    else if (spec.startsWith('.')) base = resolve(dirname(file), spec);
    if (!base) continue;
    for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx'), base]) {
      imported.add(cand);
    }
  }
}

const problems = [];
const stillOrphaned = new Set(KNOWN_ORPHANS);

for (const file of all) {
  const rel = relative(SRC, file);
  if (ENTRY.test(rel) || rel.includes('__tests__')) continue;
  stillOrphaned.delete(rel);
  if (imported.has(file)) {
    // The list may only shrink. Wiring one of these up is progress, and the
    // entry has to go with it -- otherwise the baseline quietly grants an
    // exemption to a file that no longer needs one, and the next orphan to
    // take that path is never reported.
    if (KNOWN_ORPHANS.has(rel)) {
      problems.push([rel, 'listed as a known orphan but is now imported; remove it from KNOWN_ORPHANS']);
    }
    continue;
  }
  if (!KNOWN_ORPHANS.has(rel)) {
    problems.push([rel, 'nothing imports it; it is dead or it was never wired up']);
  }
}

for (const gone of stillOrphaned) {
  problems.push([gone, 'listed as a known orphan but no longer exists; remove it from KNOWN_ORPHANS']);
}

if (problems.length > 0) {
  console.error('\n  Modules nothing imports:\n');
  for (const [where, why] of problems) console.error(`::error::src/${where} — ${why}`);
  console.error(
    '\n  Wire it up or delete it. A module that compiles, type-checks and lints\n' +
    '  while nothing imports it reads as maintained code, and is exactly where a\n' +
    '  second answer to a settled question survives.\n',
  );
  process.exit(1);
}

console.log(`  Module reachability: ${all.length} file(s), all imported  ok`);
