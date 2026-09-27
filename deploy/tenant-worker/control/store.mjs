/**
 * The tenant registry in D1. Every query the control plane makes is here.
 */

const COLUMNS =
  "slug, tenant_id, display_name, status, tier, interval, seats, storage_blocks, stripe_customer, " +
  "stripe_subscription, created_at, expires_at, claim_hash, checkout_hash, sub_event_created, reservation_hash, checkout_sealed, " +
  "period_start, period_end, usage_subscription, owner_email, email_verified_at, email_sent_at, verify_hash, verify_expires";

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
   * the same batch. False when someone holds it.
   */
  async reserve(row, now) {
    return this.#insertAfter(
      this.db
        .prepare("DELETE FROM tenants WHERE slug = ? AND status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?")
        .bind(row.slug, now),
      row,
      now,
    );
  }

  /**
   * Replaces the pending reservation `held` with `row`, in one batch: only while `held` is still
   * that pending row with that reservation hash. False when it has changed since it was read (a
   * webhook activated it, another retry replaced it): the insert then meets the slug and the
   * whole batch rolls back.
   */
  async supersede(held, row, now) {
    return this.#insertAfter(
      this.db
        .prepare("DELETE FROM tenants WHERE slug = ? AND tenant_id = ? AND status = 'pending' AND reservation_hash = ?")
        .bind(held.slug, held.tenant_id, held.reservation_hash),
      row,
      now,
    );
  }

  async #insertAfter(clear, row, now) {
    try {
      await this.db.batch([
        clear,
        this.db
          .prepare(
            "INSERT INTO tenants (slug, tenant_id, display_name, status, tier, interval, seats, storage_blocks, " +
              "created_at, expires_at, claim_hash, reservation_hash, owner_email) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .bind(
            row.slug, row.tenant_id, row.display_name, row.tier, row.interval, row.seats, row.storage_blocks, now,
            row.expires_at, row.claim_hash, row.reservation_hash, row.owner_email,
          ),
      ]);
      return true;
    } catch (e) {
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message))) return false;
      throw e;
    }
  }

  /** Undoes a reservation this request made and could not complete. */
  async release(slug, tenantId) {
    await this.db.prepare("DELETE FROM tenants WHERE slug = ? AND tenant_id = ? AND status = 'pending'").bind(slug, tenantId).run();
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

  /** Records the verification token just emailed (by hash) and when it went. */
  async recordVerification(slug, tenantId, verifyHash, expires, now) {
    await this.db
      .prepare("UPDATE tenants SET verify_hash = ?, verify_expires = ?, email_sent_at = ? WHERE slug = ? AND tenant_id = ?")
      .bind(verifyHash, expires, now, slug, tenantId)
      .run();
  }

  /** A new address: unverified until its own link is followed. */
  async setOwnerEmail(slug, tenantId, email) {
    await this.db
      .prepare("UPDATE tenants SET owner_email = ?, email_verified_at = NULL, verify_hash = NULL, verify_expires = NULL WHERE slug = ? AND tenant_id = ?")
      .bind(email, slug, tenantId)
      .run();
  }

  /** True when `verifyHash` is the live token for `slug`; stamps the address verified, once. */
  async verifyEmail(slug, verifyHash, now) {
    const done = await this.db
      .prepare(
        "UPDATE tenants SET email_verified_at = COALESCE(email_verified_at, ?) " +
          "WHERE slug = ? AND verify_hash = ? AND verify_expires > ? AND owner_email IS NOT NULL",
      )
      .bind(now, slug, verifyHash, now)
      .run();
    return done.meta.changes === 1;
  }

  /** Forgets the address `verifyHash` was sent to, returning it; null when the token is not live. */
  async forgetEmail(slug, verifyHash) {
    const row = await this.db
      .prepare("SELECT owner_email FROM tenants WHERE slug = ? AND verify_hash = ? AND owner_email IS NOT NULL")
      .bind(slug, verifyHash)
      .first();
    if (!row) return null;
    await this.db
      .prepare("UPDATE tenants SET owner_email = NULL, email_verified_at = NULL, verify_hash = NULL, verify_expires = NULL WHERE slug = ? AND verify_hash = ?")
      .bind(slug, verifyHash)
      .run();
    return row.owner_email;
  }

  async recordPortalLink(slug, tenantId, portalHash, expires) {
    await this.db
      .prepare("UPDATE tenants SET portal_hash = ?, portal_expires = ? WHERE slug = ? AND tenant_id = ?")
      .bind(portalHash, expires, slug, tenantId)
      .run();
  }

  /** Spends the live portal link `portalHash` of `slug`: true once, then never again. */
  async takePortalLink(slug, portalHash, now) {
    const done = await this.db
      .prepare("UPDATE tenants SET portal_hash = NULL, portal_expires = NULL WHERE slug = ? AND portal_hash = ? AND portal_expires > ?")
      .bind(slug, portalHash, now)
      .run();
    return done.meta.changes === 1;
  }

  async eventSeen(id) {
    return (await this.db.prepare("SELECT 1 AS seen FROM stripe_events WHERE id = ?").bind(id).first()) !== null;
  }

  /**
   * Applies a tenant change and records the event that caused it in ONE batch (a D1 transaction):
   * either both land or neither does, so a failed change leaves the event unrecorded for Stripe
   * to retry. `change` is null for an event that changes nothing but is still handled.
   */
  async applyEvent(event, now, change) {
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
      this.db.prepare("INSERT INTO stripe_events (id, type, received_at) VALUES (?, ?, ?)").bind(event.id, event.type, now),
    );
    await this.db.batch(statements);
  }
}

/** The columns an event may change, so `applyEvent` never builds SQL from anything else. */
export const EVENT_FIELDS = new Set([
  "status", "tier", "interval", "seats", "storage_blocks", "stripe_customer", "stripe_subscription",
  "sub_event_created", "expires_at", "period_start", "period_end", "usage_subscription",
]);
