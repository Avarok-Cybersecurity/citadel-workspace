/**
 * What the control plane remembers about the email it sends: how many it sent per key per day,
 * and the addresses it must never mail again. D1, like the tenant registry.
 *
 * Counted in D1 rather than a rate-limit binding, which this Worker does not have; the same shape
 * as control/ice.mjs.
 */

export class MailLedger {
  constructor(db) {
    this.db = db;
  }

  /**
   * Counts one send against every key for `day`, only if each is under its limit: all or nothing,
   * so a refused send uses up nobody's allowance. `limits` is `{key: max}`.
   */
  async take(limits, day) {
    const keys = Object.keys(limits);
    const rows = (await this.db
      .prepare(`SELECT key, count FROM mail_sends WHERE day = ? AND key IN (${keys.map(() => "?").join(", ")})`)
      .bind(day, ...keys)
      .all()).results;
    const used = new Map(rows.map((r) => [r.key, r.count]));
    if (keys.some((k) => (used.get(k) ?? 0) >= limits[k])) return false;
    await this.db.batch(
      keys.map((k) =>
        this.db
          .prepare("INSERT INTO mail_sends (key, day, count) VALUES (?, ?, 1) ON CONFLICT (key, day) DO UPDATE SET count = count + 1")
          .bind(k, day),
      ),
    );
    return true;
  }

  async suppressed(emailHash) {
    return (await this.db.prepare("SELECT 1 AS s FROM mail_suppressed WHERE email_hash = ?").bind(emailHash).first()) !== null;
  }

  async suppress(emailHash, now) {
    await this.db
      .prepare("INSERT INTO mail_suppressed (email_hash, suppressed_at) VALUES (?, ?) ON CONFLICT (email_hash) DO NOTHING")
      .bind(emailHash, now)
      .run();
  }
}
