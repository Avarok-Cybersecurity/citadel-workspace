/**
 * D1 state for Avarok support's signed reads (migrations/0006_support_access.sql): the nonces of
 * verified requests, so none is served twice, and the mirror of which tenants granted access.
 */

export class SupportStore {
  constructor(db) {
    this.db = db;
  }

  /**
   * Claims a verified request's nonce, first deleting every nonce whose request has expired at
   * `nowMs`. False when the nonce was already claimed: the request is a replay.
   */
  async claimNonce(nonce, expiresAtMs, nowMs) {
    const [, claimed] = await this.db.batch([
      this.db.prepare("DELETE FROM support_nonces WHERE expires_at_ms <= ?").bind(nowMs),
      this.db.prepare("INSERT INTO support_nonces (nonce, expires_at_ms) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING").bind(nonce, expiresAtMs),
    ]);
    return claimed.meta.changes === 1;
  }

  /** The tenant's object reports its kernel's grant: on until `untilMs`, or off (null). */
  async recordGrant(tenantId, untilMs, nowMs) {
    if (untilMs === null) {
      await this.db.prepare("DELETE FROM support_grants WHERE tenant_id = ?").bind(tenantId).run();
      return;
    }
    await this.db
      .prepare(
        "INSERT INTO support_grants (tenant_id, until_ms, changed_at) VALUES (?, ?, ?) " +
          "ON CONFLICT (tenant_id) DO UPDATE SET until_ms = excluded.until_ms, changed_at = excluded.changed_at",
      )
      .bind(tenantId, untilMs, nowMs)
      .run();
  }

  /** Active tenants whose grant is unexpired at `nowMs`, by slug; expired grants are deleted. */
  async activeGrants(nowMs) {
    const [, rows] = await this.db.batch([
      this.db.prepare("DELETE FROM support_grants WHERE until_ms <= ?").bind(nowMs),
      this.db.prepare(
        "SELECT t.slug AS tenant, g.until_ms AS until_ms FROM support_grants g " +
          "JOIN tenants t ON t.tenant_id = g.tenant_id WHERE t.status = 'active' ORDER BY t.slug",
      ),
    ]);
    return rows.results;
  }
}
