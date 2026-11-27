import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { selectChecks } from './change-tiers.mjs';
import { derivedHookChecks } from './preflight-derived.mjs';
import { PRE_PUSH_COMMAND, checkoutProblem, noRefsMessage, pushMode, unstampedChecks, verifyFailure } from './preflight-push.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');
const HEAD = 'a'.repeat(40);

test('the hook verifies unless the tier command asked it to run, and nothing else is accepted', () => {
  assert.equal(pushMode(undefined), 'verify');
  assert.equal(pushMode('run'), 'run');
  assert.throws(() => pushMode('1'), /only node scripts\/pre-push-tier\.mjs/);
});

test('the checkout stands for the push only when every pushed ref is HEAD and nothing tracked is edited', () => {
  assert.equal(checkoutProblem({ refs: [{ localRef: 'refs/heads/x', localSha: HEAD }], head: HEAD, trackedChanges: [] }), null);
  assert.equal(checkoutProblem({ refs: [{ localRef: 'refs/heads/gone', localSha: '0'.repeat(40) }], head: HEAD, trackedChanges: [] }), null, 'a deletion sends nothing');
  assert.match(checkoutProblem({ refs: [{ localRef: 'refs/heads/other', localSha: 'b'.repeat(40) }], head: HEAD, trackedChanges: [] }), /refs\/heads\/other.*but the checkout is at/s);
  assert.match(checkoutProblem({ refs: [{ localRef: 'refs/heads/x', localSha: HEAD }], head: HEAD, trackedChanges: ['src/a.ts'] }), /tracked files differ from HEAD \(src\/a\.ts\)/);
});

test('verify passes only when every keyed check is stamped; unkeyed checks (env, push) run in the hook', () => {
  const p = (name, key, run) => ({ check: { name }, key, decision: { run } });
  assert.deepEqual(unstampedChecks([p('a', 'k1', false), p('pointers pushed', null, true)]), []);
  assert.deepEqual(unstampedChecks([p('a', 'k1', true), p('b', 'k2', false)]), ['a']);
});

test('the refusals name the one command, and say nothing was pushed', () => {
  assert.match(noRefsMessage(), new RegExp(PRE_PUSH_COMMAND.replace(/[.]/g, '\\.')));
  const m = verifyFailure({ missing: ['unit tests'], differences: ['env:CARGO_PROFILE_DEV_DEBUG'], off: null });
  assert.match(m, /Nothing was pushed/);
  assert.match(m, /env:CARGO_PROFILE_DEV_DEBUG/);
  assert.ok(m.includes(PRE_PUSH_COMMAND));
});

// The proof that taking gates out of pre-commit weakened nothing, over the REAL gate list derived
// from validate.yml: for every top-level directory of this repository, every gate pre-commit would
// have run before (or runs now) is selected by pre-push for the same change.
test('every gate the pre-commit tier leaves out is selected by pre-push for the same paths', () => {
  const { checks } = derivedHookChecks(ROOT);
  const left = checks.filter((c) => c.tiers.has('not-pre-commit'));
  assert.ok(left.some((c) => c.relevance?.browser), 'the browser gates must be among them, or this proves nothing');
  const asIfOnPreCommit = checks.map((c) => ({ ...c, tiers: new Set([...c.tiers].filter((t) => t !== 'not-pre-commit')) }));
  for (const top of ['citadel-workspaces', 'citadel-workspace-client-ts', 'docs', 'scripts', '.github', 'apps', 'citadel-internal-service', 'Cargo.lock', 'package-lock.json']) {
    const paths = [`${top}/x`];
    const wouldHaveRun = new Set(selectChecks(asIfOnPreCommit, 'pre-commit', paths, []).map((c) => c.name));
    const nowRuns = new Set(selectChecks(checks, 'pre-commit', paths, []).map((c) => c.name));
    const atPush = new Set(selectChecks(checks, 'pre-push', paths, []).map((c) => c.name));
    for (const name of wouldHaveRun) {
      if (!nowRuns.has(name)) assert.ok(atPush.has(name), `${name}: left out of pre-commit for ${top}/, and pre-push does not run it`);
    }
  }
});

test('a UI change still selects every browser gate at pre-push, and none at pre-commit', () => {
  const { checks } = derivedHookChecks(ROOT);
  const browser = checks.filter((c) => c.relevance?.browser).map((c) => c.name);
  const paths = ['citadel-workspaces/src/App.tsx'];
  const at = (hook) => new Set(selectChecks(checks, hook, paths, []).map((c) => c.name));
  assert.deepEqual(browser.filter((n) => !at('pre-push').has(n)), []);
  assert.deepEqual(browser.filter((n) => at('pre-commit').has(n)), []);
});
