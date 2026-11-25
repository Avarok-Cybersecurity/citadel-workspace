import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareProblems, npmTreeProblems } from './npm-tree.mjs';

test('problems are read with the repository path taken out, deduplicated and sorted', () => {
  const json = { problems: ['invalid: @types/node@22.19.7 /r/node_modules/@types/node', 'missing: x@1, required by y@2', 'invalid: @types/node@22.19.7 /r/node_modules/@types/node'] };
  assert.deepEqual(npmTreeProblems(json, '/r'), ['invalid: @types/node@22.19.7 <repo>/node_modules/@types/node', 'missing: x@1, required by y@2']);
  assert.deepEqual(npmTreeProblems({}, '/r'), []);
});

test('a problem not in the baseline is new, and a baseline entry no longer seen is fixed', () => {
  const baseline = ['invalid: a', 'invalid: b'];
  assert.deepEqual(compareProblems(['invalid: a', 'missing: c'], baseline), { added: ['missing: c'], fixed: ['invalid: b'] });
  assert.deepEqual(compareProblems(baseline, baseline), { added: [], fixed: [] });
});
