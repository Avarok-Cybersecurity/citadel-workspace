/**
 * The hook lock is first come, first served, over real processes: a waiter that arrived later never
 * takes the lock ahead of one already waiting, however much more often it looks. Before the queue,
 * whichever waiter polled first after a release took it, and a commit waited 31+ minutes while two
 * later pushes went ahead of it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { queueTurn, ticketLive, ticketName } from './hook-lock-rules.mjs';

const LOCK_MODULE = fileURLToPath(new URL('./hook-lock.mjs', import.meta.url));

/** A real waiter: takes the lock polling every `waitMs`, writes its name and time, holds it `holdMs`. */
function waiter(lock, log, name, waitMs, holdMs) {
  const code = `
    import { appendFileSync } from 'node:fs';
    import { acquire } from ${JSON.stringify(LOCK_MODULE)};
    const release = await acquire({ lock: ${JSON.stringify(lock)}, what: ${JSON.stringify(name)}, say: (l) => console.log(l), waitMs: ${waitMs}, deadline: Date.now() + 60000, honour: null });
    appendFileSync(${JSON.stringify(log)}, ${JSON.stringify(name)} + '\\n');
    await new Promise((r) => setTimeout(r, ${holdMs}));
    release();`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  return { child, output: () => out, exited: new Promise((r) => child.on('exit', r)) };
}

const until = async (ok, what) => {
  for (const end = Date.now() + 20000; Date.now() < end; await new Promise((r) => setTimeout(r, 20))) if (ok()) return;
  throw new Error(`timed out waiting until ${what}`);
};

test('a later arrival that polls thirty times as often still waits for the earlier waiter', async () => {
  const base = mkdtempSync(join(tmpdir(), 'lock-fifo-'));
  const lock = join(base, 'hook.lock');
  const log = join(base, 'order');
  try {
    const holder = waiter(lock, log, 'holder', 20, 1500);
    await until(() => { try { return readFileSync(log, 'utf8').includes('holder'); } catch { return false; } }, 'the holder has it');
    const earlier = waiter(lock, log, 'earlier', 300, 50);
    await until(() => earlier.output().includes('hook lock: waiting'), 'the earlier waiter is waiting');
    const later = waiter(lock, log, 'later', 10, 50);
    await until(() => later.output().includes('hook lock: waiting'), 'the later waiter is waiting');
    await Promise.all([holder.exited, earlier.exited, later.exited]);
    assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'), ['holder', 'earlier', 'later']);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the earliest live ticket has the turn; a gone waiter's ticket is cleared, never waited for", () => {
  const a = ticketName(1000, 'a');
  const b = ticketName(2000, 'b');
  const c = ticketName(999, 'c');
  assert.deepEqual(queueTurn([{ name: b, live: true }, { name: a, live: true }]), { first: a, dead: [] });
  assert.deepEqual(queueTurn([{ name: c, live: false }, { name: b, live: true }, { name: a, live: true }]), { first: a, dead: [c] });
  assert.deepEqual(queueTurn([]), { first: null, dead: [] });
  assert.ok(ticketName(9_999, 'z') < ticketName(10_000, 'a'), 'arrival order is name order across digit counts');
});

test('a ticket is live by the same rule as a holder: PID present and the same start time', () => {
  assert.equal(ticketLive({ pid: 1, start: 'Mon' }, 'Mon'), true);
  assert.equal(ticketLive({ pid: 1, start: 'Mon' }, null), false, 'gone');
  assert.equal(ticketLive({ pid: 1, start: 'Mon' }, 'Tue'), false, 'a reused PID');
  assert.equal(ticketLive(null, 'Mon'), false, 'unreadable');
  assert.equal(ticketLive({ pid: 1, start: '' }, 'Tue'), true, 'start unknown: never cleared while the PID lives');
});
