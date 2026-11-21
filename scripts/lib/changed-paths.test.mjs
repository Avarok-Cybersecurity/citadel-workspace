/**
 * What the pre-push hook judges, in throwaway repositories with a real bare remote: only commits no
 * remote ref has. Negative controls are the tests themselves: the "old base" case is the push the
 * previous rule made (the release branch unknown to the remote), and it does judge the agent path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pushedPaths } from './changed-paths.mjs';

const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function commit(repo, path, text) {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
  run(repo, 'add', path);
  run(repo, '-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', path);
  return run(repo, 'rev-parse', 'HEAD');
}

/** origin: master, and release (master + an agent change), both pushed; `work` is a clone of it. */
function world(t) {
  const root = mkdtempSync(join(tmpdir(), 'changed-paths-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const origin = join(root, 'origin.git');
  const work = join(root, 'work');
  run(root, 'init', '-q', '--bare', '-b', 'master', origin);
  run(root, 'clone', '-q', origin, work);
  run(work, 'checkout', '-q', '-b', 'master');
  commit(work, 'README.md', 'one');
  run(work, 'push', '-q', '-u', 'origin', 'master');
  run(work, 'remote', 'set-head', 'origin', 'master');
  run(work, 'checkout', '-q', '-b', 'release');
  commit(work, 'citadel-internal-service/src/lib.rs', 'agent');
  run(work, 'push', '-q', 'origin', 'release');
  run(work, 'checkout', '-q', '-b', 'feat');
  return work;
}

const ZERO = '0'.repeat(40);
const newBranch = (work) => `refs/heads/feat ${run(work, 'rev-parse', 'HEAD')} refs/heads/feat ${ZERO}\n`;

test('a UI-only branch cut from a pushed release branch judges only its own paths', (t) => {
  const work = world(t);
  commit(work, 'citadel-workspaces/src/App.tsx', 'ui');
  assert.deepEqual(pushedPaths(work, '', 'origin', newBranch(work)).paths, ['citadel-workspaces/src/App.tsx']);
});

test('a new commit touching agent Rust on that branch is still judged', (t) => {
  const work = world(t);
  commit(work, 'citadel-workspaces/src/App.tsx', 'ui');
  commit(work, 'citadel-internal-service/src/kernel.rs', 'agent again');
  assert.deepEqual(pushedPaths(work, '', 'origin', newBranch(work)).paths.sort(),
    ['citadel-internal-service/src/kernel.rs', 'citadel-workspaces/src/App.tsx']);
});

test('with the release branch unknown to the remote (the old base), the agent path is judged again', (t) => {
  const work = world(t);
  commit(work, 'citadel-workspaces/src/App.tsx', 'ui');
  run(work, 'push', '-q', 'origin', '--delete', 'release');
  run(work, 'update-ref', '-d', 'refs/remotes/origin/release');
  assert.deepEqual(pushedPaths(work, '', 'origin', newBranch(work)).paths.sort(),
    ['citadel-internal-service/src/lib.rs', 'citadel-workspaces/src/App.tsx']);
});

test('an existing remote branch judges only what is past its remote head', (t) => {
  const work = world(t);
  commit(work, 'citadel-workspaces/src/App.tsx', 'ui');
  run(work, 'push', '-q', 'origin', 'feat');
  const remoteSha = run(work, 'rev-parse', 'HEAD');
  commit(work, 'citadel-workspaces/src/Other.tsx', 'more');
  const stdin = `refs/heads/feat ${run(work, 'rev-parse', 'HEAD')} refs/heads/feat ${remoteSha}\n`;
  assert.deepEqual(pushedPaths(work, '', 'origin', stdin).paths, ['citadel-workspaces/src/Other.tsx']);
});

test('pushing commits the remote already has judges nothing; a deletion judges nothing', (t) => {
  const work = world(t);
  assert.deepEqual(pushedPaths(work, '', 'origin', newBranch(work)).paths, []);
  assert.deepEqual(pushedPaths(work, '', 'origin', `(delete) ${ZERO} refs/heads/feat ${run(work, 'rev-parse', 'HEAD')}\n`).paths, []);
});

test('a branch with no remote ancestor falls back to the remote default and does not pass silently', (t) => {
  const work = world(t);
  run(work, 'checkout', '-q', '--orphan', 'lonely');
  run(work, 'rm', '-rq', '--cached', '.');
  commit(work, 'citadel-internal-service/src/lib.rs', 'unrelated');
  const stdin = `refs/heads/lonely ${run(work, 'rev-parse', 'HEAD')} refs/heads/lonely ${ZERO}\n`;
  assert.throws(() => pushedPaths(work, '', 'origin', stdin), /merge-base/);
});
