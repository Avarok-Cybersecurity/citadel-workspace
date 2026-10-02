// Negative controls for the Mac-pool fork guard: each shape that would let a
// fork's pull request run on the self-hosted Mac must turn the gate red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { judge, OPT_IN, SAME_REPO_GUARD, POOL } from './mac-runner-routing.mjs';

const ROUTE = `\${{ ${OPT_IN} && ${SAME_REPO_GUARD} && ${POOL} || 'ubuntu-latest' }}`;
const wf = (on, runsOn, extra = '') => `name: t
on:
${on}
jobs:
  build:
    timeout-minutes: 5
    runs-on: ${runsOn}
${extra}    steps:
      - run: echo hi
`;
const one = (source, name = 'ci.yml') => judge([{ name, source }]);

test('the accepted expression passes under pull_request', () => {
  const r = one(wf('  pull_request:', ROUTE));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.routed, ['ci.yml:build']);
});

test('a folded runs-on is read as the same expression', () => {
  const folded = `>-\n      \${{ ${OPT_IN}\n        && ${SAME_REPO_GUARD}\n        && ${POOL}\n        || 'ubuntu-latest' }}`;
  assert.deepEqual(one(wf('  pull_request:', folded)).problems, []);
});

test('a matrix leg may be routed alone and fall back to its own label', () => {
  const leg = `\${{ matrix.os == 'macos-latest' && ${OPT_IN} && ${SAME_REPO_GUARD} && ${POOL} || matrix.os }}`;
  assert.deepEqual(one(wf('  pull_request:', leg)).problems, []);
});

test('NEGATIVE: the pool without the same-repo guard is refused', () => {
  const r = one(wf('  pull_request:', `\${{ ${OPT_IN} && ${POOL} || 'ubuntu-latest' }}`));
  assert.equal(r.problems.length, 1);
  assert.match(r.problems[0], /ci\.yml:build names the Mac pool without/);
});

test('NEGATIVE: a bare self-hosted label list is refused', () => {
  assert.equal(one(wf('  pull_request:', '[self-hosted, macOS, ARM64, apple-48gb-metal]')).problems.length, 1);
});

test('NEGATIVE: no opt-in variable means no hosted escape hatch', () => {
  const r = one(wf('  push:', `\${{ ${SAME_REPO_GUARD} && ${POOL} || 'ubuntu-latest' }}`));
  assert.equal(r.problems.length, 1);
});

test('NEGATIVE: a fallback that is itself the pool is refused', () => {
  const r = one(wf('  pull_request:', ROUTE.replace("'ubuntu-latest'", "'self-hosted'")));
  assert.match(r.problems.join('\n'), /falls back to 'self-hosted'/);
});

test('NEGATIVE: the pool smuggled through a matrix value is refused', () => {
  const matrix = '    strategy:\n      matrix:\n        os: [ubuntu-latest, self-hosted]\n';
  const r = one(wf('  pull_request:', '${{ matrix.os }}', matrix));
  assert.match(r.problems.join('\n'), /in its matrix/);
});

test('NEGATIVE: pull_request_target defeats the guard and is refused', () => {
  const r = one(wf('  pull_request_target:', ROUTE));
  assert.match(r.problems.join('\n'), /triggered by pull_request_target/);
});

test('NEGATIVE: an inline unsafe trigger is seen too', () => {
  assert.equal(one(wf('', ROUTE).replace('on:\n\n', 'on: [push, issue_comment]\n')).problems.length, 1);
});

test('NEGATIVE: calling a routed reusable workflow from workflow_run is refused', () => {
  const callee = { name: 'validate.yml', source: wf('  workflow_call:', ROUTE) };
  const caller = { name: 'after.yml', source: 'on:\n  workflow_run:\n    workflows: [x]\njobs:\n  v:\n    uses: ./.github/workflows/validate.yml\n' };
  assert.match(judge([callee, caller]).problems.join('\n'), /after\.yml:v calls validate\.yml/);
});

test('prose that mentions the pool is not routing', () => {
  const steps = '    steps:\n      - name: Nothing reaches the self-hosted Mac\n        run: echo apple-48gb-metal\n';
  assert.deepEqual(one(wf('  pull_request:', 'ubuntu-latest').replace(/    steps:\n[^]*$/, steps)).problems, []);
});

test('a commented-out self-hosted job is not a job', () => {
  const src = wf('  pull_request:', 'ubuntu-latest') + '  # heavy:\n  #   runs-on: [self-hosted, heavy-tests]\n';
  const r = one(src);
  assert.deepEqual(r.problems, []);
  assert.equal(r.jobs, 1);
});
