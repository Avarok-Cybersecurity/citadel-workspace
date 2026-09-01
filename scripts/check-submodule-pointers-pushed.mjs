#!/usr/bin/env node
/**
 * Every submodule pointer this repo records must exist on that submodule's
 * remote.
 *
 * The nested-submodule commit order is innermost-first for exactly this reason,
 * and skipping one push produces a failure that names none of it. `actions/
 * checkout` fails with:
 *
 *   fatal: remote error: upload-pack: not our ref <sha>
 *   fatal: Fetched in submodule path '<path>', but it did not contain <sha>
 *
 * That aborts EVERY job with `submodules: recursive` — seventeen of them here —
 * so a whole CI run goes red at checkout, before a single test compiles, and
 * the logs describe a git internal rather than "you forgot to push a
 * submodule". Locally everything looks fine, because the commit is right there.
 *
 * Checked before push rather than after, since after is a red run.
 *
 * Deliberately NOT wired into CI. By the time any CI job could run this,
 * `actions/checkout` has already succeeded — which means the pointers were
 * pushed — so a CI copy could never fail. That is a check that reports success
 * unconditionally, which is worse than no check: it reads as coverage. This is
 * a pre-push guard and belongs only there.
 */
import { execFileSync } from 'node:child_process';

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

/** [{ path, sha }] for the submodules a repo's HEAD records. */
function pointers(repo) {
  return git(['ls-tree', '-r', 'HEAD'], repo)
    .split('\n')
    .filter((line) => line.startsWith('160000'))
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { path, sha: meta.split(/\s+/)[2] };
    });
}

const problems = [];

/** Recurse, because a nested pointer fails checkout just as hard as a top one. */
function check(repo, prefix = '') {
  for (const { path, sha } of pointers(repo)) {
    const full = `${prefix}${path}`;
    const dir = `${repo}/${path}`;
    // Refresh remote-tracking refs before trusting them. `branch -r --contains`
    // reads LOCAL tracking refs, which can lag the remote arbitrarily — a push
    // through a repository redirect updated the remote and left origin/<branch>
    // pointing at the previous commit, and this script then reported a correctly
    // pushed pointer as missing on its own first real use. A guard that blocks
    // correct work gets switched off, so the round-trip is the price of being
    // believed.
    try {
      git(['fetch', '--quiet', 'origin'], dir);
    } catch {
      // Offline, or no such remote. Fall through and judge on what we have —
      // a verdict from a stale-but-present ref beats failing closed with no
      // network.
    }
    let onRemote = '';
    try {
      onRemote = git(['branch', '-r', '--contains', sha], dir);
    } catch {
      // --contains exits non-zero for an unknown object, which is itself the
      // answer: the commit is not on any remote branch we can see.
      onRemote = '';
    }
    if (!onRemote) {
      problems.push(`${full} @ ${sha.slice(0, 9)} — recorded here, absent from that submodule's remote`);
    }
    try {
      check(dir, `${full}/`);
    } catch {
      // Not a checked-out repo (uninitialised submodule); nothing to recurse.
    }
  }
}

check('.');

if (problems.length > 0) {
  console.error('Submodule pointers that would fail `actions/checkout`:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nPush innermost-first, then the parent:');
  console.error('  git -C <submodule> push origin <branch>   # repeat for each, deepest first');
  console.error('  git push origin <branch>                  # the parent last');
  process.exit(1);
}

console.log('Every submodule pointer exists on its remote.');
