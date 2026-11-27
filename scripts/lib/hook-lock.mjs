/**
 * One heavy hook at a time on a machine: the edge. Every decision is hook-lock-rules.mjs's.
 *
 * The lock is a directory (mkdir is atomic) holding `owner.json`. A waiter prints who holds it and
 * waits. A lock is broken only when lockVerdict() calls it stale, and only by one breaker at a time:
 * the breaker takes `<lock>.break` (mkdir), reads the owner AGAIN, and moves the lock aside by
 * rename. Nothing but a breaker ever removes a lock it does not own, and breakers are serialised,
 * so the lock a breaker judged is the lock it moves: a live holder's lock is never broken. A
 * breaker that dies holding `.break` leaves it for a human (printed); it is never auto-broken.
 *
 * Waiters queue: each files a ticket in `<lock>.queue/`, and only the earliest live one may take
 * the lock (queueTurn), so a later arrival never passes an earlier waiter. A ticket whose waiter is
 * gone is cleared by whoever sees it.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { foreignLockHolds, lockVerdict, parseOwner, queueTurn, ticketLive, ticketName, timesRow } from './hook-lock-rules.mjs';

const SAY_EVERY_MS = 60 * 1000;

/** The start time of a running process as the OS reports it; null when no such process; '' where ps cannot say. */
export function processStart(pid) {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error.code === 'ESRCH') return null;
    // EPERM: it exists and belongs to someone else.
  }
  try {
    return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch (error) {
    // ps exits 1 for a PID that is gone between the two reads; anything else (no ps) cannot say.
    return error.status === 1 ? null : '';
  }
}

const readOr = (path, absent) => {
  try {
    return readFileSync(path, 'utf8').trim() || absent;
  } catch {
    return absent;
  }
};

/** This process's ancestors, nearest first, as ps reports them. */
function ancestors() {
  const out = [];
  for (let pid = process.ppid; pid > 1 && out.length < 64; ) {
    out.push(pid);
    let parent;
    try {
      parent = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    } catch {
      break;
    }
    if (!Number.isInteger(parent) || parent === pid) break;
    pid = parent;
  }
  return out;
}

/** Whether the honoured foreign lock (a directory with a `pid` file) holds this run back. */
function foreignHolds(dir) {
  let exists = true;
  let holderPid = null;
  try {
    statSync(dir);
  } catch {
    exists = false;
  }
  if (exists) {
    try {
      holderPid = Number(readFileSync(join(dir, 'pid'), 'utf8').trim());
      if (!Number.isInteger(holderPid)) holderPid = null;
    } catch {
      holderPid = null;
    }
  }
  return foreignLockHolds({ exists, holderPid, ancestors: exists ? ancestors() : [] });
}

function readOwner(lock) {
  try {
    return parseOwner(JSON.parse(readFileSync(join(lock, 'owner.json'), 'utf8')));
  } catch {
    return null;
  }
}

function ageMs(path) {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

function judge(lock) {
  const owner = readOwner(lock);
  return { owner, verdict: lockVerdict({ owner, ageMs: ageMs(lock), startOfPid: owner ? processStart(owner.pid) : null }) };
}

/** Moves a stale lock aside, serialised with every other breaker. @returns {string} what happened, for the log */
function breakIfStillStale(lock) {
  const guard = `${lock}.break`;
  try {
    mkdirSync(guard);
  } catch (error) {
    if (error.code === 'EEXIST') return `another waiter is breaking it (or died doing so: if ${guard} stays, remove it by hand)`;
    throw error;
  }
  try {
    const { owner, verdict } = judge(lock);
    if (!verdict.stale) return 'no longer stale';
    const aside = `${lock}.stale-${owner?.token ?? randomUUID()}`;
    renameSync(lock, aside);
    rmSync(aside, { recursive: true, force: true });
    return `broke a stale lock: ${verdict.why}`;
  } catch (error) {
    if (error.code === 'ENOENT') return 'released meanwhile';
    throw error;
  } finally {
    rmdirSync(guard);
  }
}

/** Files this waiter's ticket, written whole (a temporary name, then rename), named by arrival. */
function fileTicket(queue, token) {
  mkdirSync(queue, { recursive: true });
  const name = ticketName(Date.now(), token);
  const temporary = join(queue, `.${name}.tmp`);
  writeFileSync(temporary, JSON.stringify({ pid: process.pid, start: processStart(process.pid) ?? '' }));
  renameSync(temporary, join(queue, name));
  return join(queue, name);
}

function readTicket(path) {
  try {
    const t = JSON.parse(readFileSync(path, 'utf8'));
    return Number.isInteger(t.pid) && typeof t.start === 'string' ? t : null;
  } catch {
    return null;
  }
}

/** How many live waiters are ahead of `mine` (0: its turn); clears the tickets of waiters that are gone. */
function waitersAhead(queue, mine) {
  const names = readdirSync(queue).filter((n) => n.endsWith('.json') && !n.startsWith('.'));
  const tickets = names.map((name) => {
    const t = readTicket(join(queue, name));
    return { name, live: ticketLive(t, t === null ? null : processStart(t.pid)) };
  });
  const { first, dead } = queueTurn(tickets);
  for (const name of dead) rmSync(join(queue, name), { force: true });
  if (first === basename(mine)) return 0;
  return tickets.filter((t) => t.live && t.name < basename(mine)).length;
}

/**
 * Takes the lock, waiting while a live holder has it, until `deadline` (epoch ms; Infinity waits for good).
 * `honour`: another tool's lock directory to wait for as well (null for none); see foreignLockHolds.
 * @param {{ lock: string, what: string, say: (line: string) => void, waitMs: number, deadline: number, honour: string|null }} input
 * @returns {Promise<(() => void) & { waitedMs: number } | null>} release, or null when the deadline passed first
 */
export async function acquire({ lock, what, say, waitMs, deadline, honour }) {
  if (!Number.isFinite(waitMs) || waitMs <= 0) throw new Error('acquire: waitMs must be a positive number');
  if (typeof deadline !== 'number' || Number.isNaN(deadline)) throw new Error('acquire: deadline must be a time or Infinity');
  if (honour !== null && typeof honour !== 'string') throw new Error('acquire: honour must be a directory or null');
  mkdirSync(dirname(lock), { recursive: true });
  const token = randomUUID();
  const started = Date.now();
  const queue = `${lock}.queue`;
  let ticket = fileTicket(queue, token);
  const dropTicket = () => {
    rmSync(ticket, { force: true });
    process.off('exit', dropTicket);
  };
  process.on('exit', dropTicket);
  let said = -SAY_EVERY_MS;
  for (;;) {
    if (honour !== null && foreignHolds(honour)) {
      if (Date.now() - said >= SAY_EVERY_MS) {
        say(`hook lock: waiting for ${honour} (${readOr(join(honour, 'owner'), 'held')}; never broken from here)`);
        said = Date.now();
      }
      if (Date.now() + waitMs > deadline) { dropTicket(); return null; }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    // Cleared by mistake (it never should be): file again, at the back, and say so.
    if (!existsSync(ticket)) {
      say('hook lock: this waiter\'s ticket was cleared; queueing again');
      ticket = fileTicket(queue, token);
    }
    const ahead = waitersAhead(queue, ticket);
    if (ahead > 0) {
      if (Date.now() - said >= SAY_EVERY_MS) {
        say(`hook lock: waiting in line, ${ahead} waiter(s) arrived first (${queue})`);
        said = Date.now();
      }
      if (Date.now() + waitMs > deadline) { dropTicket(); return null; }
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      continue;
    }
    try {
      mkdirSync(lock);
      const start = processStart(process.pid) ?? '';
      writeFileSync(join(lock, 'owner.json'), JSON.stringify({ token, pid: process.pid, start, what, since: Date.now() }));
      dropTicket();
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
    const { verdict } = judge(lock);
    if (verdict.stale) say(`hook lock: ${breakIfStillStale(lock)}`);
    else if (Date.now() - said >= SAY_EVERY_MS) {
      say(`hook lock: waiting, ${verdict.why} (${lock})`);
      said = Date.now();
    }
    if (Date.now() + waitMs > deadline) { dropTicket(); return null; }
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  const waitedMs = Date.now() - started;
  const release = () => {
    if (readOwner(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
  };
  process.on('exit', release);
  // A signal ends a process without 'exit': release, then die of the same signal's status.
  for (const [signal, status] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.once(signal, () => { release(); process.exit(status); });
  }
  return Object.assign(release, { waitedMs });
}

/** Appends one row to the lock's time log beside the lock. */
export function logTimes(lock, row) {
  appendFileSync(join(dirname(lock), 'hook-times.tsv'), timesRow(row));
}
