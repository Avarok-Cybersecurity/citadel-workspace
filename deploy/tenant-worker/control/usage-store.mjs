/**
 * Metered usage in D1 (`tenant_usage`, migrations 0003 and 0011), as the monitor samples it from
 * each tenant's object, and the outbox of what has been reported to Stripe's meters: one set of
 * columns per metered dimension (control/overage-report.mjs), the SQL built once over them.
 */

const METRICS = ["period_end", "bytes_in", "bytes_out", "frames_in", "active_seconds", "peak_connections", "appends"];

/** Each dimension's columns: what the plan included, the overage, and its outbox. Fixed names: never from input. */
const OUTBOX = {
  "relay-overage": { included: "relay_gb_included", overage: "overage_gb", reported: "overage_gb_reported", pending: "overage_gb_pending" },
  "document-appends": { included: "appends_included", overage: "appends_overage", reported: "appends_overage_reported", pending: "appends_overage_pending" },
};
const DIMS = Object.keys(OUTBOX);

const columnsOf = (dimension) => {
  const c = OUTBOX[dimension];
  if (!c) throw new Error(`tenant_usage has no columns for ${dimension}`);
  return c;
};
const progress = (row, dimension) => ({ reported: row[`${dimension}:reported`], pending: row[`${dimension}:pending`] });
const progressColumns = DIMS.map((d) => `${OUTBOX[d].reported} AS "${d}:reported", ${OUTBOX[d].pending} AS "${d}:pending"`).join(", ");

export class UsageStore {
  constructor(db) {
    this.db = db;
  }

  /**
   * Upserts a period's absolute totals and each dimension's `{id, included, overage}` (a repeated
   * sample overwrites), and returns what has been reported of each: `{[id]: {reported, pending}}`,
   * `pending` null when no report is in flight. Every dimension must be given.
   */
  async record(tenantId, period, figures, now) {
    const byId = new Map(figures.map((f) => [f.id, f]));
    if (byId.size !== DIMS.length || DIMS.some((d) => !byId.has(d))) throw new Error(`usage figures are for exactly ${DIMS.join(", ")}`);
    const written = [...METRICS, ...DIMS.flatMap((d) => [OUTBOX[d].included, OUTBOX[d].overage])];
    const values = [...METRICS.map((m) => period[m]), ...DIMS.flatMap((d) => [byId.get(d).included, byId.get(d).overage])];
    const row = await this.db
      .prepare(
        `INSERT INTO tenant_usage (tenant_id, period_start, ${written.join(", ")}, sampled_at) ` +
          `VALUES (?, ?, ${written.map(() => "?").join(", ")}, ?) ` +
          `ON CONFLICT (tenant_id, period_start) DO UPDATE SET ${written.map((m) => `${m} = excluded.${m}`).join(", ")}, ` +
          `sampled_at = excluded.sampled_at RETURNING ${progressColumns}`,
      )
      .bind(tenantId, period.period_start, ...values, now)
      .first();
    return Object.fromEntries(DIMS.map((d) => [d, progress(row, d)]));
  }

  /** Opens a report of `dimension`'s overage up to `units`, unless one is in flight. The one in flight, after. */
  async openReport(tenantId, periodStart, dimension, units) {
    const c = columnsOf(dimension);
    await this.db
      .prepare(`UPDATE tenant_usage SET ${c.pending} = ? WHERE tenant_id = ? AND period_start = ? AND ${c.pending} IS NULL`)
      .bind(units, tenantId, periodStart)
      .run();
    const row = await this.db
      .prepare(`SELECT ${c.reported} AS reported, ${c.pending} AS pending FROM tenant_usage WHERE tenant_id = ? AND period_start = ?`)
      .bind(tenantId, periodStart)
      .first();
    return { reported: row.reported, pending: row.pending };
  }

  /** Stripe accepted the report up to `units`: it becomes the reported total. */
  async closeReport(tenantId, periodStart, dimension, units) {
    const c = columnsOf(dimension);
    await this.db
      .prepare(`UPDATE tenant_usage SET ${c.reported} = ?, ${c.pending} = NULL WHERE tenant_id = ? AND period_start = ? AND ${c.pending} = ?`)
      .bind(units, tenantId, periodStart, units)
      .run();
  }
}
