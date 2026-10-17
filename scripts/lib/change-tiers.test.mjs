import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crateOf, gateIsRelevant, readsWholeRepo, selectChecks, tiersFor } from './change-tiers.mjs';

const CRATES = ['citadel-workspace-server-kernel', 'citadel-workspace-types', 'citadel-workspace-server-kernel/tests/common'];

test('UI-only changes are the ui tier', () => {
  assert.deepEqual([...tiersFor(['citadel-workspaces/src/App.tsx'], CRATES)], ['ui']);
});

test('the client package is both UI input and a parent script target', () => {
  assert.deepEqual([...tiersFor(['citadel-workspace-client-ts/src/index.ts'], CRATES)].sort(), ['parent', 'ui']);
});

test('Rust in a root crate, and the root manifests, are rust:root', () => {
  assert.deepEqual([...tiersFor(['citadel-workspace-types/src/lib.rs'], CRATES)], ['rust:root']);
  assert.deepEqual([...tiersFor(['Cargo.lock'], CRATES)], ['rust:root']);
});

test('the agent submodule pointer is rust:agent', () => {
  assert.deepEqual([...tiersFor(['citadel-internal-service'], CRATES)], ['rust:agent']);
});

test('anything unrecognised checks more, never nothing', () => {
  assert.deepEqual([...tiersFor(['.github/workflows/validate.yml', 'tools/x/src/main.rs'], CRATES)], ['parent']);
});

test('a path belongs to the deepest crate containing it', () => {
  assert.equal(crateOf('citadel-workspace-server-kernel/tests/common/src/lib.rs', CRATES), 'citadel-workspace-server-kernel/tests/common');
  assert.equal(crateOf('citadel-workspace-server-kernel/src/lib.rs', CRATES), 'citadel-workspace-server-kernel');
  assert.equal(crateOf('docs/x.rs', CRATES), null);
});

test('a gate is relevant when its source names the top-level directory, or it is the changed file', () => {
  const gate = { script: 'scripts/check-x.mjs', source: "join(ROOT, 'citadel-workspaces', 'src')", cwdArea: null, wholeRepo: false };
  assert.equal(gateIsRelevant(gate, ['citadel-workspaces/src/a.ts']), true);
  assert.equal(gateIsRelevant(gate, ['citadel-workspace-types/src/lib.rs']), false);
  assert.equal(gateIsRelevant(gate, ['scripts/check-x.mjs']), true);
  assert.equal(gateIsRelevant({ ...gate, wholeRepo: true }, ['anything']), true);
  assert.equal(gateIsRelevant({ ...gate, source: '', cwdArea: 'citadel-workspaces' }, ['citadel-workspaces/x']), true);
});

test('a gate that lists every tracked file reads the whole repo', () => {
  assert.equal(readsWholeRepo("execFileSync('git', ['ls-files'])"), true);
  assert.equal(readsWholeRepo("readdirSync(join(ROOT, 'docs'))"), false);
});

const c = (name, tiers, relevance) => ({ name, tiers: new Set(tiers), relevance });
const CHECKS = [
  c('env', ['env']),
  c('pointers', ['push']),
  c('staged eslint', ['pre-commit-only']),
  c('ui static', ['ui'], { script: 's', source: 'citadel-workspaces', cwdArea: 'citadel-workspaces', wholeRepo: false }),
  c('parent static', ['parent'], { script: 'p', source: 'docs', cwdArea: null, wholeRepo: false }),
  c('vitest', ['ui']),
  c('slow static', ['ui', 'not-pre-commit'], { script: 'x', source: '', cwdArea: 'citadel-workspaces', wholeRepo: false }),
  c('clippy root', ['rust:root']),
  c('heavy bundle', []),
];
const names = (hook, paths) => selectChecks(CHECKS, hook, paths, CRATES).map((x) => x.name);

test('pre-commit: env, staged-file checks and relevant static gates only', () => {
  assert.deepEqual(names('pre-commit', ['citadel-workspaces/src/a.ts']), ['env', 'staged eslint', 'ui static']);
});

test('pre-push of a UI change: the ui tier and the push checks, no Rust, nothing heavy', () => {
  assert.deepEqual(names('pre-push', ['citadel-workspaces/src/a.ts']), ['env', 'pointers', 'ui static', 'vitest', 'slow static']);
});

test('pre-push of a Rust change runs that workspace and not the UI', () => {
  assert.deepEqual(names('pre-push', ['citadel-workspace-types/src/lib.rs']), ['env', 'pointers', 'clippy root']);
});

test('pre-push of a script change runs every parent gate', () => {
  assert.deepEqual(names('pre-push', ['scripts/check-new.mjs']), ['env', 'pointers', 'parent static']);
});

test('full runs everything but the staged-file variants', () => {
  assert.deepEqual(names('full', []), ['env', 'pointers', 'ui static', 'parent static', 'vitest', 'slow static', 'clippy root', 'heavy bundle']);
});
