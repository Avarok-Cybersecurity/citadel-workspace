/** The alerts already announced (`tenant_alerts`, migration 0009), per tenant, period and dimension. */
export class AlertStore {
  constructor(db) {
    this.db = db;
  }

  /** The threshold keys recorded for this period and dimension, as a Set. */
  async sent(tenantId, periodStart, dimension) {
    const rows = await this.db
      .prepare("SELECT threshold FROM tenant_alerts WHERE tenant_id = ? AND period_start = ? AND dimension = ?")
      .bind(tenantId, periodStart, dimension)
      .all();
    return new Set(rows.results.map((r) => r.threshold));
  }

  /** Records one announcement, after it was made; a second record of it changes nothing. */
  async record(tenantId, periodStart, dimension, threshold, now) {
    await this.db
      .prepare("INSERT OR IGNORE INTO tenant_alerts (tenant_id, period_start, dimension, threshold, sent_at) VALUES (?, ?, ?, ?, ?)")
      .bind(tenantId, periodStart, dimension, threshold, now)
      .run();
  }
}
