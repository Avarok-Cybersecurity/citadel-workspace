/** The pure coupon rules and entitlements v2, and that a v1 record reads exactly as it did. */
import { describe, expect, it } from "vitest";
import { COUPONS, enforcedEntitlements, entitlements, ENTITLEMENTS_VERSION } from "../control/plans.mjs";
import { limitOf } from "../control/entitlement-limits.mjs";
import { linkQuota } from "../control/tenant-links.mjs";
import { nodeStorage } from "../control/tenant-node.mjs";
import { relayAllowed } from "../control/ice.mjs";
import { Meter } from "../control/meter.mjs";
import { alarmsOf } from "../control/coupon-alarm.mjs";
import { overageGb } from "../control/monitor.mjs";
import { codeHash, isStaticHash, normaliseCode, offerOf, pick, redeemable, staticCoupons, staticCouponsOf } from "../control/coupon-rules.mjs";
import { couponCatalogue } from "../../../billing/coupons-catalogue.mjs";
import tiers from "../../../billing/tiers.json";

const GB = 1e9;
const none = { period_start: null, period_end: null, grant_id: null, grant_unlimited: 0, trial_end: null, stripe_status: null };
const team = { status: "active", tier: "team", interval: "month", seats: 3, storage_blocks: 0, link_packs: 0, ...none };
/** A record as objects stored it before coupons: every limit a count, no v, no unlimited. */
const V1 = {
  status: "active", tier: "team", interval: "month", seats: 3, storage_blocks: 0, link_packs: 0, members_max: 3, storage_gb: 30, workspaces_max: 1,
  priority_support: false, connections_max: 9, relay_gb_included: 60, secure_links_per_member: 50, secure_links_pool: 0, max_frame_bytes: 4194304,
  period_start: null, period_end: null,
};
const quotaBytes = (e) => nodeStorage(null, () => e).quotaBytes();
const admits = (e, open) => {
  const meter = new Meter({ start: 0, end: 1, fallback: true }, null, 0);
  for (let i = 0; i < open; i++) meter.connect(i, 0);
  return meter.admits(limitOf(enforcedEntitlements(e), "connections_max"));
};

describe("a v1 record (before coupons)", () => {
  it("is enforced with exactly the limits it holds", () => {
    const e = enforcedEntitlements(V1);
    for (const k of ["members_max", "storage_gb", "connections_max", "relay_gb_included", "secure_links_per_member", "secure_links_pool"]) expect([k, e[k]]).toEqual([k, V1[k]]);
    expect(e).toMatchObject({ unlimited: false, relay_unmetered: false, trial_clamped: false });
    expect(linkQuota(e)).toEqual({ per_member: 50, pool: 0 });
    expect(quotaBytes(V1)).toBe(30 * GB);
    expect([admits(V1, 8), admits(V1, 9)]).toEqual([true, false]);
    const freeV1 = { ...V1, tier: "free", interval: null, seats: 0, relay_gb_included: 2 };
    expect([relayAllowed(freeV1, 2 * GB - 1), relayAllowed(freeV1, 2 * GB), relayAllowed(V1, 1e15)]).toEqual([true, false, true]);
  });
});

describe("entitlements v2", () => {
  it("is versioned, and a plain plan's limits are what they were", () => {
    expect(ENTITLEMENTS_VERSION).toBe(2);
    expect(entitlements(team)).toEqual({ ...V1, v: 2, unlimited: false, relay_unmetered: false, trial_clamped: false });
  });

  it("an unlimited grant lifts every usage limit to null, and each reader takes null as no limit", () => {
    const e = entitlements({ ...team, tier: "business", grant_id: "design-partner", grant_unlimited: 1 });
    expect(e).toMatchObject({
      v: 2, tier: "business", seats: 25, interval: null, unlimited: true, relay_unmetered: true, members_max: null, storage_gb: null,
      connections_max: null, relay_gb_included: null, secure_links_per_member: null, secure_links_pool: null, workspaces_max: 1, max_frame_bytes: 4194304,
    });
    expect(linkQuota(e)).toEqual({ per_member: null, pool: null });
    expect(quotaBytes(e)).toBeNull();
    expect(admits(e, 10000)).toBe(true);
    expect(relayAllowed(e, 1e15)).toBe(true);
    expect(enforcedEntitlements(e)).toEqual(e);
  });

  it("relay past no limit is no overage; past a count it is the whole GB beyond it", () => {
    expect([overageGb(1e15, null), overageGb(0, null)]).toEqual([0, 0]);
    expect([overageGb(62 * GB, 60), overageGb(59 * GB, 60)]).toEqual([2, 0]);
    expect(() => overageGb(GB, undefined)).toThrow(/count or null/);
  });

  it("a null limit without unlimited is a record no limit can be read from", () => {
    expect(() => limitOf({ ...V1, storage_gb: null }, "storage_gb")).toThrow(/without being unlimited/);
    expect(() => quotaBytes({ ...V1, storage_gb: null })).toThrow(/without being unlimited/);
    expect(() => linkQuota({ ...V1, secure_links_pool: null })).toThrow(/without being unlimited/);
  });

  it("a grant redeemed as limited is its tier at its seats and storage, relay as the grant says", () => {
    const e = entitlements({ ...team, grant_id: "design-partner", grant_unlimited: 0 });
    expect(e).toMatchObject({ tier: "business", seats: 25, members_max: 25, storage_gb: 500, connections_max: 75, relay_gb_included: 1250, unlimited: false, relay_unmetered: true });
  });

  it("clamps a trial to trial_caps until Stripe calls it active", () => {
    const caps = COUPONS.trialCaps;
    for (const stripe_status of [null, "trialing", "past_due"]) {
      expect(entitlements({ ...team, trial_end: 1, stripe_status })).toMatchObject({
        trial_clamped: true, members_max: Math.min(3, caps.members), storage_gb: caps.storage_gb, connections_max: Math.min(9, caps.connections),
        relay_gb_included: caps.relay_gb, secure_links_per_member: caps.secure_links_per_member, secure_links_pool: caps.secure_links_pool,
      });
    }
    expect(entitlements({ ...team, trial_end: 1, stripe_status: "active" })).toMatchObject({ trial_clamped: false, storage_gb: 30, relay_gb_included: 60 });
    // A clamped paid tenant's relay is cut like a free one's.
    const trial = entitlements({ ...team, trial_end: 1, stripe_status: "trialing" });
    expect([relayAllowed(trial, 2 * GB - 1), relayAllowed(trial, 2 * GB)]).toEqual([true, false]);
  });

  it("states every coupon input, and refuses impossible ones", () => {
    const { trial_end: _t, ...unstated } = team;
    expect(() => entitlements(unstated)).toThrow(/entitlements need trial_end/);
    expect(() => entitlements({ ...team, grant_unlimited: true })).toThrow(/0 or 1/);
    expect(() => entitlements({ ...team, grant_unlimited: 1 })).toThrow(/needs its grant_id/);
    expect(() => entitlements({ ...team, grant_id: "no-such" })).toThrow(/no coupon grant/);
    expect(() => entitlements({ ...team, grant_id: "design-partner", trial_end: 5 })).toThrow(/not a trial/);
  });
});

describe("redeemable", () => {
  const c = { kind: "discount", template: "pct-10-once", grant_id: null, available_on: ["team"], intervals: ["month"], max_redemptions: 2, redeem_by_ms: 1000, revoked_at_ms: null };
  const plan = { tier: "team", interval: "month" };
  it("names why a code does not apply", () => {
    expect(redeemable(c, plan, 1000, 1)).toEqual({ ok: true });
    expect([
      redeemable(null, plan, 0, 0), redeemable(c, { ...plan, tier: "free" }, 0, 0), redeemable({ ...c, revoked_at_ms: 1 }, plan, 0, 0),
      redeemable(c, plan, 1001, 0), redeemable(c, { ...plan, tier: "business" }, 0, 0), redeemable(c, { ...plan, interval: "year" }, 0, 0), redeemable(c, plan, 0, 2),
    ].map((v) => v.reason)).toEqual(["unknown", "free-tier", "revoked", "expired", "wrong-tier", "wrong-interval", "exhausted"]);
    expect(redeemable({ ...c, redeem_by_ms: null }, plan, 8e15, 0)).toEqual({ ok: true });
  });
  it("normalises codes, and refuses what no code_shape matches", () => {
    expect([normaliseCode(" spring10 "), normaliseCode("ab"), normaliseCode(7), normaliseCode("x".repeat(65))]).toEqual(["SPRING10", null, null, null]);
  });
  it("offers what tiers.json says", () => {
    expect(offerOf({ kind: "comp", grant_id: "owner-internal" })).toEqual({ applies: true, kind: "comp", tier_as: "business", seats: 100 });
  });
});

describe("static codes", () => {
  // The tests' own table, through the pure loader: billing/tiers.json ships no public code.
  const table = structuredClone(tiers);
  table.coupons.static.push({ code: "TESTCODE10", template: "pct-10-once", available_on: ["team"], intervals: ["month"], max_redemptions: 3, redeem_by: "2099-01-01T00:00:00Z" });
  const listed = () => staticCouponsOf(couponCatalogue(table).statics);

  it("tiers.json ships none", async () => {
    expect(await staticCoupons()).toEqual([]);
  });
  it("a static code wins its own hash over any row, and is redeemable as a dynamic one would be", async () => {
    const statics = await listed();
    const hash = await codeHash("TESTCODE10");
    const found = pick(statics, hash, null);
    expect(found).toMatchObject({ source: "static", kind: "discount", template: "pct-10-once", available_on: ["team"], max_redemptions: 3, revoked_at_ms: null });
    expect(redeemable(found, { tier: "team", interval: "month" }, Date.now(), 0)).toEqual({ ok: true });
    expect(redeemable(found, { tier: "team", interval: "month" }, Date.now(), 3).reason).toBe("exhausted");
    expect(pick(statics, await codeHash("NOSUCHCODE2"), null)).toBeNull();
  });
  it("is what the admin route refuses to shadow or revoke", async () => {
    const statics = await listed();
    expect(isStaticHash(statics, await codeHash("TESTCODE10"))).toBe(true);
    expect(isStaticHash(statics, await codeHash("PARTNER-ACME"))).toBe(false);
    expect(isStaticHash(await staticCoupons(), await codeHash("TESTCODE10"))).toBe(false);
  });
});

describe("the spend alarm", () => {
  const alarm = { relay_gb_per_period: 500, storage_gb: 100, members: 250 };
  it("raises each threshold reached, per period for relay, and none for a null threshold", () => {
    const measured = { periods: [{ period_start: 10, bytes_in: 400 * GB, turn_bytes: 100 * GB }, { period_start: 5, bytes_in: 499.9 * GB, turn_bytes: 0 }], storage_bytes: 100 * GB, members: 249 };
    expect(alarmsOf(alarm, measured, 10)).toEqual([
      { metric: "relay_gb_per_period", value: 500, threshold: 500, period_start: 10 },
      { metric: "storage_gb", value: 100, threshold: 100, period_start: 10 },
    ]);
    expect(alarmsOf({ relay_gb_per_period: null, storage_gb: null, members: null }, { ...measured, members: 1e6 }, 10)).toEqual([]);
    expect(alarmsOf(alarm, { ...measured, members: 250 }, 10).map((a) => a.metric)).toContain("members");
  });
});
