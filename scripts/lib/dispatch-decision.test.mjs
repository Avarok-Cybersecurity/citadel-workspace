import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classify, decide, dispatchVerified, expectedTitle, matchingRuns } from './dispatch-decision.mjs';

const SHA = 'a'.repeat(40);
const SINCE = '2026-11-22T10:00:00Z';
const TITLE = `Deploy ${SHA}`;
const LIMITS = { dispatches: 3, pollsPerWindow: 3, pollSeconds: 5 };
const runOf = (id, over = {}) => ({
  id, event: 'workflow_dispatch', display_title: TITLE, created_at: '2026-11-22T10:00:07Z', html_url: `https://x/${id}`, ...over,
});
const timeout = () => Object.assign(new Error('Post "https://api.github.com/...": dial tcp 140.82.112.6:443: i/o timeout'));
const http = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

/** A fake GitHub: `script` is what each POST does; the run is listed `lag` listings after it lands. */
function fakeGitHub({ script, lag = 1, existing = [] }) {
  const runs = [...existing];
  const pending = [];
  const calls = { posts: 0, lists: 0, sleeps: 0 };
  const io = {
    list: async () => {
      calls.lists += 1;
      for (const p of pending) p.wait -= 1;
      while (pending.length && pending[0].wait <= 0) runs.push(pending.shift().run);
      return [...runs];
    },
    post: async () => {
      const outcome = script[calls.posts] ?? 'ok';
      calls.posts += 1;
      if (outcome === 'ok' || outcome === 'landed-then-timeout') pending.push({ wait: lag, run: runOf(100 + calls.posts) });
      if (outcome === 'landed-then-timeout' || outcome === 'timeout') throw timeout();
      if (typeof outcome === 'number') throw http(outcome);
    },
    sleep: async () => { calls.sleeps += 1; },
    log: () => {},
  };
  return { io, calls };
}

test('the title is rendered from the workflow run-name, and an unpredictable one refuses', () => {
  const wf = 'name: Deploy\nrun-name: Deploy ${{ inputs.sha || github.sha }}\non:\n';
  assert.equal(expectedTitle(wf, { sha: SHA }), TITLE);
  assert.throws(() => expectedTitle('name: Deploy\n', { sha: SHA }), /no `run-name:`/);
  assert.throws(() => expectedTitle('run-name: Deploy ${{ github.actor }}\n', { sha: SHA }), /cannot be predicted/);
  assert.throws(() => expectedTitle(wf, {}), /needs input sha/);
});

test('only dispatched runs of this title, since the step began, match', () => {
  const runs = [
    runOf(1), runOf(2, { event: 'push' }), runOf(3, { display_title: 'Deploy b' }),
    runOf(4, { created_at: '2026-11-22T09:59:59Z' }),
  ];
  assert.deepEqual(matchingRuns(runs, { title: TITLE, since: SINCE }).map((r) => r.id), [1]);
  assert.throws(() => matchingRuns(runs, { title: TITLE, since: 'yesterday' }), /not a timestamp/);
});

test('network errors, timeouts and 5xx are transient; a 4xx is fatal', () => {
  assert.equal(classify(timeout()), 'transient');
  assert.equal(classify(http(502)), 'transient');
  assert.equal(classify(http(429)), 'transient');
  assert.equal(classify(http(422)), 'fatal');
  assert.equal(classify(new Error('something nobody anticipated')), 'fatal');
});

test('a clean dispatch is posted once and returns the listed run', async () => {
  const { io, calls } = fakeGitHub({ script: ['ok'] });
  assert.deepEqual(await dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS), { id: 101, url: 'https://x/101' });
  assert.equal(calls.posts, 1);
});

test('a run already dispatched is found and nothing is posted', async () => {
  const { io, calls } = fakeGitHub({ script: [], existing: [runOf(7)] });
  assert.equal((await dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS)).id, 7);
  assert.equal(calls.posts, 0);
});

test('negative control: the POST reports failure but the run exists, so there is no second dispatch', async () => {
  const { io, calls } = fakeGitHub({ script: ['landed-then-timeout'], lag: 2 });
  assert.equal((await dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS)).id, 101);
  assert.equal(calls.posts, 1);
});

test('a POST that timed out without landing is retried only after a full window shows nothing', async () => {
  const { io, calls } = fakeGitHub({ script: ['timeout', 'ok'] });
  assert.equal((await dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS)).id, 102);
  assert.equal(calls.posts, 2);
  assert.ok(calls.sleeps >= LIMITS.pollsPerWindow, 'the first window was waited out before the second POST');
});

test('two runs for the same commit are refused as ambiguous', async () => {
  const { io, calls } = fakeGitHub({ script: [], existing: [runOf(7), runOf(8)] });
  await assert.rejects(dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS), /2 runs match \(7, 8\)/);
  assert.equal(calls.posts, 0);
});

test('a 4xx is fatal at once; transient failures are bounded', async () => {
  const fatal = fakeGitHub({ script: [422] });
  await assert.rejects(dispatchVerified(fatal.io, { title: TITLE, since: SINCE }, LIMITS), /the API refused/);
  assert.equal(fatal.calls.posts, 1);
  const flaky = fakeGitHub({ script: ['timeout', 'timeout', 'timeout', 'ok'] });
  await assert.rejects(dispatchVerified(flaky.io, { title: TITLE, since: SINCE }, LIMITS), /3 dispatches failed/);
  assert.equal(flaky.calls.posts, 3);
});

test('an accepted dispatch that never appears fails instead of dispatching again', async () => {
  const { io, calls } = fakeGitHub({ script: ['ok'], lag: 99 });
  await assert.rejects(dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS), /no matching run appeared within 15s/);
  assert.equal(calls.posts, 1);
});

test('nothing is dispatched while the runs cannot be listed', async () => {
  const io = { list: async () => { throw timeout(); }, post: async () => assert.fail('posted blind'), sleep: async () => {}, log: () => {} };
  await assert.rejects(dispatchVerified(io, { title: TITLE, since: SINCE }, LIMITS), /not dispatching blind/);
  assert.equal(decide([], { dispatches: 1, polls: 3, cleanLists: 0, lastError: { kind: 'transient', message: 'x' } }, LIMITS).do, 'fail');
});
