/**
 * Whether a coupon applies to a plan, and what it gives. Pure. A static code (billing/tiers.json)
 * and a dynamic one (a D1 row the admin tool issued) are normalised into one shape here, and
 * every decision past that point is the same code whatever the source:
 *
 *   { source, code_hash, kind: "discount" | "trial" | "comp", template, grant_id, available_on,
 *     intervals, max_redemptions, redeem_by_ms, revoked_at_ms }
 */
import { COUPONS, isPaid } from "./plans.mjs";
import { digestsEqual, sha256Hex } from "./secrets.mjs";

/** Coupon previews a client address may make per hour (the guessing surface's limit). */
export const MAX_PREVIEWS_PER_HOUR = 20;
/** Past this, no code_shape can match, so the regular expression never sees an unbounded string. */
const MAX_CODE_INPUT = 64;

/** `value` trimmed and upper-cased if it is a code of tiers.json's shape, else null. */
export function normaliseCode(value) {
  if (typeof value !== "string" || value.length > MAX_CODE_INPUT) return null;
  const code = value.trim().toUpperCase();
  return COUPONS.codeShape.test(code) ? code : null;
}

/** The hash a code is stored and compared by. */
export const codeHash = (code) => sha256Hex(code);

export function kindOf(template, grantId) {
  if (grantId !== null) return COUPONS.grants.has(grantId) ? "comp" : null;
  const t = COUPONS.templates.get(template);
  if (!t) return null;
  return "trial_days" in t ? "trial" : "discount";
}

function coupon(source, hash, c, revokedAtMs) {
  const kind = kindOf(c.template, c.grant_id);
  // A dynamic code naming a shape tiers.json no longer has applies to nothing.
  if (kind === null) return null;
  return Object.freeze({
    source, code_hash: hash, kind, template: c.template, grant_id: c.grant_id, available_on: c.available_on, intervals: c.intervals,
    max_redemptions: c.max_redemptions, redeem_by_ms: c.redeem_by_ms, revoked_at_ms: revokedAtMs,
  });
}

/** A catalogue's static codes (`couponCatalogue(...).statics`), normalised and hashed. */
export const staticCouponsOf = (list) => Promise.all(list.map(async (s) => coupon("static", await codeHash(s.code), s, null)));

let statics = null;
/** billing/tiers.json's static codes, normalised and hashed once per isolate. */
export function staticCoupons() {
  statics ??= staticCouponsOf(COUPONS.statics);
  return statics;
}

/** Whether `hash` is one of `staticList`'s codes. */
export const isStaticHash = (staticList, hash) => staticList.some((s) => s.code_hash === hash);

/** A D1 `coupons` row, normalised. */
export function dynamicCoupon(row) {
  return coupon("dynamic", row.code_hash, {
    template: row.template, grant_id: row.grant_id, available_on: JSON.parse(row.available_on), intervals: JSON.parse(row.intervals),
    max_redemptions: row.max_redemptions, redeem_by_ms: row.redeem_by_ms,
  }, row.revoked_at_ms);
}

/**
 * The coupon `hash` names: a static one, else the dynamic `row`, else null. Every static hash is
 * compared, without an early exit, whether or not one matches.
 */
export function pick(staticList, hash, row) {
  let match = null;
  for (const s of staticList) if (digestsEqual(s.code_hash, hash) && match === null) match = s;
  return match ?? (row === null ? null : dynamicCoupon(row));
}

/**
 * Whether `c` may be redeemed for `plan` ({tier, interval}) at `nowMs`, with `held` of its
 * redemptions taken: `{ok: true}` or `{ok: false, reason}`. The reason is for logs and tests;
 * every refusal answers the same to the client.
 */
export function redeemable(c, plan, nowMs, held) {
  if (c === null) return { ok: false, reason: "unknown" };
  if (!isPaid(plan.tier)) return { ok: false, reason: "free-tier" };
  if (c.revoked_at_ms !== null) return { ok: false, reason: "revoked" };
  if (c.redeem_by_ms !== null && nowMs > c.redeem_by_ms) return { ok: false, reason: "expired" };
  if (!c.available_on.includes(plan.tier)) return { ok: false, reason: "wrong-tier" };
  if (!c.intervals.includes(plan.interval)) return { ok: false, reason: "wrong-interval" };
  if (held >= c.max_redemptions) return { ok: false, reason: "exhausted" };
  return { ok: true };
}

/** What a redeemable coupon gives, as the preview answers it (the UI renders exactly this). */
export function offerOf(c) {
  if (c.kind === "comp") {
    const g = COUPONS.grants.get(c.grant_id);
    return { applies: true, kind: "comp", tier_as: g.tier_as, seats: g.seats };
  }
  const t = COUPONS.templates.get(c.template);
  if (c.kind === "trial") return { applies: true, kind: "trial", days: t.trial_days };
  const amount = t.discount.kind === "percent" ? { percent_off: t.discount.percent_off } : { amount_off_cents: t.discount.amount_off };
  return { applies: true, kind: "discount", ...amount, duration: t.duration, ...(t.duration === "repeating" ? { months: t.months } : {}) };
}
