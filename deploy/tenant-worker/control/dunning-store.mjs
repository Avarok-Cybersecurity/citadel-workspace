/**
 * Dunning and purges in D1 (migration 0009): `tenant_dunning`, one row while a tenant's payment
 * is required, and `tenant_purges`, the audit of each purge. Statements a webhook applies are
 * returned unrun, for store.mjs `applyEvent` to put in the event's own batch.
 */

const DUNNING_COLUMNS =
  "tenant_id, slug, since, purge_at, invoice_id, hosted_invoice_url, customer_email, reminders_sent, final_warning_sent_at, updated_at";

export class DunningStore {
  constructor(db) {
    this.db = db;
  }

  /** The tenant's dunning row, or null when its payment is not required. */
  async get(tenantId) {
    return this.db.prepare(`SELECT ${DUNNING_COLUMNS} FROM tenant_dunning WHERE tenant_id = ?`).bind(tenantId).first();
  }

  /** Unrun: opens dunning for `row` in `state` (billing/dunning.mjs). Fails on a row already open. */
  open(row, state, now) {
    return this.db
      .prepare(`INSERT INTO tenant_dunning (${DUNNING_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        row.tenant_id, row.slug, state.since, state.purge_at, state.invoice.id, state.invoice.hosted_invoice_url,
        state.invoice.customer_email, JSON.stringify(state.reminders_sent), state.final_warning_sent_at, now,
      );
  }

  /** Unrun: closes the tenant's dunning (it paid). */
  close(tenantId) {
    return this.db.prepare("DELETE FROM tenant_dunning WHERE tenant_id = ?").bind(tenantId);
  }

  /** Records the emails `state` says were sent, unless the dunning begun at `since` has ended meanwhile. */
  async recordSent(tenantId, since, state, now) {
    await this.db
      .prepare("UPDATE tenant_dunning SET reminders_sent = ?, final_warning_sent_at = ?, updated_at = ? WHERE tenant_id = ? AND since = ?")
      .bind(JSON.stringify(state.reminders_sent), state.final_warning_sent_at, now, tenantId, since)
      .run();
  }

  /** The tenant's purge audit, or null when no purge has begun. */
  async purgeOf(tenantId) {
    return this.db.prepare("SELECT tenant_id, slug, started_at, steps, finished_at FROM tenant_purges WHERE tenant_id = ?").bind(tenantId).first();
  }

  /** The purge audit, opened now unless a purge of this tenant has begun already. */
  async beginPurge(row, now) {
    await this.db
      .prepare("INSERT INTO tenant_purges (tenant_id, slug, started_at, steps) VALUES (?, ?, ?, '[]') ON CONFLICT (tenant_id) DO NOTHING")
      .bind(row.tenant_id, row.slug, now)
      .run();
    return this.purgeOf(row.tenant_id);
  }

  #steps(tenantId, steps, finishedAt) {
    return this.db.prepare("UPDATE tenant_purges SET steps = ?, finished_at = ? WHERE tenant_id = ?").bind(JSON.stringify(steps), finishedAt, tenantId);
  }

  /** Records `steps` as done, alone (the object's step is an RPC, done before this). */
  async recordSteps(tenantId, steps) {
    await this.#steps(tenantId, steps, null).run();
  }

  /** Deletes the tenant's usage, alerts and dunning rows and records `steps`, in one batch. */
  async purgeUsage(tenantId, steps) {
    await this.db.batch([
      this.db.prepare("DELETE FROM tenant_usage WHERE tenant_id = ?").bind(tenantId),
      this.db.prepare("DELETE FROM tenant_alerts WHERE tenant_id = ?").bind(tenantId),
      this.close(tenantId),
      this.#steps(tenantId, steps, null),
    ]);
  }

  /** Deletes the tenant's registry row, which releases its slug, and finishes the audit, in one batch. */
  async purgeRegistry(row, steps, now) {
    await this.db.batch([
      this.db.prepare("DELETE FROM tenants WHERE slug = ? AND tenant_id = ?").bind(row.slug, row.tenant_id),
      this.#steps(row.tenant_id, steps, now),
    ]);
  }
}
