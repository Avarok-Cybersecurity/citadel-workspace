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
 *
 * Addressing a submodule by its *working directory* is what broke this guard.
 * A linked worktree does not populate submodules, so `citadel-internal-service/`
 * there is an empty directory — and `git -C` inside an empty directory walks up
 * and answers as the PARENT repository. Every question then went to the wrong
 * repo: `--contains <sha>` said "no such commit" for commits that are pushed,
 * and the recursion re-read the parent's own pointers under a nested prefix, so
 * the report listed `citadel-internal-service/citadel-workspaces`, which does
 * not exist. Correct pushes were refused, from every worktree, with a message
 * naming submodules that were fine. Submodule repositories are therefore
 * addressed by GIT DIRECTORY (`<git-common-dir>/modules/<name>`, which every
 * worktree shares) and never by working directory.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

function git(args, { gitDir, cwd } = {}) {
  const full = gitDir ? ['--git-dir', gitDir, ...args] : args;
  return execFileSync('git', full, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/**
 * Submodule name -> path, read from the .gitmodules of `commit`. Git stores a
 * submodule's repository under its NAME, which is free to differ from its path.
 */
function moduleNames(gitDir, commit) {
  let text;
  try {
    text = git(['show', `${commit}:.gitmodules`], { gitDir });
  } catch {
    return new Map(); // No .gitmodules at this commit.
  }
  const byPath = new Map();
  const re = /^\s*\[submodule "(.+)"\]|^\s*path\s*=\s*(.+)$/gm;
  let name = null;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) name = m[1];
    else if (name) byPath.set(m[2].trim(), name);
  }
  return byPath;
}

/** [{ path, sha }] for the submodules `commit` records. */
function pointers(gitDir, commit) {
  return git(['ls-tree', '-r', commit], { gitDir })
    .split('\n')
    .filter((line) => line.startsWith('160000'))
    .map((line) => {
      const [meta, path] = line.split('\t');
      return { path, sha: meta.split(/\s+/)[2] };
    });
}

const problems = [];

/** Recurse, because a nested pointer fails checkout just as hard as a top one. */
function check(gitDir, commit, prefix = '') {
  const names = moduleNames(gitDir, commit);
  for (const { path, sha } of pointers(gitDir, commit)) {
    const full = `${prefix}${path}`;
    const subGitDir = `${gitDir}/modules/${names.get(path) ?? path}`;

    // Not knowing is not the same as passing. A submodule whose repository we
    // cannot find is a pointer this guard did not check, and saying so is the
    // whole point of it existing.
    if (!existsSync(subGitDir)) {
      problems.push(
        `${full} @ ${sha.slice(0, 9)} — no repository at ${subGitDir}; ` +
          'cannot tell whether it is pushed (run `git submodule update --init --recursive`)',
      );
      continue;
    }

    // Refresh remote-tracking refs before trusting them. `branch -r --contains`
    // reads LOCAL tracking refs, which can lag the remote arbitrarily — a push
    // through a repository redirect updated the remote and left origin/<branch>
    // pointing at the previous commit, and this script then reported a correctly
    // pushed pointer as missing on its own first real use. A guard that blocks
    // correct work gets switched off, so the round-trip is the price of being
    // believed.
    try {
      git(['fetch', '--quiet', 'origin'], { gitDir: subGitDir });
    } catch {
      // Offline, or no such remote. Fall through and judge on what we have —
      // a verdict from a stale-but-present ref beats failing closed with no
      // network.
    }

    let onRemote = '';
    try {
      onRemote = git(['branch', '-r', '--contains', sha], { gitDir: subGitDir });
    } catch {
      // --contains exits non-zero for an unknown object, which is itself the
      // answer: the commit is not on any remote branch we can see.
      onRemote = '';
    }
    if (!onRemote) {
      problems.push(`${full} @ ${sha.slice(0, 9)} — recorded here, absent from that submodule's remote`);
      continue; // Its tree is not readable either; nothing to recurse into.
    }

    // Descend through the RECORDED commit, not through whatever that submodule
    // happens to have checked out — they differ routinely, and the pointer that
    // breaks checkout is the recorded one.
    check(subGitDir, sha, `${full}/`);
  }
}

const topGitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
  encoding: 'utf8',
}).trim();
check(topGitDir, execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim());

if (problems.length > 0) {
  console.error('Submodule pointers that would fail `actions/checkout`:\n');
  for (const p of problems) console.error(`  ${p}`);
  console.error('\nPush innermost-first, then the parent:');
  console.error('  git -C <submodule> push origin <branch>   # repeat for each, deepest first');
  console.error('  git push origin <branch>                  # the parent last');
  process.exit(1);
}

console.log('Every submodule pointer exists on its remote.');
