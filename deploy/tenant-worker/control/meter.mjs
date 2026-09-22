/**
 * What one tenant's object measures, per billing period: bytes and frames in, bytes out, the
 * seconds during which any socket was open, and the most sockets open at once. Pure: the object
 * reports each event with the time it happened (ms) and persists `snapshot()` itself
 * (usage-table.mjs); nothing here reads a clock or touches storage.
 *
 * Totals are absolute for their period, never deltas, so writing the same snapshot twice (an
 * alarm that runs twice) changes nothing.
 */

const EMPTY = { bytes_in: 0, bytes_out: 0, frames_in: 0, active_seconds: 0, peak_connections: 0 };

/** The UTC calendar month holding `nowMs`, as `{start, end}` in seconds. */
export function calendarMonth(nowMs) {
  const d = new Date(nowMs);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  return { start: start / 1000, end: end / 1000 };
}

/**
 * The period `nowMs` falls in: the Stripe period the entitlements carry, or the calendar month
 * when they carry none. A Stripe period that has ended before its renewal arrived is rolled on by
 * its own length; the renewal's `setEntitlements` then corrects the boundary.
 */
export function periodAt(entitlements, nowMs) {
  const start = entitlements?.period_start;
  const end = entitlements?.period_end;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start) return calendarMonth(nowMs);
  const now = Math.floor(nowMs / 1000);
  if (now < end) return { start, end };
  const length = end - start;
  const skipped = Math.floor((now - start) / length);
  return { start: start + skipped * length, end: start + (skipped + 1) * length };
}

export class Meter {
  /** `saved`: this period's totals as last persisted (an object restarted mid-period resumes them). */
  constructor(period, saved, nowMs) {
    this.period = period;
    this.totals = { ...EMPTY, ...pick(saved) };
    this.activeMs = this.totals.active_seconds * 1000;
    this.mark = nowMs;
    this.open = new Map();
  }

  get openCount() {
    return this.open.size;
  }

  /** Whether one more socket fits under `max`. */
  admits(max) {
    return this.open.size < max;
  }

  connect(id, nowMs) {
    this.#tick(nowMs);
    this.open.set(id, { n: id, frames: 0, bytes_in: 0, bytes_out: 0, opened_ms: nowMs });
    this.totals.peak_connections = Math.max(this.totals.peak_connections, this.open.size);
  }

  /** The connection's record, once; null for one already released (close and error both fire). */
  disconnect(id, nowMs) {
    const conn = this.open.get(id);
    if (!conn) return null;
    this.#tick(nowMs);
    this.open.delete(id);
    return { ...conn, open_ms: nowMs - conn.opened_ms };
  }

  inbound(id, bytes) {
    const conn = this.open.get(id);
    if (!conn) return;
    conn.frames += 1;
    conn.bytes_in += bytes;
    this.totals.frames_in += 1;
    this.totals.bytes_in += bytes;
  }

  outbound(id, bytes) {
    const conn = this.open.get(id);
    if (!conn) return;
    conn.bytes_out += bytes;
    this.totals.bytes_out += bytes;
  }

  /** The open connections' own counters, for the object's stats. */
  connections() {
    return [...this.open.values()];
  }

  /** This period's totals as of `nowMs`, keyed by the period, ready to persist. */
  snapshot(nowMs) {
    this.#tick(nowMs);
    return {
      period_start: this.period.start,
      period_end: this.period.end,
      ...this.totals,
      active_seconds: Math.floor(this.activeMs / 1000),
      connections: this.open.size,
    };
  }

  /**
   * Moves to `period`. The same period (perhaps with a corrected end) is adopted in place and
   * returns null. A later one closes this one: its final snapshot is returned for the caller to
   * persist, and counting starts again from the sockets still open. An earlier one (a stale
   * event) is ignored. Keyed on the start, so a second call with the same period resets nothing.
   */
  adopt(period, nowMs) {
    if (period.start === this.period.start) {
      this.period = period;
      return null;
    }
    if (period.start < this.period.start) return null;
    const closed = this.snapshot(nowMs);
    this.period = period;
    this.totals = { ...EMPTY, peak_connections: this.open.size };
    this.activeMs = 0;
    return closed;
  }

  #tick(nowMs) {
    if (this.open.size > 0 && nowMs > this.mark) this.activeMs += nowMs - this.mark;
    this.mark = Math.max(this.mark, nowMs);
  }
}

function pick(saved) {
  if (!saved) return {};
  return Object.fromEntries(Object.keys(EMPTY).map((k) => [k, Number(saved[k] ?? 0)]));
}
