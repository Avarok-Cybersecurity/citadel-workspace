/**
 * Coupons in D1 (migrations/0009_coupons.sql): dynamic codes by hash, redemptions, the preview
 * rate limit, and the audit of every change. Every coupon query is here; nothing is decided here
 * (control/coupon-rules.mjs decides). Times are Unix milliseconds, but for `reserved_at`, which
 * the cap trigger compares with tenants' `expires_at` (seconds).
 */
import { ADDONS } from "./plans.mjs";

/**
 * Redemptions that hold `?1` (a coupon hash) at `?2` (seconds): every redeemed one, and every
 * pending one whose tenant still holds its reservation, but for a pending one on the slug `?3`
 * (the reservation this creation would replace; null for none). The cap trigger counts the same.
 */
/** What a revoked grant's tenants may be set to: the plan columns, nothing else. */
const GRANT_END_FIELDS = new Set(["status", "tier", "interval", "seats", ...ADDONS.map((a) => a.quantityField), "period_start", "period_end"]);

const HELD =
  "SELECT COUNT(*) AS held FROM coupon_redemptions r WHERE r.coupon_hash = ?1 AND (r.state = 'redeemed' OR " +
  "((?3 IS NULL OR r.slug <> ?3) AND EXISTS (SELECT 1 FROM tenants t WHERE t.tenant_id = r.tenant_id " +
  "AND NOT (t.status = 'pending' AND t.expires_at IS NOT NULL AND t.expires_at <= ?2))))";

export class CouponStore {
  constructor(db) {
    this.db = db;
  }

  /**
   * The dynamic coupon hashed `codeHash` (or null) and how many redemptions hold it. Always the
   * same two statements in one batch, whether or not the code exists and whatever kind it is, so
   * a lookup's shape says nothing about the code.
   */
  async lookup(codeHash, nowSec, slug) {
    const [found, held] = await this.db.batch([
      this.db.prepare("SELECT * FROM coupons WHERE code_hash = ?").bind(codeHash),
      this.db.prepare(HELD).bind(codeHash, nowSec, slug),
    ]);
    return { row: found.results[0] ?? null, held: held.results[0].held };
  }

  /**
   * The statements a reservation carries (control/store.mjs `reserve`): before it, the pending
   * redemptions of expired reservations and of the one this creation replaces (`replacing`, a
   * tenant id, or null) are dropped; after it, `coupon`'s redemption is reserved (the trigger
   * refuses it past the cap, rolling the whole batch back) and audited. No coupon, no `after`.
   */
  reservation({ coupon, row, nowSec, nowMs, replacing }) {
    const before = [
      this.db
        .prepare(
          "DELETE FROM coupon_redemptions WHERE state = 'pending' AND tenant_id IN " +
            "(SELECT tenant_id FROM tenants WHERE status = 'pending' AND expires_at IS NOT NULL AND expires_at <= ?)",
        )
        .bind(nowSec),
    ];
    if (replacing !== null) {
      before.push(this.db.prepare("DELETE FROM coupon_redemptions WHERE tenant_id = ? AND state = 'pending'").bind(replacing));
    }
    if (coupon === null) return { before, after: [] };
    return {
      before,
      after: [
        this.db
          .prepare(
            "INSERT INTO coupon_redemptions (coupon_hash, tenant_id, slug, state, reserved_at, max_redemptions) VALUES (?, ?, ?, 'pending', ?, ?)",
          )
          .bind(coupon.code_hash, row.tenant_id, row.slug, nowSec, coupon.max_redemptions),
        this.#event(nowMs, "reserve", coupon.code_hash, row.tenant_id, null, { slug: row.slug, kind: coupon.kind }, null),
      ],
    };
  }

  /** The tenant's pending redemption becomes redeemed, audited; nothing when it holds none. */
  confirmation(tenantId, nowMs) {
    return this.#settle(tenantId, nowMs, "redeem", "UPDATE coupon_redemptions SET state = 'redeemed' WHERE tenant_id = ? AND state = 'pending'");
  }

  /** The tenant's pending redemption is given back, audited; nothing when it holds none. */
  releasing(tenantId, nowMs) {
    return this.#settle(tenantId, nowMs, "release", "DELETE FROM coupon_redemptions WHERE tenant_id = ? AND state = 'pending'");
  }

  /** A comp tenant becomes active with its grant, and its redemption redeemed, in one batch. */
  async activateComp(slug, tenantId, grantId, unlimited, nowMs) {
    const [activated] = await this.db.batch([
      this.db
        .prepare(
          "UPDATE tenants SET status = 'active', expires_at = NULL, grant_id = ?, grant_unlimited = ? WHERE slug = ? AND tenant_id = ? AND status = 'pending'",
        )
        .bind(grantId, unlimited ? 1 : 0, slug, tenantId),
      ...this.confirmation(tenantId, nowMs),
    ]);
    if (activated.meta.changes !== 1) throw new Error(`the comp tenant ${slug} was no longer pending`);
  }

  /** Counts one preview by `ipHash` in `hour`, dropping past hours: the count so far, this one included. */
  async countAttempt(ipHash, hour) {
    const [, counted] = await this.db.batch([
      this.db.prepare("DELETE FROM coupon_attempts WHERE hour < ?").bind(hour),
      this.db
        .prepare(
          "INSERT INTO coupon_attempts (ip_hash, hour, count) VALUES (?, ?, 1) " +
            "ON CONFLICT (ip_hash, hour) DO UPDATE SET count = count + 1 RETURNING count",
        )
        .bind(ipHash, hour),
    ]);
    return counted.results[0].count;
  }

  /** Records a spend alarm once per tenant, metric and period: true when this call recorded it. */
  async alarm(tenantId, couponHash, { metric, value, threshold, period_start }, nowMs) {
    const done = await this.#event(nowMs, "alarm", couponHash, tenantId, null, { metric, value, threshold, period_start },
      `alarm:${tenantId}:${metric}:${period_start}`).run();
    return done.meta.changes === 1;
  }

  /** Issues a dynamic coupon, audited; false when a coupon already holds that hash. */
  async issue(coupon, nowMs, nonce, note) {
    try {
      await this.db.batch([
        this.db
          .prepare(
            "INSERT INTO coupons (code_hash, template, grant_id, available_on, intervals, max_redemptions, redeem_by_ms, revoked_at_ms, " +
              "issued_at_ms, issued_nonce, note) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)",
          )
          .bind(coupon.code_hash, coupon.template, coupon.grant_id, JSON.stringify(coupon.available_on), JSON.stringify(coupon.intervals),
            coupon.max_redemptions, coupon.redeem_by_ms, nowMs, nonce, note),
        this.#event(nowMs, "issue", coupon.code_hash, null, nonce, { template: coupon.template, grant_id: coupon.grant_id }, null),
      ]);
      return true;
    } catch (e) {
      if (/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message))) return false;
      throw e;
    }
  }

  /**
   * Revokes a dynamic coupon, audited, in one batch. With `endGrants` (the plan the tenants holding
   * a grant through it fall back to, e.g. plans.mjs FREE_PLAN; null to leave them their grants)
   * those tenants lose it too. Every statement is conditional on the coupon being unrevoked when
   * the batch runs, and the revocation itself comes last: false, and nothing changed, when there
   * was no such unrevoked coupon.
   */
  async revoke(codeHash, nowMs, nonce, detail, endGrants) {
    const unrevoked = "EXISTS (SELECT 1 FROM coupons WHERE code_hash = ? AND revoked_at_ms IS NULL)";
    const statements = [
      this.db
        .prepare(
          "INSERT INTO coupon_events (at_ms, action, coupon_hash, tenant_id, nonce, detail, once_key) " +
            `SELECT ?, 'revoke', ?, NULL, ?, ?, NULL WHERE ${unrevoked}`,
        )
        .bind(nowMs, codeHash, nonce, JSON.stringify(detail), codeHash),
    ];
    if (endGrants !== null) {
      const fields = Object.keys(endGrants);
      const bad = fields.filter((k) => !GRANT_END_FIELDS.has(k));
      if (bad.length) throw new Error(`a revoked grant may not set ${bad.join(", ")}`);
      statements.push(
        this.db
          .prepare(
            `UPDATE tenants SET ${fields.map((k) => `${k} = ?`).join(", ")}, grant_id = NULL, grant_unlimited = 0 ` +
              `WHERE coupon_hash = ? AND grant_id IS NOT NULL AND ${unrevoked}`,
          )
          .bind(...Object.values(endGrants), codeHash, codeHash),
      );
    }
    statements.push(this.db.prepare("UPDATE coupons SET revoked_at_ms = ? WHERE code_hash = ? AND revoked_at_ms IS NULL").bind(nowMs, codeHash));
    const results = await this.db.batch(statements);
    return results.at(-1).meta.changes === 1;
  }

  /** The tenants holding an active grant through `codeHash`. */
  async grantHolders(codeHash) {
    return (await this.db.prepare("SELECT slug, tenant_id FROM tenants WHERE coupon_hash = ? AND grant_id IS NOT NULL").bind(codeHash).all()).results;
  }

  /** Every dynamic coupon with how many redemptions hold it now. */
  async list(nowSec) {
    const rows = (await this.db.prepare("SELECT * FROM coupons ORDER BY issued_at_ms").all()).results;
    const out = [];
    for (const row of rows) {
      const held = (await this.db.prepare(HELD).bind(row.code_hash, nowSec, null).first()).held;
      out.push({ row, held, holders: (await this.grantHolders(row.code_hash)).map((h) => h.slug) });
    }
    return out;
  }

  /** A coupon's redemptions and its audit trail. */
  async redemptions(codeHash) {
    const [redemptions, events] = await this.db.batch([
      this.db.prepare("SELECT slug, tenant_id, state, reserved_at FROM coupon_redemptions WHERE coupon_hash = ? ORDER BY reserved_at").bind(codeHash),
      this.db.prepare("SELECT at_ms, action, tenant_id, detail FROM coupon_events WHERE coupon_hash = ? ORDER BY id").bind(codeHash),
    ]);
    return { redemptions: redemptions.results, events: events.results.map((e) => ({ ...e, detail: JSON.parse(e.detail) })) };
  }

  /** The audit row, then the change, for the tenant's pending redemption only. */
  #settle(tenantId, nowMs, action, change) {
    return [
      this.db
        .prepare(
          "INSERT INTO coupon_events (at_ms, action, coupon_hash, tenant_id, nonce, detail) " +
            "SELECT ?, ?, coupon_hash, tenant_id, NULL, json_object('slug', slug) FROM coupon_redemptions WHERE tenant_id = ? AND state = 'pending'",
        )
        .bind(nowMs, action, tenantId),
      this.db.prepare(change).bind(tenantId),
    ];
  }

  #event(nowMs, action, couponHash, tenantId, nonce, detail, onceKey) {
    const sql = "INSERT INTO coupon_events (at_ms, action, coupon_hash, tenant_id, nonce, detail, once_key) VALUES (?, ?, ?, ?, ?, ?, ?)";
    return this.db
      .prepare(onceKey === null ? sql : `${sql} ON CONFLICT (once_key) DO NOTHING`)
      .bind(nowMs, action, couponHash, tenantId, nonce, JSON.stringify(detail), onceKey);
  }
}

