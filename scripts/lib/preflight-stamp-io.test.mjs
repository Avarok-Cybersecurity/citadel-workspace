/**
 * The world key over real git repositories in a temp directory: no mocks. Each negative control
 * changes one input and asserts the stamp no longer matches.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, chmodSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertOutsideGit, planStamps, recordPasses, scriptDrivesABrowser } from './preflight-stamp-io.mjs';
import { readWorld } from './preflight-world-io.mjs';
import { ENV, digest, fixture, put, sh } from './preflight-stamp-fixture.mjs';
import { STAMP_FORMAT } from './preflight-stamp.mjs';

test('the same tree gives the same key, whether a file is clean, staged or dirty', () => {
  const f = fixture();
  try {
    const a = digest(f.root);
    assert.equal(digest(f.root), a);
    const p = join(f.root, 'citadel-workspaces', 'scripts', 'check-static.mjs');
    appendFileSync(p, '// x\n');
    const dirty = digest(f.root);
    assert.notEqual(dirty, a);
    sh(join(f.root, 'citadel-workspaces'), 'add', '.');
    assert.equal(digest(f.root), dirty, 'staging a file must not change its key');
    sh(join(f.root, 'citadel-workspaces'), 'commit', '-qm', 'c');
    assert.equal(digest(f.root), dirty, 'committing it must not either (a pointer bump is not an input)');
    sh(f.root, 'add', 'citadel-workspaces');
    assert.equal(digest(f.root), dirty, 'nor staging the parent pointer');
  } finally { f.done(); }
});

const controls = [
  ['one byte of a dist file', (r) => appendFileSync(join(r, 'citadel-workspaces', 'dist', 'index.html'), ' ')],
  ['a tracked harness script', (r) => appendFileSync(join(r, 'citadel-workspaces', 'scripts', 'lib', 'harness.mjs'), ' ')],
  ['an untracked file', (r) => put(join(r, 'citadel-workspaces', 'scripts', 'lib', 'new.mjs'), 'x')],
  ['the installed playwright version', (r) => put(join(r, 'node_modules', 'playwright', 'package.json'), '{"version":"1.58.0"}')],
  ['the browser revision', (r) => put(join(r, 'node_modules', 'playwright-core', 'browsers.json'), '{"browsers":[{"name":"chromium","revision":"1201"}]}')],
  ['the npm install record', (r) => put(join(r, 'node_modules', '.package-lock.json'), '{}')],
  ['a .env file vite loads', (r) => put(join(r, 'citadel-workspaces', '.env.local'), 'VITE_X=1')],
  ['a deleted tracked file', (r) => rmSync(join(r, 'citadel-workspaces', 'scripts', 'check-static.mjs'))],
];
for (const [what, change] of controls) {
  test(`negative control: ${what} misses the stamp`, () => {
    const f = fixture();
    try {
      const before = digest(f.root);
      change(f.root);
      assert.notEqual(digest(f.root), before);
    } finally { f.done(); }
  });
}

test('negative control: an env var misses the stamp, a per-hook git variable does not', () => {
  const f = fixture();
  try {
    const before = digest(f.root);
    assert.notEqual(digest(f.root, { ...ENV, SWEEP_PORT: '4200' }), before);
    assert.equal(digest(f.root, { ...ENV, GIT_EXEC_PATH: '/elsewhere' }), before);
  } finally { f.done(); }
});

test('a nested untracked repository cannot be keyed, so stamps go off rather than guess', () => {
  const f = fixture();
  try {
    sh(f.root, 'init', '-q', 'stray');
    put(join(f.root, 'stray', 'a'), 'a'); sh(join(f.root, 'stray'), 'add', '.'); sh(join(f.root, 'stray'), 'commit', '-qm', 's');
    assert.match(readWorld(f.root, ENV).unkeyable, /nested repository/);
  } finally { f.done(); }
});

test('a file whose edits git is told to ignore cannot be keyed, so stamps go off rather than guess', () => {
  for (const flag of ['--assume-unchanged', '--skip-worktree']) {
    const f = fixture();
    try {
      const ui = join(f.root, 'citadel-workspaces');
      sh(ui, 'update-index', flag, 'scripts/check-static.mjs');
      appendFileSync(join(ui, 'scripts', 'check-static.mjs'), '// hidden from diff-files\n');
      assert.match(readWorld(f.root, ENV).unkeyable ?? '', /assume-unchanged or skip-worktree/, flag);
    } finally { f.done(); }
  }
});

test('a browser gate is found through its import closure; a static gate is not', () => {
  const f = fixture();
  try {
    assert.equal(scriptDrivesABrowser(f.root, 'citadel-workspaces/scripts/check-a11y.mjs'), true);
    assert.equal(scriptDrivesABrowser(f.root, 'citadel-workspaces/scripts/check-static.mjs'), false);
  } finally { f.done(); }
});

test('the stamp store must be outside every git tree', () => {
  const f = fixture();
  try {
    assert.throws(() => assertOutsideGit(join(f.root, 'stamps')), /inside the git tree/);
    assert.doesNotThrow(() => assertOutsideGit(join(f.base, 'stamps')));
  } finally { f.done(); }
});

test('end to end: a pass is stamped, the next hook skips it, any input change runs it again', () => {
  const f = fixture();
  try {
    const dir = join(f.base, 'stamps');
    const a11y = { name: 'run check:a11y', cmd: 'npm', args: ['run', 'check:a11y'], cwd: join(f.root, 'citadel-workspaces'), env: {}, tiers: new Set(['ui']), script: 'citadel-workspaces/scripts/check-a11y.mjs' };
    const lint = { name: 'static', cmd: 'node', args: ['scripts/check-static.mjs'], cwd: join(f.root, 'citadel-workspaces'), env: {}, tiers: new Set(['ui']), script: 'citadel-workspaces/scripts/check-static.mjs' };
    const plan = (tier, env = ENV) => planStamps({ root: f.root, checks: [a11y, lint], tier, env, dir, now: Date.now() });
    const first = plan('pre-commit');
    assert.deepEqual(first.plan.map((p) => p.decision.run), [true, true]);
    assert.notEqual(first.plan[1].key, null, 'a static gate is keyed too');
    const note = recordPasses({ root: f.root, env: ENV, dir, world: first.world, hook: 'pre-commit (UI repo)', now: Date.now(),
      passes: [{ key: first.plan[0].key, name: a11y.name, ms: 110_500 }] });
    assert.match(note, /1 pass\(es\) stamped/);
    assert.deepEqual(plan('pre-push').plan.map((p) => p.decision.run), [false, true], 'only the pass is stamped');
    assert.equal(plan('full').plan[0].decision.run, true);
    assert.equal(plan('pre-push', { ...ENV, PREFLIGHT_NO_STAMP: '1' }).plan[0].decision.run, true);
    appendFileSync(join(f.root, 'citadel-workspaces', 'dist', 'index.html'), '!');
    assert.equal(plan('pre-push').plan[0].decision.run, true);
  } finally { f.done(); }
});

/** A stamped a11y gate over the fixture, and a planner for the next hook. */
function stamped(f) {
  const dir = join(f.base, 'stamps');
  const a11y = { name: 'run check:a11y', cmd: 'npm', args: ['run', 'check:a11y'], cwd: join(f.root, 'citadel-workspaces'), env: {}, tiers: new Set(['ui']), script: 'citadel-workspaces/scripts/check-a11y.mjs' };
  const plan = () => planStamps({ root: f.root, checks: [a11y], tier: 'pre-push', env: ENV, dir, now: Date.now() }).plan[0];
  const first = planStamps({ root: f.root, checks: [a11y], tier: 'pre-commit', env: ENV, dir, now: Date.now() });
  recordPasses({ root: f.root, env: ENV, dir, world: first.world, hook: 'pre-commit', now: Date.now(), passes: [{ key: first.plan[0].key, name: a11y.name, ms: 1 }] });
  assert.equal(plan().decision.run, false, 'the fixture must start stamped, or the controls below prove nothing');
  return { dir, plan };
}

test('negative control: a change to the gate script itself runs the gate again', () => {
  const f = fixture();
  try {
    const { plan } = stamped(f);
    appendFileSync(join(f.root, 'citadel-workspaces', 'scripts', 'check-a11y.mjs'), '// edited\n');
    assert.equal(plan().decision.run, true);
  } finally { f.done(); }
});

test('negative control: a different rustc on the same PATH runs the gate again', () => {
  const f = fixture();
  try {
    const bin = join(f.base, 'bin');
    const rustc = (v) => { put(join(bin, 'rustc'), `#!/bin/sh\necho "rustc ${v}"\n`); chmodSync(join(bin, 'rustc'), 0o755); };
    const env = { ...ENV, PATH: `${bin}:${ENV.PATH}` };
    rustc('1.99.0');
    const before = digest(f.root, env);
    rustc('1.100.0');
    assert.notEqual(digest(f.root, env), before);
  } finally { f.done(); }
});

test('a corrupt stamp runs the gate (never a pass, never a crash) and a pass replaces it', () => {
  const f = fixture();
  try {
    const { dir, plan } = stamped(f);
    for (const junk of ['{', 'null', JSON.stringify({ format: STAMP_FORMAT, key: 'someone-else', gate: 'g', hook: 'h', passedAt: Date.now(), ms: 1 })]) {
      const [file] = readdirSync(dir).filter((n) => n.endsWith('.json'));
      writeFileSync(join(dir, file), junk);
      const p = plan();
      assert.equal(p.decision.run, true, `stamp '${junk}' must run the gate`);
      assert.match(p.decision.why, /unreadable/);
      recordPasses({ root: f.root, env: ENV, dir, world: readWorld(f.root, ENV), hook: 'pre-push', now: Date.now(), passes: [{ key: p.key, name: 'g', ms: 1 }] });
      assert.equal(plan().decision.run, false, 'the next pass overwrites the corrupt stamp');
    }
  } finally { f.done(); }
});

test('an unreadable stamp runs the gate and says why', { skip: process.getuid?.() === 0 && 'root reads a mode-000 file' }, () => {
  const f = fixture();
  try {
    const { dir, plan } = stamped(f);
    const [file] = readdirSync(dir).filter((n) => n.endsWith('.json'));
    chmodSync(join(dir, file), 0o000);
    const p = plan();
    chmodSync(join(dir, file), 0o644);
    assert.equal(p.decision.run, true);
    assert.match(p.decision.why, /unreadable/);
  } finally { f.done(); }
});

test('passes are not recorded when the tree changed while the gates ran', () => {
  const f = fixture();
  try {
    const dir = join(f.base, 'stamps');
    const world = readWorld(f.root, ENV);
    put(join(f.root, 'citadel-workspaces', 'written-by-a-gate.txt'), 'x');
    const note = recordPasses({ root: f.root, env: ENV, dir, world, hook: 'pre-push', now: Date.now(), passes: [{ key: 'k', name: 'g', ms: 1 }] });
    assert.match(note, /NOT recorded/);
  } finally { f.done(); }
});
