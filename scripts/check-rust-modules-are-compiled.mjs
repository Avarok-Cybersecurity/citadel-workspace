#!/usr/bin/env node
/**
 * Every .rs file under a crate's src/ must be reachable by a `mod` declaration.
 *
 * `handlers/permissions.rs` was not. It sat in the tree for months carrying a
 * fourth role-to-permission table -- one that granted SendMessages to no role
 * at all, contradicting `Permission::for_role` -- behind a commented-out
 * `// pub mod permissions;`. Nothing compiled it, so no test could fail on it
 * and no clippy lint could see it, and reading it as authoritative is exactly
 * how the refusal that round 409 removed from enforcement would come back.
 *
 * Uncompiled code is worse than deleted code: it looks maintained.
 *
 * A file's stem must be declared in its directory's `mod.rs` (or the crate
 * root for top-level files), and DIRECTORIES are checked the same way. The
 * first draft checked only files, and its own control caught the gap:
 * commenting out `pub mod domain;` orphans every file beneath `domain/` while
 * each one still looks declared by `domain/mod.rs`. A whole subtree could drop
 * out of the build and this would have reported "all compiled".
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Crate roots to walk. Listed, so a new crate is a deliberate addition. */
const CRATES = [
  'citadel-workspace-server-kernel',
  'citadel-workspace-types',
];

/**
 * Orphans that predate this check, held at their current set.
 *
 * All six are the sync kernel that `async_kernel` replaced -- `kernel/mod.rs`
 * says so where it comments them out. They are listed rather than deleted
 * because removing several hundred lines of somebody else's superseded design
 * is a decision for whoever owns it, not a side effect of adding a check. The
 * list may only SHRINK: a new orphan fails, and deleting one of these and
 * forgetting to remove it here also fails, so the baseline cannot rot.
 *
 * `handlers/permissions.rs` is deliberately NOT here. It was deleted, because
 * it carried a role table contradicting `Permission::for_role`.
 */
const KNOWN_ORPHANS = new Set([
  'citadel-workspace-server-kernel/src/handlers/query.rs',
  'citadel-workspace-server-kernel/src/kernel/core.rs',
  'citadel-workspace-server-kernel/src/kernel/initialization.rs',
  'citadel-workspace-server-kernel/src/kernel/member_operations.rs',
  'citadel-workspace-server-kernel/src/kernel/network.rs',
  'citadel-workspace-server-kernel/src/kernel/user_management.rs',
  // An undeclared DIRECTORY, found by this check's own directory support the
  // moment it was added. It holds `role_permissions.rs`, a role table that
  // round 409 cited as agreeing with the SSOT -- while not being compiled at
  // all. Files beneath it are reached through its own mod.rs, so they are not
  // listed separately.
  'citadel-workspace-server-kernel/src/kernel/transaction/rbac',
]);

/** Files that are module roots in their own right and need no declaration. */
const ROOTS = new Set(['lib.rs', 'main.rs', 'mod.rs']);

function declaredModules(path) {
  if (!existsSync(path)) return new Set();
  const names = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    // A commented declaration declares nothing -- that is the whole point.
    const m = line.match(/^\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+([A-Za-z0-9_]+)\s*[;{]/);
    if (m) names.add(m[1]);
  }
  return names;
}

function* rustPaths(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield full;
      yield* rustPaths(full);
    } else if (entry.endsWith('.rs')) {
      yield full;
    }
  }
}

const orphans = [];
/** Emptied as each baselined path is seen; whatever remains no longer exists. */
const stillOrphaned = new Set(KNOWN_ORPHANS);
let checked = 0;

for (const crate of CRATES) {
  const src = join(ROOT, crate, 'src');
  if (!existsSync(src)) {
    orphans.push([crate, 'listed here but has no src/; this check is out of date']);
    continue;
  }
  for (const file of rustPaths(src)) {
    const isDir = statSync(file).isDirectory();
    const name = basename(file);
    if (!isDir && ROOTS.has(name)) continue;
    checked += 1;
    // For a directory, the declaration lives in its PARENT.
    const dir = isDir ? dirname(file) : dirname(file);
    // A sibling `mod.rs`, or for top-level entries the crate root, must name it.
    const declaredIn = dir === src
      ? [join(src, 'lib.rs'), join(src, 'main.rs')]
      : [join(dir, 'mod.rs'), `${dir}.rs`];
    const stem = isDir ? name : name.slice(0, -3);
    const found = declaredIn.some((d) => declaredModules(d).has(stem));
    const rel = file.slice(ROOT.length + 1);
    if (!found && !KNOWN_ORPHANS.has(rel)) {
      orphans.push([rel, 'no `mod` declaration reaches it; it is not compiled']);
    }
    if (found) stillOrphaned.delete(rel);
    if (!found) stillOrphaned.delete(rel);
  }
}

for (const gone of stillOrphaned) {
  orphans.push([gone, 'listed as a known orphan but no longer present; remove it from KNOWN_ORPHANS']);
}

if (orphans.length > 0) {
  console.error('\n  Rust files the build never sees:\n');
  for (const [where, why] of orphans) console.error(`::error::${where} — ${why}`);
  console.error(
    '\n  Either declare the module and make it compile, or delete the file.\n' +
    '  A file that cannot compile cannot be tested, linted, or trusted, and\n' +
    '  reads as maintained code to whoever finds it next.\n',
  );
  process.exit(1);
}

console.log(`  Rust modules: ${checked} file(s) across ${CRATES.length} crate(s), all compiled  ok`);
