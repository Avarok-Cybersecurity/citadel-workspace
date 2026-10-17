import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitStatus, planMerges, verdictLines } from './merge-plan.mjs';
import { decideParentRef, fallbackBranch, pushedBranch } from './parent-ref.mjs';

const pr = (number, baseRefName, extra = {}) => ({ number, baseRefName, headRefName: `b${number}`, isCrossRepository: false, ...extra });

test('only pull requests into the base merge, in number order; stacked and fork PRs are reported', () => {
  const { include, excluded } = planMerges([pr(9, 'master'), pr(3, 'master'), pr(5, 'feat/x'), pr(7, 'master', { isCrossRepository: true })], 'master');
  assert.deepEqual(include.map((p) => p.number), [3, 9]);
  assert.deepEqual(excluded.map((p) => [p.number, p.reason]), [[5, "stacked on 'feat/x', not 'master'"], [7, 'from a fork; its head is not fetched']]);
});

test('a conflict with the base says CI never starts; a collision says which list it hit', () => {
  const lines = verdictLines([
    { number: 1, headRefName: 'a', alone: 'clean', together: 'merged', files: [] },
    { number: 2, headRefName: 'b', alone: 'conflict', together: 'skipped', files: ['x.ts'] },
    { number: 3, headRefName: 'c', alone: 'clean', together: 'conflict', files: ['y.ts'] },
  ], [], { ran: 4, failed: ['file length'] });
  assert.match(lines[0], /merged\s+#1 a/);
  assert.match(lines[1], /CONFLICT\s+#2 b .*no pull_request run.*x\.ts/);
  assert.match(lines[2], /COLLIDES\s+#3 c .*earlier PR.*y\.ts/);
  assert.match(lines.at(-1), /FAILS 1 of 4 fast-tier checks: file length/);
});

test('the exit status is red on any conflict or a failing combination, green otherwise', () => {
  const clean = [{ alone: 'clean', together: 'merged' }];
  assert.equal(exitStatus(clean, { failed: [] }), 0);
  assert.equal(exitStatus(clean, null), 0);
  assert.equal(exitStatus(clean, { failed: ['x'] }), 1);
  assert.equal(exitStatus([{ alone: 'conflict', together: 'skipped' }], null), 1);
});

const base = { branch: 'feat/x', fallback: 'master', fallbackSha: 'f'.repeat(40) };

test('CI takes the same-name parent branch when the remote has it', () => {
  const d = decideParentRef({ ...base, remoteSha: 'a'.repeat(40), local: null });
  assert.deepEqual([d.verdict, d.ref, d.sha], ['ok', 'feat/x', 'a'.repeat(40)]);
});

test('CI falls back to PARENT_BRANCH when the parent has no such branch anywhere', () => {
  const d = decideParentRef({ ...base, remoteSha: null, local: null });
  assert.deepEqual([d.verdict, d.ref, d.sha], ['ok', 'master', 'f'.repeat(40)]);
});

test('a same-name local parent branch not on the remote refuses the push', () => {
  const d = decideParentRef({ ...base, remoteSha: null, local: { sha: 'b'.repeat(40), ahead: Number.NaN } });
  assert.equal(d.verdict, 'refuse');
  assert.match(d.why, /not on its remote.*Push the parent first/s);
});

test('a same-name local parent branch ahead of its remote refuses the push', () => {
  const d = decideParentRef({ ...base, remoteSha: 'a'.repeat(40), local: { sha: 'b'.repeat(40), ahead: 2 } });
  assert.equal(d.verdict, 'refuse');
  assert.match(d.why, /2 commit\(s\) ahead/);
});

test('a local parent branch level with its remote is fine', () => {
  const d = decideParentRef({ ...base, remoteSha: 'a'.repeat(40), local: { sha: 'a'.repeat(40), ahead: 0 } });
  assert.equal(d.verdict, 'ok');
});

test('PARENT_BRANCH must be a literal in the UI workflow env', () => {
  assert.equal(fallbackBranch({ PARENT_BRANCH: 'master' }), 'master');
  assert.throws(() => fallbackBranch({}), /no literal PARENT_BRANCH/);
  assert.throws(() => fallbackBranch({ PARENT_BRANCH: '${{ vars.X }}' }), /no literal/);
});

test('pre-push lines: a branch push is read, a deletion and a tag are not', () => {
  assert.deepEqual(pushedBranch(`refs/heads/a ${'1'.repeat(40)} refs/heads/a ${'0'.repeat(40)}`), { branch: 'a', localRef: 'refs/heads/a', sha: '1'.repeat(40) });
  assert.equal(pushedBranch(`(delete) ${'0'.repeat(40)} refs/heads/a ${'2'.repeat(40)}`), null);
  assert.equal(pushedBranch(`refs/tags/v1 ${'1'.repeat(40)} refs/tags/v1 ${'0'.repeat(40)}`), null);
});
