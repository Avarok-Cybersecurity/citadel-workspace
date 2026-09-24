/**
 * Metered usage in D1 (`tenant_usage`, migration 0003), as the monitor samples it from each
 * tenant's object, and the outbox of what has been reported to Stripe's meter.
 */

const METRICS = ["period_end", "bytes_in", "bytes_out", "frames_in", "active_seconds", "peak_connections"];

export class UsageStore {
  constructor(db) {
    this.db = db;
  }

  /**
   * Upserts a period's absolute totals (a repeated sample overwrites) and returns what has been
   * reported of it: `{reported, pending}` in whole GB, `pending` null when no report is in flight.
   */
  async record(tenantId, period, includedGb, overageGb, now) {
    const row = await this.db
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period_start, ${METRICS.join(", ")}, relay_gb_included, overage_gb, sampled_at) ` +
          `VALUES (?, ?, ${METRICS.map(() => "?").join(", ")}, ?, ?, ?) ` +
          `ON CONFLICT (tenant_id, period_start) DO UPDATE SET ${METRICS.map((m) => `${m} = excluded.${m}`).join(", ")}, ` +
          "relay_gb_included = excluded.relay_gb_included, overage_gb = excluded.overage_gb, sampled_at = excluded.sampled_at " +
          "RETURNING overage_gb_reported AS reported, overage_gb_pending AS pending",
      )
      .bind(tenantId, period.period_start, ...METRICS.map((m) => period[m]), includedGb, overageGb, now)
      .first();
    return { reported: row.reported, pending: row.pending };
  }

  /** Opens a report of the overage up to `gb`, unless one is already in flight. The one in flight, after. */
  async openReport(tenantId, periodStart, gb) {
    await this.db
      .prepare("UPDATE tenant_usage SET overage_gb_pending = ? WHERE tenant_id = ? AND period_start = ? AND overage_gb_pending IS NULL")
      .bind(gb, tenantId, periodStart)
      .run();
    const row = await this.db
      .prepare("SELECT overage_gb_reported AS reported, overage_gb_pending AS pending FROM tenant_usage WHERE tenant_id = ? AND period_start = ?")
      .bind(tenantId, periodStart)
      .first();
    return { reported: row.reported, pending: row.pending };
  }

  /** Stripe accepted the report up to `gb`: it becomes the reported total. */
  async closeReport(tenantId, periodStart, gb) {
    await this.db
      .prepare(
        "UPDATE tenant_usage SET overage_gb_reported = ?, overage_gb_pending = NULL " +
          "WHERE tenant_id = ? AND period_start = ? AND overage_gb_pending = ?",
      )
      .bind(gb, tenantId, periodStart, gb)
      .run();
  }
}
