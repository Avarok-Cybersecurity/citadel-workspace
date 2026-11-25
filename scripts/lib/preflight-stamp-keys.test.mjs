/**
 * What a stamp key covers, over real repositories (preflight-stamp-fixture.mjs). Each negative
 * control changes ONE input and asserts the stamp no longer matches; each positive one changes
 * something that is not an input and asserts it still does. A key that misses an input is a
 * false green, so every input class named in the REL-1124 brief has its own control here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { planStamps, recordPasses } from './preflight-stamp-io.mjs';
import { pathWithoutGitExecPath, stampScope, worldDifferences } from './preflight-stamp.mjs';
import { ENV, fixture, put } from './preflight-stamp-fixture.mjs';

const gates = (root) => ({
  // A UI gate keyed over the whole world, and the agent's cargo suite keyed over the agent's inputs.
  a11y: { name: 'run check:a11y', cmd: 'npm', args: ['run', 'check:a11y'], cwd: join(root, 'citadel-workspaces'), env: {}, tiers: new Set(['ui']), script: 'citadel-workspaces/scripts/check-a11y.mjs' },
  cargo: { name: 'rust internal-service workspace tests', cmd: 'cargo', args: ['test', '--workspace'], cwd: join(root, 'citadel-internal-service'), env: {}, tiers: new Set(['rust:agent']) },
});

/** Stamps both gates as passed under `env`; returns which of them the next hook (under `next`) re-runs. */
function afterChange(f, change, env = ENV, next = env) {
  const dir = join(f.base, 'stamps');
  const { a11y, cargo } = gates(f.root);
  const plan = (e) => planStamps({ root: f.root, checks: [a11y, cargo], tier: 'pre-push', env: e, dir, now: Date.now() });
  const first = plan(env);
  recordPasses({ root: f.root, env, dir, world: first.world, hook: 'pre-push', now: Date.now(), passes: first.plan.map((p) => ({ key: p.key, name: p.check.name, ms: 1 })) });
  assert.deepEqual(plan(env).plan.map((p) => p.decision.run), [false, false], 'both must start stamped, or the controls prove nothing');
  change(f.root);
  const [ui, agent] = plan(next).plan.map((p) => p.decision.run);
  return { ui, agent };
}

const inputs = [
  ['the gate script alone', (r) => appendFileSync(join(r, 'citadel-workspaces', 'scripts', 'check-a11y.mjs'), '// x\n'), { ui: true, agent: false }],
  ['a module the gate imports alone', (r) => appendFileSync(join(r, 'citadel-workspaces', 'scripts', 'lib', 'harness.mjs'), '// x\n'), { ui: true, agent: false }],
  // The key is not an import closure: it is every file of the checkout and its submodules (tracked,
  // and untracked unless ignored), so what a gate reads by any route is in it.
  ['a config file the gate reads alone', (r) => appendFileSync(join(r, 'citadel-workspaces', 'vite.config.ts'), '// x\n'), { ui: true, agent: false }],
  ['a script the gate only spawns', (r) => appendFileSync(join(r, 'citadel-workspaces', 'scripts', 'lib', 'spawned.mjs'), '// x\n'), { ui: true, agent: false }],
  ['a module the gate imports dynamically', (r) => appendFileSync(join(r, 'citadel-workspaces', 'scripts', 'lib', 'dynamic.mjs'), '// x\n'), { ui: true, agent: false }],
  ['the tracked lockfile alone', (r) => put(join(r, 'package-lock.json'), '{"lockfileVersion":3,"x":1}'), { ui: true, agent: false }],
  ['the content the UI gate judges', (r) => put(join(r, 'citadel-workspaces', 'dist', 'index.html'), '<html>rebuilt</html>'), { ui: true, agent: false }],
  ['the content the agent suite judges', (r) => appendFileSync(join(r, 'citadel-internal-service', 'src', 'lib.rs'), '// x\n'), { ui: true, agent: true }],
  ['the installed browser builds', (r) => put(join(r, 'node_modules', 'playwright-core', 'browsers.json'), '{"browsers":[{"name":"chromium","revision":"9"}]}'), { ui: true, agent: true }],
];
for (const [what, change, want] of inputs) {
  test(`negative control: ${what} re-runs exactly the gates that read it`, () => {
    const f = fixture();
    try {
      assert.deepEqual(afterChange(f, change), want);
    } finally { f.done(); }
  });
}

test('negative control: a different cargo on the same PATH re-runs the cargo suite', () => {
  const f = fixture();
  try {
    const bin = join(f.base, 'bin');
    const cargo = (v) => { put(join(bin, 'cargo'), `#!/bin/sh\necho "cargo ${v}"\n`); chmodSync(join(bin, 'cargo'), 0o755); };
    cargo('1.99.0');
    const env = { ...ENV, PATH: `${bin}:${ENV.PATH}` };
    assert.equal(afterChange(f, () => cargo('1.100.0'), env).agent, true);
  } finally { f.done(); }
});

for (const name of ['CARGO_PROFILE_TEST_OPT_LEVEL', 'CARGO_PROFILE_DEV_DEBUG', 'RUSTFLAGS', 'NODE_OPTIONS', 'CI', 'CITADEL_DEPLOY']) {
  test(`negative control: ${name} is an input, so setting it re-runs both gates`, () => {
    const f = fixture();
    try {
      assert.deepEqual(afterChange(f, () => {}, ENV, { ...ENV, [name]: '1' }), { ui: true, agent: true });
    } finally { f.done(); }
  });
}

test("git's own hook variables are not inputs: a tier run by hand and the hook inside git share stamps", () => {
  const f = fixture();
  try {
    const inGit = { ...ENV, PATH: `/opt/git/libexec/git-core:${ENV.PATH}`, GIT_EXEC_PATH: '/opt/git/libexec/git-core', GIT_PREFIX: '',
      GIT_INDEX_FILE: '.git/index', GIT_SSH_COMMAND: 'ssh -o ServerAliveInterval=30', GIT_PUSH_OPTION_COUNT: '1', GIT_PUSH_OPTION_0: 'x', PREFLIGHT_PRE_PUSH: 'run' };
    assert.deepEqual(afterChange(f, () => {}, ENV, inGit), { ui: false, agent: false });
  } finally { f.done(); }
});

test('only the PATH entry equal to GIT_EXEC_PATH is dropped, and only when git set it', () => {
  assert.equal(pathWithoutGitExecPath('/g:/usr/bin:/g2', '/g'), '/usr/bin:/g2');
  assert.equal(pathWithoutGitExecPath('/g:/usr/bin', undefined), '/g:/usr/bin');
  assert.equal(pathWithoutGitExecPath('/usr/bin:/bin', '/g'), '/usr/bin:/bin');
});

test('a check that reads the checkout itself or the remote is never stamped', () => {
  assert.equal(stampScope({ tiers: new Set(['env']) }, ''), null);
  assert.equal(stampScope({ tiers: new Set(['push']) }, ''), null);
  assert.equal(stampScope({ tiers: new Set(['rust:agent']) }, 'citadel-internal-service'), 'agent');
  assert.equal(stampScope({ tiers: new Set(['parent']) }, 'citadel-internal-service-x'), 'world', 'a sibling name is not the agent');
});

test('a miss names what moved since the last tier run', () => {
  const before = [['env:CARGO_PROFILE_TEST_OPT_LEVEL', '1'], ['file:a', 'x'], ['file:gone', 'y']];
  const after = [['env:CARGO_PROFILE_TEST_OPT_LEVEL', '0'], ['file:a', 'x'], ['file:new', 'z']];
  assert.deepEqual(worldDifferences(before, after, 8), ['env:CARGO_PROFILE_TEST_OPT_LEVEL', 'file:gone (gone)', 'file:new (new)']);
  assert.equal(worldDifferences(before, after, 1).length, 1);
});
