/**
 * A tenant object's metered usage in its own SQLite storage: one row per billing period, holding
 * that period's absolute totals (meter.mjs `snapshot`). Written on the flush alarm and when the
 * last socket closes, never per frame: each write is a billed row.
 */

/** Periods kept in the object; the monitor copies each into D1 long before it would be pruned. */
const KEEP_PERIODS = 24;
const FIELDS = [
  "period_end", "bytes_in", "bytes_out", "frames_in", "active_seconds", "peak_connections",
  "relayed_p2p_bytes", "group_fanout_bytes", "turn_bytes", "turn_refused_bytes",
  "app_egress_bytes", "app_relay_ihttp_bytes",
];
/** Columns added after the table first shipped: an object made before them gains them, at 0. */
const ADDED = [
  "relayed_p2p_bytes", "group_fanout_bytes", "turn_bytes", "turn_refused_bytes", "app_egress_bytes", "app_relay_ihttp_bytes",
];

export class UsageTable {
  constructor(sql) {
    this.sql = sql;
    sql.exec(
      "CREATE TABLE IF NOT EXISTS quota_usage (period_start INTEGER PRIMARY KEY, period_end INTEGER NOT NULL, " +
        "bytes_in INTEGER NOT NULL, bytes_out INTEGER NOT NULL, frames_in INTEGER NOT NULL, " +
        "active_seconds INTEGER NOT NULL, peak_connections INTEGER NOT NULL, updated_at INTEGER NOT NULL)",
    );
    const have = new Set([...sql.exec("PRAGMA table_info(quota_usage)")].map((c) => c.name));
    // A period measured before a column existed had none of it counted: 0 is what was counted.
    for (const column of ADDED) {
      if (!have.has(column)) sql.exec(`ALTER TABLE quota_usage ADD COLUMN ${column} INTEGER NOT NULL DEFAULT 0`);
    }
  }

  load(periodStart) {
    return [...this.sql.exec("SELECT * FROM quota_usage WHERE period_start = ?", periodStart)][0] ?? null;
  }

  save(snapshot, nowMs) {
    const values = FIELDS.map((f) => snapshot[f]);
    this.sql.exec(
      `INSERT INTO quota_usage (period_start, ${FIELDS.join(", ")}, updated_at) VALUES (?, ${FIELDS.map(() => "?").join(", ")}, ?) ` +
        `ON CONFLICT (period_start) DO UPDATE SET ${FIELDS.map((f) => `${f} = excluded.${f}`).join(", ")}, updated_at = excluded.updated_at`,
      snapshot.period_start,
      ...values,
      Math.floor(nowMs / 1000),
    );
    this.sql.exec(
      "DELETE FROM quota_usage WHERE period_start NOT IN (SELECT period_start FROM quota_usage ORDER BY period_start DESC LIMIT ?)",
      KEEP_PERIODS,
    );
  }

  /** The newest `n` periods, newest first. */
  recent(n) {
    return [...this.sql.exec("SELECT * FROM quota_usage ORDER BY period_start DESC LIMIT ?", n)];
  }
}
