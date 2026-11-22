import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  STAMP_MAX_AGE_MS, blobId, decide, drivesABrowser, envInKey, localImports, parseStamp, stampKey,
  stampRecord, stampedLine, stampsOff, worldDigest,
} from './preflight-stamp.mjs';

const gate = { cmd: 'npm', args: ['run', 'check:a11y'], cwd: 'citadel-workspaces', env: { POLISH_ENGINES: 'chromium' } };

test('a blob id is the one git computes', () => {
  const git = execFileSync('git', ['hash-object', '--stdin'], { input: 'hello\n', encoding: 'utf8' }).trim();
  assert.equal(blobId('hello\n'), git);
});

test('the world digest ignores order and refuses an ambiguous entry', () => {
  assert.equal(worldDigest([['a', '1'], ['b', '2']]), worldDigest([['b', '2'], ['a', '1']]));
  assert.notEqual(worldDigest([['a', '1']]), worldDigest([['a', '2']]));
  assert.throws(() => worldDigest([['a', '1'], ['a', '1']]), /twice/);
  assert.throws(() => worldDigest([['a\nb', '1']]), /newline/);
});

test('a gate key changes with the world, the argv, the directory and the gate env', () => {
  const base = stampKey('w', gate);
  assert.equal(stampKey('w', { ...gate }), base);
  assert.notEqual(stampKey('w2', gate), base);
  assert.notEqual(stampKey('w', { ...gate, args: ['run', 'check:mobile'] }), base);
  assert.notEqual(stampKey('w', { ...gate, cwd: '.' }), base);
  assert.notEqual(stampKey('w', { ...gate, env: { POLISH_ENGINES: 'chromium,webkit' } }), base);
});

test('the env in the key leaves out only what git and the shell set per hook', () => {
  const env = { SWEEP_PORT: '4199', GIT_INDEX_FILE: '/x', GIT_EXEC_PATH: '/y', PWD: '/a', SHLVL: '2', PATH: '/bin', GITHUB_TOKENISH: 'k' };
  assert.deepEqual(envInKey(env).map(([k]) => k), ['GITHUB_TOKENISH', 'PATH', 'SWEEP_PORT']);
});

test('stamps are off on --tier full and on PREFLIGHT_NO_STAMP=1, and any other value is an error', () => {
  assert.equal(stampsOff('pre-push', {}), null);
  assert.match(stampsOff('full', {}), /--tier full/);
  assert.match(stampsOff('pre-commit', { PREFLIGHT_NO_STAMP: '1' }), /PREFLIGHT_NO_STAMP=1/);
  assert.throws(() => stampsOff('pre-commit', { PREFLIGHT_NO_STAMP: 'yes' }), /set it to 1/);
});

test('only a fresh stamp skips, and only for a stampable gate', () => {
  const now = 1_000_000_000_000;
  const record = stampRecord('k', 'run check:a11y', 'pre-commit (UI repo)', now - 60_000, 110_500);
  const d = (input) => decide({ unreadable: null, now, ...input });
  assert.deepEqual(d({ stampable: false, record }), { run: true, why: null });
  assert.equal(d({ stampable: true, record: null }).run, true);
  assert.equal(d({ stampable: true, record: { ...record, passedAt: now - STAMP_MAX_AGE_MS - 1 } }).run, true);
  assert.deepEqual(d({ stampable: true, record }), { run: false, record });
});

test('a stamp that cannot be read, or is dated in the future, runs the gate and says why', () => {
  const now = 1_000_000_000_000;
  const record = stampRecord('k', 'g', 'pre-push', now - 60_000, 1);
  assert.deepEqual(decide({ stampable: true, record: null, unreadable: 'not JSON', now }),
    { run: true, why: 'its stamp is unreadable (not JSON)', warn: true });
  const future = decide({ stampable: true, record: { ...record, passedAt: now + 60_000 }, unreadable: null, now });
  assert.equal(future.run, true);
  assert.equal(future.warn, true);
});

test('a stored stamp must be exactly what was written', () => {
  const r = stampRecord('k', 'g', 'pre-push', 1, 2);
  assert.deepEqual(parseStamp(JSON.stringify(r), 'k', 'p'), r);
  assert.throws(() => parseStamp('{', 'k', 'p'), /not JSON/);
  assert.throws(() => parseStamp(JSON.stringify(r), 'other', 'p'), /wrong key/);
  assert.throws(() => parseStamp(JSON.stringify({ ...r, passedAt: 'x' }), 'k', 'p'), /malformed/);
  assert.equal(parseStamp(JSON.stringify({ ...r, format: 0 }), 'k', 'p'), null);
});

test('the stamped line names when and where it passed', () => {
  const line = stampedLine(stampRecord('k', 'g', 'pre-push (UI repo)', 0, 110_500), 5 * 60_000);
  assert.match(line, /^ok \(stamped: passed \d{4}-\d\d-\d\d \d\d:\d\d, 5 min ago, in pre-push \(UI repo\); 110\.5s not re-run\)$/);
});

test('a browser gate is recognised by what it imports, and its local imports are followed', () => {
  assert.equal(drivesABrowser("import { chromium, webkit } from 'playwright';"), true);
  assert.equal(drivesABrowser("import AxeBuilder from '@axe-core/playwright';"), true);
  assert.equal(drivesABrowser("spawn('npx', ['vite', 'preview', '--port'])"), true);
  assert.equal(drivesABrowser("import { readFileSync } from 'node:fs'; // mentions playwright in prose"), false);
  assert.deepEqual(localImports("import { a } from './lib/x.mjs';\nimport './side.mjs';\nconst m = await import('../y.mjs');\nimport b from 'pkg';"),
    ['./lib/x.mjs', './side.mjs', '../y.mjs']);
});
