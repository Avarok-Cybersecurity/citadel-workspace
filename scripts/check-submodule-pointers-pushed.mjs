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
