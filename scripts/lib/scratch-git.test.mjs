/**
 * The scratch-git helper keeps outer git options away from scratch repositories. The decoy is a local
 * bare repository in its own temp directory (never a real remote): an outer `-c remote.origin.pushurl`
 * aims at it, and it must stay empty. The same push without the helper lands in it, which is the
 * discrimination: the scrub, not the setup, is what keeps it empty.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pushTargetProblem, pushedRemote, scratchEnv, scratchGit, subcommandAt } from './scratch-git.mjs';

const same = (p) => p;

test('the scratch environment drops every outer git option and repository locator', () => {
  const env = scratchEnv({ PATH: '/bin', GIT_CONFIG_PARAMETERS: "'remote.origin.pushurl'='https://github.com/x/y.git'",
    GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '!gh auth git-credential', GIT_DIR: '/real/.git' });
  assert.equal(env.PATH, '/bin');
  assert.equal(env.GIT_CONFIG_PARAMETERS, undefined);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.GIT_CONFIG_GLOBAL, '/dev/null');
  assert.equal(env.GIT_CONFIG_NOSYSTEM, '1');
  const keys = Object.keys(env).filter((k) => k.startsWith('GIT_CONFIG_KEY_')).map((k) => env[k]);
  assert.ok(keys.includes('credential.helper') && env[`GIT_CONFIG_VALUE_${keys.indexOf('credential.helper')}`] === '');
  assert.ok(keys.includes('protocol.allow'));
});

test('a push target must be a local path inside the scratch directory', () => {
  const at = { cwd: '/s/work', scratchRoot: '/s', canonical: same };
  assert.equal(pushTargetProblem({ ...at, target: '/s/origin.git' }), null);
  assert.equal(pushTargetProblem({ ...at, target: '../origin.git' }), null);
  assert.equal(pushTargetProblem({ ...at, target: 'file:///s/origin.git' }), null);
  assert.match(pushTargetProblem({ ...at, target: 'https://github.com/Avarok-Cybersecurity/citadel-workspace.git' }), /not a local path/);
  assert.match(pushTargetProblem({ ...at, target: 'git@github.com:Avarok-Cybersecurity/citadel-workspace.git' }), /not a local path/);
  assert.match(pushTargetProblem({ ...at, target: '/elsewhere/origin.git' }), /outside \/s/);
});

test('the pushed remote is the first positional argument after the subcommand', () => {
  assert.equal(subcommandAt(['-c', 'a=b', 'push', 'origin']), 2);
  assert.equal(pushedRemote(['push', '-q', '-u', 'mirror', 'main']), 'mirror');
  assert.equal(pushedRemote(['push', '--quiet']), 'origin');
});

function scratchWithDecoy(t) {
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-git-')));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), 'scratch-git-decoy-')));
  t.after(() => { rmSync(scratch, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
  const decoy = join(outside, 'decoy.git');
  execFileSync('git', ['init', '-q', '--bare', decoy], { env: scratchEnv(process.env) });
  const { git } = scratchGit(scratch);
  git(scratch, 'init', '-q', '--bare', '-b', 'main', join(scratch, 'origin.git'));
  git(scratch, 'init', '-q', '-b', 'main', join(scratch, 'work'));
  const work = join(scratch, 'work');
  git(work, 'commit', '-q', '--allow-empty', '-m', 'one');
  git(work, 'remote', 'add', 'origin', join(scratch, 'origin.git'));
  const refsIn = (repo) => execFileSync('git', ['for-each-ref'], { cwd: repo, env: scratchEnv(process.env), encoding: 'utf8' }).trim();
  return { scratch, decoy, work, git, refsIn };
}

test('an outer -c remote.origin.pushurl cannot re-aim a scratch push (and does without the helper)', (t) => {
  const { scratch, decoy, work, refsIn } = scratchWithDecoy(t);
  const outer = { ...process.env, GIT_CONFIG_PARAMETERS: `'remote.origin.pushurl'='${decoy}'` };
  execFileSync('git', ['-c', 'protocol.file.allow=always', 'push', '-q', 'origin', 'main'], { cwd: work, env: outer, stdio: 'ignore' });
  assert.match(refsIn(decoy), /refs\/heads\/main/, 'control: without the helper the outer option DOES aim the push at the decoy');
  execFileSync('git', ['update-ref', '-d', 'refs/heads/main'], { cwd: decoy, env: scratchEnv(process.env) });
  const saved = process.env.GIT_CONFIG_PARAMETERS;
  process.env.GIT_CONFIG_PARAMETERS = outer.GIT_CONFIG_PARAMETERS;
  try {
    const { git: inherited } = scratchGit(scratch);
    inherited(work, 'push', '-q', 'origin', 'main');
  } finally {
    if (saved === undefined) delete process.env.GIT_CONFIG_PARAMETERS; else process.env.GIT_CONFIG_PARAMETERS = saved;
  }
  assert.equal(refsIn(decoy), '', 'the decoy received refs through the helper');
  assert.match(refsIn(join(scratch, 'origin.git')), /refs\/heads\/main/);
});

test('a scratch repository whose origin is not a local path inside the scratch directory is refused before any transport', (t) => {
  const { decoy, work, git } = scratchWithDecoy(t);
  git(work, 'remote', 'set-url', 'origin', 'https://example.invalid/decoy.git');
  assert.throws(() => git(work, 'push', '-q', 'origin', 'main'), /not a local path/);
  git(work, 'remote', 'set-url', 'origin', decoy);
  assert.throws(() => git(work, 'push', '-q', 'origin', 'main'), /outside/);
  assert.throws(() => git(work, 'push', '-q', decoy, 'main'), /outside/);
  // second layer, below the guard: the scratch environment allows no transport but local files
  assert.throws(() => execFileSync('git', ['push', '-q', 'https://example.invalid/decoy.git', 'main'],
    { cwd: work, env: scratchEnv(process.env), stdio: 'pipe' }), /transport 'https' not allowed/);
});
