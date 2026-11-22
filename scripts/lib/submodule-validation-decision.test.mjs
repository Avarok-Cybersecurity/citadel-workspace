import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, repoSlug, requireToken } from './submodule-validation-decision.mjs';

const REPO = 'Avarok-Cybersecurity/citadel-agent';
const PINNED = 'e'.repeat(40);
const MERGE = '8'.repeat(40);
const TREE = '1'.repeat(40);

const prun = (id, over = {}) => ({
  id,
  name: 'Validate PR',
  event: 'push',
  path: '.github/workflows/validate.yml',
  head_branch: 'master',
  head_sha: PINNED,
  status: 'completed',
  conclusion: 'success',
  created_at: `2026-11-22T1${id}:00:00Z`,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...over,
});
const green = ['fmt', 'clippy', 'tests (ubuntu-24.04)', 'tests (macos-latest)', 'tests (windows-latest)'].map((name) => ({ name, conclusion: 'success' }));
const facts = (over = {}) => ({
  sha: PINNED,
  tree: TREE,
  repo: REPO,
  trees: new Map([[PINNED, TREE], [MERGE, TREE]]),
  runs: [prun(5)],
  jobs: new Map([[5, green]]),
  ...over,
});

test('a green push run of the pinned commit, every job green, is proof', () => {
  const d = decide(facts());
  assert.equal(d.validated, true);
  assert.equal(d.run, 5);
  assert.match(d.reason, /run 5 \(push to master\) tested that commit: 5 jobs, all succeeded/);
});

test("a push run of master's merge commit with the pinned commit's tree is proof (run 45018083721's shape)", () => {
  const d = decide(facts({ runs: [prun(5, { head_sha: MERGE })] }));
  assert.equal(d.validated, true);
  assert.match(d.reason, /tested 8+, the same tree/);
});

test('negative control: a pull_request run tests a merge, not this tree, and is not proof', () => {
  const d = decide(facts({ runs: [prun(5, { event: 'pull_request', head_branch: 'feature' })] }));
  assert.equal(d.validated, false);
  assert.match(d.reason, /no green push run/);
});

test('negative control: a success run with one failed (or skipped, cancelled, unfinished) job is not proof', () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
    const jobs = [...green.slice(0, 4), { name: 'tests (windows-latest)', conclusion }];
    const d = decide(facts({ jobs: new Map([[5, jobs]]) }));
    assert.equal(d.validated, false, String(conclusion));
    assert.match(d.reason, /not every job succeeded/);
  }
});

test('negative control: a run on a different commit with a different tree is not proof', () => {
  const other = 'f'.repeat(40);
  const d = decide(facts({ runs: [prun(5, { head_sha: other })], trees: new Map([[PINNED, TREE], [other, '2'.repeat(40)]]) }));
  assert.equal(d.validated, false);
  // And a head commit whose tree nobody resolved is not assumed to match.
  assert.equal(decide(facts({ runs: [prun(5, { head_sha: other })] })).validated, false);
});

test('negative control: no token fails fast instead of reading as "no proof"', () => {
  assert.throws(() => requireToken({}), /GH_TOKEN is not set/);
  assert.throws(() => requireToken({ GH_TOKEN: '' }), /GH_TOKEN is not set/);
  assert.equal(requireToken({ GH_TOKEN: 't' }), 't');
});

test('runs of another workflow, branch, repository or fork, or not green, are ignored', () => {
  for (const over of [
    { path: '.github/workflows/types-bump.yml' },
    { name: 'Notify consumers' },
    { head_branch: 'release/x' },
    { conclusion: 'failure' },
    { status: 'in_progress', conclusion: null },
    { repository: { full_name: 'someone/fork' } },
    { head_repository: { full_name: 'someone/fork' } },
  ]) {
    assert.equal(decide(facts({ runs: [prun(5, over)] })).validated, false, JSON.stringify(over));
  }
});

test('a run without the Linux test leg, or with no jobs, or never examined, is not proof', () => {
  const noLinux = green.filter((j) => j.name !== 'tests (ubuntu-24.04)');
  assert.match(decide(facts({ jobs: new Map([[5, noLinux]]) })).reason, /no "tests \(ubuntu-24\.04\)" job/);
  assert.equal(decide(facts({ jobs: new Map([[5, []]]) })).validated, false);
  assert.match(decide(facts({ jobs: new Map() })).reason, /not examined/);
});

test('an older run proves the tree when the newest does not', () => {
  const d = decide(facts({ runs: [prun(5), prun(6)], jobs: new Map([[6, [{ name: 'fmt', conclusion: 'failure' }]], [5, green]]) }));
  assert.equal(d.validated, true);
  assert.equal(d.run, 5);
});

test('malformed or inconsistent object names are not proof', () => {
  assert.equal(decide(facts({ sha: 'abc' })).validated, false);
  assert.equal(decide(facts({ tree: undefined })).validated, false);
  assert.equal(decide(facts({ trees: new Map([[PINNED, '3'.repeat(40)]]) })).validated, false);
});

test('the submodule URL names the repository the runs are read from', () => {
  assert.equal(repoSlug('https://github.com/Avarok-Cybersecurity/citadel-internal-service'), 'Avarok-Cybersecurity/citadel-internal-service');
  assert.equal(repoSlug('https://github.com/o/r.git'), 'o/r');
  assert.equal(repoSlug('git@github.com:o/r.git'), 'o/r');
  assert.throws(() => repoSlug('https://gitlab.com/o/r'), /not a github.com repository/);
  assert.throws(() => repoSlug(undefined), /not a github.com repository/);
});
