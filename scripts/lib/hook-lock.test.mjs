/**
 * The machine-wide hook lock, over a real directory and real processes: no mocks. The holder of a
 * lock in these tests is a real child process, so "alive", "gone" and "a reused PID" are the OS's
 * own answers, not stubs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquire, processStart } from './hook-lock.mjs';
import { OWNERLESS_GRACE_MS, foreignLockHolds, lockVerdict, parseOwner } from './hook-lock-rules.mjs';

const owner = (o) => ({ token: 't', pid: 42, start: 'Mon Nov 25 00:00:00 2026', what: 'x', since: 0, ...o });

test('a holder that is alive and started when the lock says is never stale', () => {
  assert.equal(lockVerdict({ owner: owner(), ageMs: 1e9, startOfPid: 'Mon Nov 25 00:00:00 2026' }).stale, false);
});

test('a holder whose PID is gone is stale', () => {
  assert.equal(lockVerdict({ owner: owner(), ageMs: 0, startOfPid: null }).stale, true);
});

test('a PID that now belongs to a process started at another time is a reused PID: stale', () => {
  const v = lockVerdict({ owner: owner(), ageMs: 0, startOfPid: 'Tue Nov 26 09:00:00 2026' });
  assert.equal(v.stale, true);
  assert.match(v.why, /another process/);
});

test('where the start time cannot be read, a live PID is never broken', () => {
  assert.equal(lockVerdict({ owner: owner({ start: '' }), ageMs: 1e9, startOfPid: 'anything' }).stale, false);
  assert.equal(lockVerdict({ owner: owner(), ageMs: 1e9, startOfPid: '' }).stale, false);
});

test('a lock without an owner record is being taken until the grace period ends', () => {
  assert.equal(lockVerdict({ owner: null, ageMs: OWNERLESS_GRACE_MS - 1, startOfPid: null }).stale, false);
  assert.equal(lockVerdict({ owner: null, ageMs: OWNERLESS_GRACE_MS + 1, startOfPid: null }).stale, true);
});

test('an owner record that is not exactly one is no owner', () => {
  assert.equal(parseOwner(owner()) !== null, true);
  for (const bad of [null, 1, {}, owner({ pid: '42' }), owner({ start: 3 })]) assert.equal(parseOwner(bad), null);
});

/** A real holder process, and a lock directory written for it as acquire() would. */
function held(base, { start } = {}) {
  const child = spawn('sleep', ['30'], { stdio: 'ignore' });
  const lock = join(base, 'hook.lock');
  mkdirSync(lock);
  const real = processStart(child.pid);
  assert.ok(real, 'ps must report the child, or these tests prove nothing');
  writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token: 'holder', pid: child.pid, start: start ?? real, what: 'test holder', since: Date.now() }));
  return { child, lock };
}

const settle = async (promise) => ((await promise) === null ? 'still waiting' : 'acquired');
const quiet = () => {};

test('a live holder is waited for, and its lock is untouched', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const { child, lock } = held(base);
  try {
    const before = readFileSync(join(lock, 'owner.json'), 'utf8');
    assert.equal(await settle(acquire({ lock, what: 'waiter', say: quiet, waitMs: 20, deadline: Date.now() + 400, honour: null })), 'still waiting');
    assert.equal(readFileSync(join(lock, 'owner.json'), 'utf8'), before, 'the holder still owns it');
  } finally { child.kill(); rmSync(base, { recursive: true, force: true }); }
});

test('a reused PID (alive, other start time) is stale: the lock is taken by rename', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const { child, lock } = held(base, { start: 'Thu Jan  1 00:00:00 1970' });
  try {
    const release = await acquire({ lock, what: 'waiter', say: quiet, waitMs: 20, deadline: Date.now() + 10_000, honour: null });
    assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).pid, process.pid);
    release();
    assert.equal(existsSync(lock), false, 'release removes it');
  } finally { child.kill(); rmSync(base, { recursive: true, force: true }); }
});

test('a holder that died is stale: the next waiter takes the lock', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const { child, lock } = held(base);
  try {
    child.kill();
    await new Promise((r) => child.on('exit', r));
    const release = await acquire({ lock, what: 'waiter', say: quiet, waitMs: 20, deadline: Date.now() + 10_000, honour: null });
    assert.equal(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')).what, 'waiter');
    release();
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('a breaker that died mid-break leaves the lock to a human: never broken twice', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const { child, lock } = held(base, { start: 'Thu Jan  1 00:00:00 1970' });
  try {
    mkdirSync(`${lock}.break`);
    const said = [];
    assert.equal(await settle(acquire({ lock, what: 'waiter', say: (l) => said.push(l), waitMs: 20, deadline: Date.now() + 300, honour: null })), 'still waiting');
    assert.match(said.join('\n'), /remove it by hand/);
  } finally { child.kill(); rmSync(base, { recursive: true, force: true }); }
});

test('an ownerless lock inside the grace period is waited for, after it is taken', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const lock = join(base, 'hook.lock');
  mkdirSync(lock);
  try {
    assert.equal(await settle(acquire({ lock, what: 'waiter', say: quiet, waitMs: 20, deadline: Date.now() + 200, honour: null })), 'still waiting');
    const old = (Date.now() - OWNERLESS_GRACE_MS - 5000) / 1000;
    utimesSync(lock, old, old);
    const release = await acquire({ lock, what: 'waiter', say: quiet, waitMs: 20, deadline: Date.now() + 10_000, honour: null });
    release();
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test('acquire refuses a missing wait interval rather than spinning', async () => {
  await assert.rejects(acquire({ lock: join(tmpdir(), 'never'), what: 'x', say: quiet, deadline: Infinity, honour: null }), /waitMs/);
  await assert.rejects(acquire({ lock: join(tmpdir(), 'never'), what: 'x', say: quiet, waitMs: 5 }), /deadline/);
});

test("another tool's lock holds a run back unless its holder is this run's own ancestor", () => {
  assert.equal(foreignLockHolds({ exists: false, holderPid: null, ancestors: [] }), false);
  assert.equal(foreignLockHolds({ exists: true, holderPid: 7, ancestors: [3, 7] }), false, 'wrapped by it: it is ours');
  assert.equal(foreignLockHolds({ exists: true, holderPid: 7, ancestors: [3] }), true);
  assert.equal(foreignLockHolds({ exists: true, holderPid: null, ancestors: [3] }), true, 'unreadable holder: wait, never guess');
});

test("a run waits for the honoured stop-gap lock held by another lane, and passes it when it wraps this run", async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-'));
  const stopGap = join(base, 'stop-gap.lock'); // not 'HOOK.lock': macOS would fold it onto hook.lock
  const other = spawn('sleep', ['30'], { stdio: 'ignore' });
  try {
    mkdirSync(stopGap);
    writeFileSync(join(stopGap, 'pid'), `${other.pid}\n`);
    writeFileSync(join(stopGap, 'owner'), 'OTHER-LANE pid x :: git push');
    const lock = join(base, 'hook.lock');
    assert.equal(await settle(acquire({ lock, what: 'w', say: quiet, waitMs: 20, deadline: Date.now() + 300, honour: stopGap })), 'still waiting');
    assert.equal(existsSync(lock), false, 'it did not take its own lock while the other lane held the stop-gap');
    writeFileSync(join(stopGap, 'pid'), `${process.ppid}\n`);
    const release = await acquire({ lock, what: 'w', say: quiet, waitMs: 20, deadline: Date.now() + 10_000, honour: stopGap });
    assert.ok(release, 'wrapped by the stop-gap (its holder is an ancestor): proceeds');
    release();
    assert.equal(existsSync(stopGap), true, 'the stop-gap lock is never touched');
  } finally { other.kill(); rmSync(base, { recursive: true, force: true }); }
});
