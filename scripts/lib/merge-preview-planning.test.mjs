import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitStatus, planMerges, verdictLines } from './merge-plan.mjs';

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
