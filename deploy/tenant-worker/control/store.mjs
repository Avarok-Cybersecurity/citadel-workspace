/**
 * The tenant registry in D1. Every query the control plane makes is here.
 */
import { ADDONS } from "./plans.mjs";

/** One column per add-on quantity (control/addons.mjs), each added by its own migration. */
const ADDON_COLUMNS = ADDONS.map((a) => a.quantityField);
const COLUMNS =
  `slug, tenant_id, display_name, status, tier, interval, seats, ${ADDON_COLUMNS.join(", ")}, stripe_customer, ` +
  "stripe_subscription, created_at, expires_at, claim_hash, checkout_hash, sub_event_created, reservation_hash, checkout_sealed, " +
  "period_start, period_end, usage_subscription, coupon_hash, grant_id, grant_unlimited, trial_end, stripe_status";
/** The coupon columns (migration 0009), which every insert names: a comp grant is set when it activates. */
const COUPON_COLUMNS = ["coupon_hash", "grant_id", "grant_unlimited", "trial_end", "stripe_status"];
const INSERT_COLUMNS = ["slug", "tenant_id", "display_name", "status", "tier", "interval", "seats", ...ADDON_COLUMNS,
  "created_at", "expires_at", "claim_hash", "reservation_hash", ...COUPON_COLUMNS];
/** What a reservation batch answers: the slug is held, someone else holds it, or the coupon ran out. */
export const RESERVED = "reserved";
export const TAKEN = "taken";
export const EXHAUSTED = "exhausted";

export class Store {
  constructor(db) {
    this.db = db;
  }

  /** The row holding `slug` now, or null: a pending row past its expiry holds nothing. */
  async holder(slug, now) {
    const row = await this.db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE slug = ?`).bind(slug).first();
    if (row && row.status === "pending" && row.expires_at !== null && row.expires_at <= now) return null;
    return row;
  }

  /** Every active tenant, for the usage monitor. */
  async active() {
    return (await this.db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE status = 'active'`).all()).results;
  }

  async byTenantId(tenantId) {
    return this.db.prepare(`SELECT ${COLUMNS} FROM tenants WHERE tenant_id = ?`).bind(tenantId).first();
  }

  /**
   * Reserves `row.slug` as a pending tenant: an expired pending row for it is cleared first, in
   * the same batch, which also carries `coupon` (control/coupon-store.mjs `reservation`:
   * statements to run before and after, empty without a coupon). RESERVED, TAKEN when someone
   * holds the slug, or EXHAUSTED when the coupon's last redemption went to another creation.
   */
  async reserve(row, now, coupon) {
    return this.#insertAfter(
      this.db
        .prepare("DELETE FROM tenants WHERE slug = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?")
        .bind(row.slug, now),
      row,
      now,
      coupon,
    );
  }

  /**
   * Replaces the pending reservation `held` with `row`, in one batch: only while `held` is still
   * that pending row with that reservation hash. False when it has changed since it was read (a
   * webhook activated it, another retry replaced it): the insert then meets the slug and the
   * whole batch rolls back. Answers as `reserve` does.
   */
  async supersede(held, row, now, coupon) {
    return this.#insertAfter(
      this.db
        .prepare("DELETE FROM tenants WHERE slug = ? AND tenant_id = ? AND status = 'pending' AND reservation_hash = ?")
        .bind(held.slug, held.tenant_id, held.reservation_hash),
      row,
      now,
      coupon,
    );
  }

  async #insertAfter(clear, row, now, coupon) {
    try {
      await this.db.batch([
        ...coupon.before,
        clear,
        this.db
          .prepare(`INSERT INTO tenants (${INSERT_COLUMNS.join(", ")}) VALUES (${INSERT_COLUMNS.map(() => "?").join(", ")})`)
          .bind(
            row.slug, row.tenant_id, row.display_name, "pending", row.tier, row.interval, row.seats, ...ADDON_COLUMNS.map((c) => row[c]), now,
            row.expires_at, row.claim_hash, row.reservation_hash, ...COUPON_COLUMNS.map((c) => row[c]),
          ),
        // The acceptance lands with the reservation or not at all.
        this.db
          .prepare("INSERT INTO customer_terms_acceptances (tenant_id, slug, version, accepted_at) VALUES (?, ?, ?, ?)")
          .bind(row.tenant_id, row.slug, row.customer_terms_version, now),
        ...coupon.after,
      ]);
      return RESERVED;
    } catch (e) {
      const message = String(e?.message);
      if (message.includes("coupon-exhausted")) return EXHAUSTED;
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(message)) return TAKEN;
      throw e;
    }
  }

  /** Undoes a reservation this request made and could not complete, with `also` (its coupon's release). */
  async release(slug, tenantId, also) {
    await this.db.batch([
      ...also,
      this.db.prepare("DELETE FROM tenants WHERE slug = ? AND tenant_id = ? AND status = 'pending'").bind(slug, tenantId),
    ]);
  }

  async activateFree(slug, tenantId) {
    await this.db
      .prepare("UPDATE tenants SET status = 'active', expires_at = NULL WHERE slug = ? AND tenant_id = ?")
      .bind(slug, tenantId)
      .run();
  }

  async attachCheckout(slug, tenantId, checkoutHash, claimSealed, checkoutSealed) {
    await this.db
      .prepare("UPDATE tenants SET checkout_hash = ?, claim_sealed = ?, checkout_sealed = ? WHERE slug = ? AND tenant_id = ?")
      .bind(checkoutHash, claimSealed, checkoutSealed, slug, tenantId)
      .run();
  }

  /** The sealed claim code of an active tenant created by the session hashed `checkoutHash`, if uncollected. */
  async sealedClaim(slug, checkoutHash) {
    return this.db
      .prepare("SELECT claim_sealed, tenant_id FROM tenants WHERE slug = ? AND status = 'active' AND checkout_hash = ? AND claim_sealed IS NOT NULL")
      .bind(slug, checkoutHash)
      .first();
  }

  /** Clears the sealed claim code if it is still `sealed`: true for exactly one caller. */
  async collectClaim(slug, sealed) {
    const done = await this.db
      .prepare("UPDATE tenants SET claim_sealed = NULL WHERE slug = ? AND claim_sealed = ?")
      .bind(slug, sealed)
      .run();
    return done.meta.changes === 1;
  }

  async eventSeen(id) {
    return (await this.db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(id).first()) !== null;
  }

  /**
   * Applies a tenant change and records the event that caused it in ONE batch (a D1 transaction):
   * either both land or neither does, so a failed change leaves the event unrecorded for Stripe
   * to retry. `change` is null for an event that changes nothing but is still handled; `also` are
   * statements the event brings with it (a coupon redemption confirmed), empty when none.
   */
  async applyEvent(event, now, change, also) {
    const statements = [];
    if (change) {
      const unknown = Object.keys(change.fields).filter((k) => !EVENT_FIELDS.has(k));
      if (unknown.length) throw new Error(`an event may not set ${unknown.join(", ")}`);
      const sets = Object.keys(change.fields).map((k) => `${k} = ?`).join(", ");
      statements.push(
        this.db
          .prepare(`UPDATE tenants SET ${sets} WHERE slug = ? AND tenant_id = ?`)
          .bind(...Object.values(change.fields), change.slug, change.tenant_id),
      );
    }
    statements.push(
      ...also,
      this.db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)").bind(event.id, event.type, now),
    );
    await this.db.batch(statements);
  }
}

/** The columns an event may change, so `applyEvent` never builds SQL from anything else. */
export const EVENT_FIELDS = new Set([
  "status", "tier", "interval", "seats", ...ADDON_COLUMNS, "stripe_customer", "stripe_subscription",
  "sub_event_created", "expires_at", "period_start", "period_end", "usage_subscription", "trial_end", "stripe_status",
]);
