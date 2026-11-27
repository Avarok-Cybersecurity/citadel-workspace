/**
 * One heavy hook at a time on a machine: the decisions. Pure; the reads and writes are in hook-lock.mjs.
 *
 * Two parent hooks at once took ~50 minutes each, one after the other ~25 (REL-1124). A lock is
 * held by a process; it is LIVE while that process exists AND is the same process that took it:
 * a PID alone is not enough, because the OS reuses PIDs, and a reused PID would keep a dead
 * holder's lock alive forever. So the owner record carries the holder's start time as the OS
 * reports it, and liveness is PID plus start time.
 */

/** A lock directory with no owner record is being created; only after this long is it abandoned. */
export const OWNERLESS_GRACE_MS = 60 * 1000;

/**
 * @typedef {{ token: string, pid: number, start: string, what: string, since: number }} LockOwner
 *   start: the holder's process start time as `ps -o lstart=` prints it ('' where ps cannot say)
 */

/**
 * Whether a held lock may be broken.
 * @param {{ owner: LockOwner|null, ageMs: number, startOfPid: string|null }} seen
 *   owner: the record (null when the directory has none yet); ageMs: the directory's age;
 *   startOfPid: the start time of the process now holding owner.pid, or null when no such process
 * @returns {{ stale: false, why: string } | { stale: true, why: string }}
 */
export function lockVerdict({ owner, ageMs, startOfPid }) {
  if (owner === null) {
    return ageMs > OWNERLESS_GRACE_MS
      ? { stale: true, why: `the lock has had no owner record for ${Math.round(ageMs / 1000)} s (its taker died taking it)` }
      : { stale: false, why: 'the lock is being taken' };
  }
  if (startOfPid === null) return { stale: true, why: `its holder, pid ${owner.pid}, is not running` };
  // An owner that could not read its own start time can only be judged by PID: never broken while that PID lives.
  if (owner.start === '' || startOfPid === '') return { stale: false, why: `held by pid ${owner.pid} (${owner.what})` };
  if (startOfPid !== owner.start) return { stale: true, why: `pid ${owner.pid} now belongs to another process (started ${startOfPid}, the holder started ${owner.start})` };
  return { stale: false, why: `held by pid ${owner.pid} since ${new Date(owner.since).toISOString()} (${owner.what})` };
}

/** @param {unknown} value @returns {LockOwner|null} null for anything that is not exactly an owner record */
export function parseOwner(value) {
  if (value === null || typeof value !== 'object') return null;
  const o = /** @type {Record<string, unknown>} */ (value);
  const ok = typeof o.token === 'string' && Number.isInteger(o.pid) && typeof o.start === 'string'
    && typeof o.what === 'string' && Number.isFinite(o.since);
  return ok ? /** @type {LockOwner} */ (o) : null;
}

/**
 * Whether another tool's lock directory (one that names its holder's PID in a `pid` file) holds this
 * run back. It does unless it is free, or its holder is one of this process's ancestors: a run wrapped
 * by that tool (`hook-lock.sh run LANE git push`) already holds it, and waiting for it would wait
 * for itself. A holder that is gone still holds it back: that tool's lock is broken by a human only.
 * @param {{ exists: boolean, holderPid: number|null, ancestors: number[] }} seen
 * @returns {boolean}
 */
export function foreignLockHolds({ exists, holderPid, ancestors }) {
  if (!exists) return false;
  return holderPid === null || !ancestors.includes(holderPid);
}

/** One line of the lock's time log: when, what, how long it waited and ran, and its status. */
export function timesRow({ at, what, root, waitedMs, ranMs, status }) {
  const s = (ms) => `${Math.round(ms / 1000)}s`;
  return `${new Date(at).toISOString()}\t${what}\t${root}\twaited ${s(waitedMs)}\tran ${s(ranMs)}\t${status}\n`;
}

/**
 * Waiters take the lock in the order they arrived. Polling alone let whichever waiter looked first
 * after a release take it, so a commit waited 31+ minutes while two later pushes went ahead of it.
 * Each waiter files a ticket named by its arrival; only the earliest live ticket may take the lock.
 * @param {number} arrivedMs @param {string} token @returns {string}
 */
export function ticketName(arrivedMs, token) {
  if (!Number.isInteger(arrivedMs) || arrivedMs < 0) throw new Error('ticketName: arrivedMs must be a time');
  return `${String(arrivedMs).padStart(16, '0')}-${token}.json`;
}

/**
 * Whose turn it is, and which tickets to clear: a ticket whose waiter is gone is never waited for.
 * @param {{ name: string, live: boolean }[]} tickets
 * @returns {{ first: string|null, dead: string[] }}
 */
export function queueTurn(tickets) {
  const live = tickets.filter((t) => t.live).map((t) => t.name).sort();
  return { first: live[0] ?? null, dead: tickets.filter((t) => !t.live).map((t) => t.name) };
}

/**
 * Whether a ticket's waiter is alive: the same PID-plus-start rule as a lock holder (lockVerdict).
 * @param {{ pid: number, start: string }|null} ticket null when unreadable (a ticket is written whole, by rename)
 * @param {string|null} startOfPid
 */
export function ticketLive(ticket, startOfPid) {
  if (ticket === null || startOfPid === null) return false;
  return ticket.start === '' || startOfPid === '' || ticket.start === startOfPid;
}
