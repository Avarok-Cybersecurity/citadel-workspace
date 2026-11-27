/**
 * Problem reports in D1 (migrations/0020_bug_reports.sql). Only Avarok reads them, through the
 * signed support API; nothing here is reachable from a tenant's object or a browser read.
 */
export const RETENTION_MS = 90 * 24 * 3600 * 1000;
const LIST_LIMIT = 100;

export class BugReportStore {
  constructor(db) {
    this.db = db;
  }

  /** Counts one send by `ipHash` in `hour`, dropping past hours: the count so far, this one included. */
  async countAttempt(ipHash, hour) {
    const [, counted] = await this.db.batch([
      this.db.prepare("DELETE FROM bug_report_attempts WHERE hour < ?").bind(hour),
      this.db
        .prepare(
          "INSERT INTO bug_report_attempts (ip_hash, hour, count) VALUES (?, ?, 1) " +
            "ON CONFLICT (ip_hash, hour) DO UPDATE SET count = count + 1 RETURNING count",
        )
        .bind(ipHash, hour),
    ]);
    return counted.results[0].count;
  }

  async insert({ id, tenant, surface, contact, body }, nowMs) {
    await this.db
      .prepare("INSERT INTO bug_reports (id, tenant, surface, contact, body, received_at_ms, expires_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, tenant, surface, contact, body, nowMs, nowMs + RETENTION_MS)
      .run();
  }

  /** The newest reports received after `sinceMs`, without bodies. */
  async list(sinceMs, nowMs) {
    const { results } = await this.db
      .prepare("SELECT id, tenant, surface, contact IS NOT NULL AS contactable, received_at_ms FROM bug_reports " +
        "WHERE received_at_ms > ? AND expires_at_ms > ? ORDER BY received_at_ms DESC LIMIT ?")
      .bind(sinceMs, nowMs, LIST_LIMIT)
      .all();
    return results.map((r) => ({ ...r, contactable: r.contactable === 1 }));
  }

  /** One report with its body, or null when there is none or it has expired. */
  async get(id, nowMs) {
    return (await this.db
      .prepare("SELECT id, tenant, surface, contact, body, received_at_ms FROM bug_reports WHERE id = ? AND expires_at_ms > ?")
      .bind(id, nowMs)
      .first()) ?? null;
  }

  /** Deletes the reports past their 90 days: how many went. */
  async purge(nowMs) {
    const done = await this.db.prepare("DELETE FROM bug_reports WHERE expires_at_ms <= ?").bind(nowMs).run();
    return done.meta.changes;
  }
}
