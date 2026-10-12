import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide } from './publish-validation-decision.mjs';

const REPO = 'Avarok-Cybersecurity/citadel-workspace';
const SHA = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const TREE = 'c'.repeat(40);

const pull = (over = {}) => ({
  number: 219,
  merged_at: '2026-10-11T17:45:00Z',
  merge_commit_sha: SHA,
  base: { ref: 'master' },
  head: { sha: HEAD, repo: { full_name: REPO } },
  ...over,
});
const vrun = (id, over = {}) => ({
  id,
  event: 'pull_request',
  path: '.github/workflows/validate.yml',
  head_sha: HEAD,
  status: 'completed',
  conclusion: 'success',
  created_at: `2026-10-11T1${id}:00:00Z`,
  repository: { full_name: REPO },
  head_repository: { full_name: REPO },
  ...over,
});
const green = [
  { name: 'Cargo Fmt - citadel-workspace-types', conclusion: 'success' },
  { name: 'Validation passed', conclusion: 'success' },
];
const record = (id, over = {}) => ({ run_id: String(id), event: 'pull_request', tree: TREE, sha: 'd'.repeat(40), ...over });
const facts = (over = {}) => ({
  event: 'push',
  ref: 'refs/heads/master',
  sha: SHA,
  repo: REPO,
  masterTree: TREE,
  pulls: [pull()],
  runs: [vrun(5)],
  evidence: new Map([[5, { record: record(5), jobs: green }]]),
  ...over,
});

test('skips only when the merged PR validated exactly this tree with every job green', () => {
  const d = decide(facts());
  assert.equal(d.validated, true);
  assert.equal(d.run, 5);
  assert.match(d.reason, /PR #219's run 5/);
});

test('a manual dispatch, or a branch, always validates', () => {
  assert.equal(decide(facts({ event: 'workflow_dispatch' })).validated, false);
  assert.equal(decide(facts({ ref: 'refs/heads/feature' })).validated, false);
});

test('a direct push with no merged PR validates', () => {
  assert.equal(decide(facts({ pulls: [] })).validated, false);
  assert.equal(decide(facts({ pulls: [pull({ merge_commit_sha: 'e'.repeat(40) })] })).validated, false);
  assert.equal(decide(facts({ pulls: [pull({ merged_at: null })] })).validated, false);
  assert.equal(decide(facts({ pulls: [pull(), pull({ number: 220 })] })).validated, false);
});

test('master having moved since the PR run (a different tree) validates', () => {
  const d = decide(facts({ masterTree: 'f'.repeat(40) }));
  assert.equal(d.validated, false);
  assert.match(d.reason, /validated tree c+, master's is f+/);
});

test('a fork PR validates, whatever its runs say', () => {
  const d = decide(facts({ pulls: [pull({ head: { sha: HEAD, repo: { full_name: 'someone/fork' } } })] }));
  assert.equal(d.validated, false);
});

test('any job not green validates, including a skipped or cancelled one', () => {
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
    const jobs = [...green, { name: 'Integration Test - test:crud', conclusion }];
    const d = decide(facts({ evidence: new Map([[5, { record: record(5), jobs }]]) }));
    assert.equal(d.validated, false, String(conclusion));
  }
});

test('a run without the aggregate job, or with no jobs, validates', () => {
  const only = [{ name: 'Cargo Fmt - x', conclusion: 'success' }];
  assert.equal(decide(facts({ evidence: new Map([[5, { record: record(5), jobs: only }]]) })).validated, false);
  assert.equal(decide(facts({ evidence: new Map([[5, { record: record(5), jobs: [] }]]) })).validated, false);
});

test('a missing record, or one naming another run or event, validates', () => {
  for (const rec of [null, record(4), record(5, { event: 'workflow_call' })]) {
    assert.equal(decide(facts({ evidence: new Map([[5, { record: rec, jobs: green }]]) })).validated, false);
  }
});

test('runs that are not the PR head, not validate.yml, not this repo, or not green are ignored', () => {
  for (const over of [
    { head_sha: 'e'.repeat(40) },
    { path: '.github/workflows/other.yml' },
    { event: 'push' },
    { conclusion: 'failure' },
    { head_repository: { full_name: 'someone/fork' } },
  ]) {
    assert.equal(decide(facts({ runs: [vrun(5, over)] })).validated, false, JSON.stringify(over));
  }
});

test('an older run can prove the tree when a newer one does not', () => {
  const d = decide(
    facts({
      runs: [vrun(5), vrun(6)],
      evidence: new Map([
        [6, { record: record(6, { tree: 'f'.repeat(40) }), jobs: green }],
        [5, { record: record(5), jobs: green }],
      ]),
    }),
  );
  assert.equal(d.validated, true);
  assert.equal(d.run, 5);
});

test('malformed object names validate', () => {
  assert.equal(decide(facts({ masterTree: '' })).validated, false);
  assert.equal(decide(facts({ sha: 'abc' })).validated, false);
});
