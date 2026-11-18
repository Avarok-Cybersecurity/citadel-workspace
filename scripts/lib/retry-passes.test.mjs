// The shape of production run 44137617709, shard 1: a serial block where one
// test failed, the tests before it re-ran and passed, and the tests after it
// were skipped on the first attempt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retryPasses } from './retry-passes.mjs';

const attempt = (status) => ({ status });
const spec = (title, status, statuses) => ({ title, file: 'a11y.spec.ts', tests: [{ status, results: statuses.map(attempt) }] });
const report = (...specs) => ({ suites: [{ file: 'a11y.spec.ts', suites: [{ specs }] }] });

test('a test whose first attempt failed is flaky', () => {
  const { flaky, rerun } = retryPasses(report(spec('skip link', 'flaky', ['failed', 'passed'])));
  assert.deepEqual(flaky, [{ title: 'skip link', file: 'a11y.spec.ts', attempts: 2, failed: 1 }]);
  assert.deepEqual(rerun, []);
});

test('a timed-out first attempt is a failure too', () => {
  assert.equal(retryPasses(report(spec('slow', 'flaky', ['timedOut', 'passed']))).flaky.length, 1);
});

test('a serial block re-running a test that passed both times is not flaky', () => {
  const { flaky, rerun } = retryPasses(report(spec('workspace shell', 'expected', ['passed', 'passed'])));
  assert.deepEqual(flaky, []);
  assert.deepEqual(rerun, [{ title: 'workspace shell', file: 'a11y.spec.ts', attempts: 2 }]);
});

test('a test skipped behind the failure, then passed, is not flaky', () => {
  const { flaky, rerun } = retryPasses(report(spec('file manager', 'flaky', ['skipped', 'passed'])));
  assert.deepEqual(flaky, []);
  assert.equal(rerun.length, 1);
});

test('the run that prompted this: one flaky, the rest re-run', () => {
  const { flaky, rerun } = retryPasses(report(
    spec('workspace shell', 'expected', ['passed', 'passed']),
    spec('skip link', 'flaky', ['failed', 'passed']),
    spec('headings', 'flaky', ['skipped', 'passed']),
  ));
  assert.deepEqual(flaky.map((f) => f.title), ['skip link']);
  assert.deepEqual(rerun.map((f) => f.title), ['workspace shell', 'headings']);
});

test('a single passing attempt is neither', () => {
  assert.deepEqual(retryPasses(report(spec('once', 'expected', ['passed']))), { flaky: [], rerun: [] });
});
