#!/usr/bin/env node
/**
 * The submodule-pointer guard must give the same verdict from a linked worktree
 * as from the primary checkout.
 *
 * It did not. A linked worktree does not populate submodules, so the guard's
 * `git -C <parent>/<path>` ran inside an empty directory, which git resolves by
 * walking UP to the parent repository. Every question reached the wrong repo:
 * pushed commits came back "no such commit", and the recursion re-read the
 * parent's own pointers under a nested prefix. The guard refused correct pushes
 * from every worktree — and since all the work here happens in worktrees, that
 * is the guard for all practical purposes.
 *
 * A guard that is wrong in the direction of blocking gets switched off, so this
 * asserts BOTH directions on real repositories:
 *
 *   1. everything pushed, judged from a linked worktree  -> exit 0
 *   2. a submodule commit not pushed, same worktree      -> exit 1
 *
 * (2) is the negative control. Without it, (1) alone is satisfied by a guard
 * that has been gutted into always passing, which is exactly the failure this
 * repository keeps finding.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GUARD = join(dirname(fileURLToPath(import.meta.url)), 'check-submodule-pointers-pushed.mjs');
const root = mkdtempSync(join(tmpdir(), 'subgate-'));

const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** A repo with an identity and no signing, so this runs on any machine. */
function init(dir) {
  execFileSync('git', ['init', '--quiet', '-b', 'main', dir]);
  git(dir, 'config', 'user.email', 'gate@example.invalid');
  git(dir, 'config', 'user.name', 'Gate Fixture');
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'protocol.file.allow', 'always');
  return dir;
}

function commit(dir, name, body) {
  writeFileSync(join(dir, name), body);
  git(dir, 'add', name);
  git(dir, 'commit', '--quiet', '-m', name);
  return git(dir, 'rev-parse', 'HEAD');
}

const failures = [];

try {
  // Bare "remotes", then working clones of each.
  const subRemote = join(root, 'sub.git');
  const parentRemote = join(root, 'parent.git');
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', subRemote]);
  execFileSync('git', ['init', '--quiet', '--bare', '-b', 'main', parentRemote]);

  const sub = init(join(root, 'sub'));
  commit(sub, 'one.txt', 'first\n');
  git(sub, 'remote', 'add', 'origin', subRemote);
  git(sub, 'push', '--quiet', 'origin', 'main');

  const parent = init(join(root, 'parent'));
  commit(parent, 'readme.txt', 'parent\n');
  git(parent, '-c', 'protocol.file.allow=always', 'submodule', '--quiet', 'add', subRemote, 'sub');
  git(parent, 'commit', '--quiet', '-m', 'add submodule');
  git(parent, 'remote', 'add', 'origin', parentRemote);
  git(parent, 'push', '--quiet', 'origin', 'main');

  // The worktree the real workflow uses — submodules deliberately NOT populated,
  // which is what `git worktree add` does and what broke the guard.
  const wt = join(root, 'wt');
  git(parent, 'worktree', 'add', '--quiet', '-b', 'topic', wt, 'HEAD');

  const run = (cwd) => spawnSync(process.execPath, [GUARD], { cwd, encoding: 'utf8' });

  // (1) Everything is pushed. Judged from the worktree, this must pass.
  const clean = run(wt);
  if (clean.status !== 0) {
    failures.push(
      'a fully-pushed tree was REFUSED when judged from a linked worktree:\n' +
        `${clean.stdout}${clean.stderr}`.replace(/^/gm, '      '),
    );
  }

  // (2) Negative control: advance the submodule without pushing it, and record
  //     the new pointer. The commit is made in the parent's OWN clone of the
  //     submodule (`parent/sub`) — that clone, not the fixture's other one, is
  //     what the parent's index tracks.
  //     The guard must now refuse, and must name `sub`.
  const inParent = join(parent, 'sub');
  git(inParent, 'config', 'user.email', 'gate@example.invalid');
  git(inParent, 'config', 'user.name', 'Gate Fixture');
  git(inParent, 'config', 'commit.gpgsign', 'false');
  const unpushed = commit(inParent, 'two.txt', 'second\n');
  git(parent, 'add', 'sub');
  git(parent, 'commit', '--quiet', '-m', 'bump submodule');
  git(wt, 'merge', '--quiet', '--ff-only', 'main');

  const dirty = run(wt);
  if (dirty.status === 0) {
    failures.push(`an UNPUSHED submodule pointer (${unpushed.slice(0, 9)}) was accepted; the guard measures nothing`);
  } else if (!`${dirty.stdout}${dirty.stderr}`.includes('sub @')) {
    failures.push(`the guard refused the push without naming the submodule:\n${dirty.stdout}${dirty.stderr}`);
  }
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures.length > 0) {
  console.error('The submodule-pointer guard does not judge a worktree correctly:\n');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}

console.log('The submodule-pointer guard passes a pushed worktree and refuses an unpushed pointer.');
