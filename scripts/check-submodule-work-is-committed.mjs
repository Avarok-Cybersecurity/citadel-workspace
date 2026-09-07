#!/usr/bin/env node
/**
 * A submodule must not carry uncommitted changes to tracked files.
 *
 * `git add -A && git commit` in the parent records a submodule POINTER, not
 * file contents. So editing a file inside a submodule checkout and committing
 * in the parent produces a commit that looks complete, passes every local
 * gate — preflight reads the working tree, where the change is present — and
 * ships the OLD code, because the pointer never moved.
 *
 * That happened here: a two-attribute Rust fix and the gate enforcing it landed
 * in the same wave. Preflight was green. CI checked out what the pointer named,
 * and the gate fired on the very fields it had been written for. The fix existed
 * only in a working tree.
 *
 * This is NOT what `check-submodule-pointers-pushed.mjs` covers, and that gate
 * is right not to: the pointer was pushed and is fetchable. It simply named a
 * commit without the work. "The pointer is pushed" and "the pointer names your
 * work" are different claims, and only the first had a guard.
 *
 * Scope, deliberately narrow:
 *   - Tracked modifications only. Untracked files are ordinary during
 *     development and are not silently shipped by a parent commit.
 *   - Staged counts too: staged-but-not-committed is the same hazard.
 *   - This is a PRE-PUSH concern. Mid-work a dirty submodule is normal, which
 *     is why the message says what to do rather than merely refusing.
 */
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Run git in `cwd` WITHOUT the ambient git environment.
 *
 * A pre-push hook runs with GIT_DIR, and often GIT_INDEX_FILE, exported. A
 * child `git -C <submodule> status` then inherits them and reads the PARENT's
 * index against the submodule's worktree, which reports every file the parent
 * tracks and the submodule does not as deleted. The first version of this gate
 * blocked a push with a hundred phantom deletions -- ARCHITECTURE.md,
 * .gitmodules, .dockerignore -- attributed to citadel-workspaces.
 *
 * Running it by hand looked fine, because a shell has none of those set. That
 * is what makes it worth writing down: the gate was correct everywhere except
 * the one place it runs.
 */
function git(args, cwd) {
  const env = { ...process.env };
  for (const k of ['GIT_DIR', 'GIT_INDEX_FILE', 'GIT_WORK_TREE', 'GIT_OBJECT_DIRECTORY',
                   'GIT_ALTERNATE_OBJECT_DIRECTORIES', 'GIT_COMMON_DIR', 'GIT_PREFIX']) {
    delete env[k];
  }
  return execFileSync('git', args, { cwd, encoding: 'utf8', env }).trim();
}

let paths;
try {
  paths = git(['config', '--file', '.gitmodules', '--get-regexp', 'path'])
    .split('\n').filter(Boolean).map((l) => l.split(' ').slice(1).join(' '));
} catch {
  console.error('\n  No .gitmodules found. This repository is expected to have submodules;\n  if that changed, remove this gate deliberately.\n');
  process.exit(1);
}

if (paths.length < 2) {
  console.error(`\n  Found only ${paths.length} submodule(s); expected at least 2. Fix this reader.\n`);
  process.exit(1);
}

const dirty = [];
for (const p of paths) {
  // A LINKED WORKTREE does not populate submodules, and `git -C <empty dir>`
  // resolves by walking UP to the parent repository -- so the parent's own
  // dirty state is reported as the submodule's. That is not hypothetical: the
  // first version of this gate blocked a push listing README.md, package.json
  // and a parent crate as "uncommitted changes in citadel-workspaces".
  //
  // check-submodule-gate-judges-a-worktree.mjs records the same trap for the
  // pointer guard. So: only judge a directory that IS the repository root it
  // claims to be.
  let status;
  try {
    const top = git(['rev-parse', '--show-toplevel'], p);
    if (resolve(top) !== resolve(p)) continue; // unpopulated; git walked up
    status = git(['status', '--porcelain', '--untracked-files=no', '--ignore-submodules=all'], p);
  } catch {
    continue; // not initialised; check-submodules-are-populated covers that
  }
  if (status) {
    const files = status.split('\n').map((l) => `      ${l.trim()}`).join('\n');
    dirty.push(`    ${p}\n${files}`);
  }
}

if (dirty.length > 0) {
  console.error(
    '\n  These submodules have uncommitted changes to tracked files:\n\n' +
    dirty.join('\n\n') +
    '\n\n  A parent commit records a POINTER, not these edits. Committing in the\n' +
    '  parent now ships the code the pointer already names — the old code — and\n' +
    '  every local check will pass, because they read this working tree.\n\n' +
    '  Commit inside the submodule first, push it, then bump the pointer:\n' +
    '    git -C <submodule> commit -am "..." && git -C <submodule> push\n' +
    '    git add <submodule> && git commit\n',
  );
  process.exit(1);
}

console.log(`submodule work is committed: ${paths.length} submodule(s) clean.`);
