import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixCommand, lockDirs, staleLockIn, verdict } from './lockfile-completeness.mjs';

// Both wordings, verbatim: cargo 1.100 (run 45010060046) and the older one.
const NEW = 'error: cannot update the lock file /w/tools/telemetry-read/Cargo.lock because --locked was passed to prevent this\nhelp: to generate the lock file without accessing the network, remove the --locked flag and use --offline instead.\n';
const OLD = 'error: the lock file /w/tools/coupon-admin/Cargo.lock needs to be updated but --locked was passed to prevent this\nIf you want to try to generate the lock file without accessing the network, remove the --locked flag and use --offline instead.\n';

test('every tracked Cargo.lock names its directory, the root as "."', () => {
  assert.deepEqual(lockDirs('tools/b/Cargo.lock\0Cargo.lock\0apps/a/Cargo.lock\0'), ['.', 'apps/a', 'tools/b']);
  assert.deepEqual(lockDirs('tools/b/Cargo.lock.bak\0tools/b/NotCargo.lock\0'), []);
  assert.deepEqual(lockDirs(''), []);
});

test("cargo's stale-lock refusal is recognised in both wordings, and names the lock", () => {
  assert.equal(staleLockIn(NEW), '/w/tools/telemetry-read/Cargo.lock');
  assert.equal(staleLockIn(OLD), '/w/tools/coupon-admin/Cargo.lock');
});

test('negative control: other cargo errors are not called stale', () => {
  assert.equal(staleLockIn('error: failed to download `jiff-static v0.2.38`\nCaused by: attempting to make an HTTP request, but --offline was specified'), null);
  assert.equal(staleLockIn('error: failed to parse lock file at: /w/Cargo.lock'), null);
  assert.equal(staleLockIn(''), null);
});

test('the fix is a workspace-only update of that manifest', () => {
  assert.equal(fixCommand('tools/telemetry-read'), 'cargo update --workspace --manifest-path tools/telemetry-read/Cargo.toml');
  assert.equal(fixCommand('.'), 'cargo update --workspace --manifest-path Cargo.toml');
});

const ok = { dir: 'tools/t', status: 0, stderr: '', workspaceRoot: '/w/tools/t', absDir: '/w/tools/t' };

test('a lock cargo resolves at its own workspace root is complete', () => {
  assert.deepEqual(verdict(ok), { ok: true });
});

test('a stale lock fails, naming the file and the exact fix', () => {
  const v = verdict({ ...ok, status: 101, stderr: NEW, workspaceRoot: null });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'stale');
  assert.equal(v.lock, 'tools/t/Cargo.lock');
  assert.match(v.message, /fix: cargo update --workspace --manifest-path tools\/t\/Cargo\.toml/);
});

test('negative control: a resolve that succeeds against an OUTER workspace is not proof', () => {
  const v = verdict({ ...ok, workspaceRoot: '/w' });
  assert.equal(v.ok, false);
  assert.equal(v.kind, 'unused');
});

test('negative control: any other failure, or a cargo that never started, fails as unjudged', () => {
  for (const r of [{ status: 101, stderr: 'error: failed to load manifest' }, { status: null, stderr: 'spawn cargo ENOENT' }, { status: 101, stderr: '' }]) {
    const v = verdict({ ...ok, ...r, workspaceRoot: null });
    assert.equal(v.ok, false, JSON.stringify(r));
    assert.equal(v.kind, 'error');
    assert.match(v.message, /could not judge tools\/t\/Cargo\.lock/);
  }
});
