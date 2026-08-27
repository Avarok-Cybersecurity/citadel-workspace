#!/usr/bin/env node
/**
 * Fails when a doc points at a source file that no longer exists.
 *
 * This is the biggest rot class in the docs, and the existing guards are blind
 * to it: `check-doc-commands` validates COMMANDS, not the `.ts`/`.rs` paths that
 * make up most of the architecture prose, and it never opens CLAUDE.md at all.
 *
 * An audit of the docs found ~10 findings of exactly this shape — a P2P
 * causal-chain map whose file pointers all predate a module split, an appendix
 * listing five "files" that are now directories, a troubleshooting step whose
 * grep target became a directory, and a referenced test report that was deleted.
 * Each was a plausible sentence that only inspection against the tree disproves.
 *
 * Scope is deliberately narrow: a path is only checked when it is unambiguous —
 * it carries a source extension AND at least one directory separator. A bare
 * `service.ts` names no location and is not a claim about one.
 *
 * Pure file reads: no toolchain, no network, no Docker.
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function docsUnder(dir, prefix = '') {
  if (!existsSync(join(ROOT, dir))) return [];
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = join(prefix || dir, e.name);
    if (e.isDirectory()) return docsUnder(join(dir, e.name), rel);
    return e.name.endsWith('.md') ? [rel] : [];
  });
}

// CLAUDE.md included on purpose: it is the file that tells a contributor how the
// system works, so a dead pointer there misleads before any code is read.
// WARP.md is a symlink to it and needs no separate entry.
/**
 * Docs whose paths describe what WILL exist, or what once did. A guard that
 * fires on a roadmap is a guard people learn to ignore, so these are excluded
 * by name rather than by loosening the rule for everyone.
 */
const ASPIRATIONAL = [
  /^docs\/plugins\//,          // a design spec for an unbuilt subsystem
  /^docs\/PLUGINS-ROADMAP\.md$/,
  /^docs\/TODO_FUTURE\.md$/,
  /^docs\/review\//,           // historical PR notes
];

const DOCS = ['README.md', 'ARCHITECTURE.md', 'CLAUDE.md', ...docsUnder('docs')]
  .filter((d) => existsSync(join(ROOT, d)))
  .filter((d) => !ASPIRATIONAL.some((re) => re.test(d)));

/** Source-ish paths with a directory component. */
const PATH_RE = /(?:^|[\s`('"[|])((?:[\w.-]+\/)+[\w.-]+\.(?:ts|tsx|rs|mjs|js|toml|yml|yaml|json|css|sh))(?=[\s`)'".,;:\]|]|$)/g;

/**
 * Prefixes that are not repo paths: URLs, node_modules, generated output, and
 * the crates.io-style references that name a package rather than a file.
 */
const IGNORE = [
  /^https?:/, /^node_modules\//, /^target\//, /^dist\//, /^\.\//,
  /^citadel-workspaces\/node_modules\//, /^~\//, /^\//,
];

/** Every tracked source file, indexed for suffix resolution. */
const allFiles = [];
const directorySuffixes = new Set();
(function walk(dir) {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    if (['node_modules', 'target', 'dist', '.git', 'pkg'].includes(e.name)) continue;
    const rel = dir === '.' ? e.name : `${dir}/${e.name}`;
    if (e.isDirectory()) {
      // Recorded so a path that became a directory can be named as such — the
      // signature of a module split, which is worth a precise message.
      for (const suffix of suffixesOf(rel)) directorySuffixes.add(suffix);
      walk(rel);
    } else {
      allFiles.push(rel);
    }
  }
})('.');

function suffixesOf(path) {
  const parts = path.split('/');
  return parts.map((_, i) => parts.slice(i).join('/'));
}

const fileSuffixes = new Set(allFiles.flatMap(suffixesOf));
const resolves = (ref) => fileSuffixes.has(ref);

const failures = [];
let checked = 0;

for (const doc of DOCS) {
  const text = readFileSync(join(ROOT, doc), 'utf8');
  const lines = text.split('\n');

  lines.forEach((line, i) => {
    // A path inside a "was/used to be/no longer" sentence is history, not a
    // claim that the file is there now.
    if (/\b(was|were|used to|no longer|previously|deleted|removed|renamed)\b/i.test(line)) return;

    for (const m of line.matchAll(PATH_RE)) {
      const ref = m[1];
      if (IGNORE.some((re) => re.test(ref))) continue;
      if (ref.includes('*') || ref.includes('{')) continue;
      checked += 1;

      // Resolved against an index of every tracked source file, by SUFFIX.
      //
      // Docs legitimately abbreviate — CLAUDE.md writes `messenger/mod.rs`, a
      // real file six directories down. Requiring full paths would flag correct
      // prose, which is how a guard earns its way onto an ignore list. Matching
      // a suffix still catches the rot class that matters: a file that was
      // deleted, renamed, or split into a directory has no suffix match at all.
      if (resolves(ref)) continue;

      const asDir = directorySuffixes.has(ref.replace(/\.\w+$/, ''));

      failures.push({
        doc,
        line: i + 1,
        ref,
        hint: asDir ? 'that module was split — the path is now a directory' : 'no such file',
      });
    }
  });
}

if (failures.length > 0) {
  for (const { doc, line, ref, hint } of failures) {
    console.error(`::error file=${doc},line=${line}::${doc}:${line} points at ${ref} — ${hint}`);
  }
  console.error(`\nFAIL: ${failures.length} dead file reference(s) in the docs.`);
  console.error('Update the pointer, or reword the sentence in the past tense if it is history.');
  process.exit(1);
}

console.log(`All ${checked} file references across ${DOCS.length} docs resolve.`);
