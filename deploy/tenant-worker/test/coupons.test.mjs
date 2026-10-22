/**
 * Coupons at creation and preview, through the real Worker and D1. The only mock is helpers.mjs
 * `outbound` at the fetch boundary (Turnstile and Stripe).
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { couponFor } from "../control/coupons.mjs";
import { createTenant } from "../control/tenants.mjs";
import { config } from "../control/http.mjs";
import { CouponStore } from "../control/coupon-store.mjs";
import { codeHash } from "../control/coupon-rules.mjs";
import { EXHAUSTED, RESERVED } from "../control/store.mjs";
import { createBody, freshSlug, outbound, post, tenantObject, tenantRow } from "./helpers.mjs";
import { eventsOf, freshIp, issueCode, paidBody, preview, previewBody, redemptionsOf, UNAVAILABLE_BODY } from "./coupon-helpers.mjs";

const checkoutForm = (calls) => Object.fromEntries(calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form);

/** Every way a code can fail to apply, each as `[name, code, plan]`. */
async function refusals() {
  const expired = await issueCode({ template: "pct-10-once", redeem_by_ms: Date.now() - 1000 });
  const exhausted = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
  outbound();
  expect((await post("/api/tenants", paidBody(freshSlug("ex"), { coupon_code: exhausted }))).status).toBe(201);
  const revoked = await issueCode({ template: "pct-10-once" });
  await env.CONTROL_DB.prepare("UPDATE coupons SET revoked_at_ms = ? WHERE code_hash = ?").bind(Date.now(), await codeHash(revoked)).run();
  const businessOnly = await issueCode({ template: "pct-10-once", available_on: ["business"] });
  const monthOnly = await issueCode({ template: "pct-20-3mo", intervals: ["month"] });
  return [
    ["unknown", "NOSUCHCODE1", {}],
    ["expired", expired, {}],
    ["exhausted", exhausted, {}],
    ["revoked", revoked, {}],
    ["wrong tier", businessOnly, {}],
    ["wrong interval", monthOnly, { interval: "year" }],
    ["badly shaped", "x", {}],
  ];
}

describe("a code that does not apply", () => {
  it("is refused at creation with the same bytes whatever the reason, and reserves nothing", async () => {
    const bodies = [];
    for (const [name, code, plan] of await refusals()) {
      const slug = freshSlug("cr");
      const before = (await redemptionsOf(code)).length;
      const { calls } = outbound();
      const r = await post("/api/tenants", paidBody(slug, { coupon_code: code, ...plan }));
      expect([name, r.status]).toEqual([name, 400]);
      bodies.push([name, await r.text()]);
      expect(await tenantRow(slug)).toBeNull();
      expect((await redemptionsOf(code)).length).toBe(before);
      // Judged after Turnstile, before anything at Stripe.
      expect(calls.filter((c) => c.url.includes("api.stripe.com"))).toEqual([]);
    }
    for (const [name, body] of bodies) expect([name, body]).toEqual([name, UNAVAILABLE_BODY]);
  });

  it("is refused at preview with the same bytes, the free tier among them", async () => {
    const ip = freshIp();
    const applies = await issueCode({ template: "pct-10-once" });
    const cases = [...(await refusals()), ["free tier", applies, { tier: "free" }]];
    for (const [name, code, plan] of cases) {
      const r = await preview(previewBody(code, plan), ip);
      expect([name, r.status, await r.text()]).toEqual([name, 400, UNAVAILABLE_BODY]);
    }
  });

  it("the free tier takes no coupon_code at creation", async () => {
    outbound();
    const r = await post("/api/tenants", createBody(freshSlug("fc"), { coupon_code: await issueCode({ template: "pct-10-once" }) }));
    expect(r.status).toBe(400);
    expect((await r.json()).detail).toMatch(/the free tier takes no .*coupon_code/);
  });
});

describe("a code that applies", () => {
  it("reserves exactly one redemption with the slug, and its discount is the Checkout's", async () => {
    const code = await issueCode({ template: "pct-20-3mo", intervals: ["month"] });
    const slug = freshSlug("cd");
    const { calls } = outbound();
    const r = await post("/api/tenants", paidBody(slug, { coupon_code: ` ${code.toLowerCase()} ` }));
    expect(r.status).toBe(201);
    const row = await tenantRow(slug);
    expect(await redemptionsOf(code)).toMatchObject([{ tenant_id: row.tenant_id, slug, state: "pending", max_redemptions: 100 }]);
    expect(await eventsOf(code)).toEqual([{ action: "issue", tenant_id: null }, { action: "reserve", tenant_id: row.tenant_id }]);
    expect(checkoutForm(calls)["discounts[0][coupon]"]).toMatch(/^citadel-coupon-pct-20-3mo-[0-9a-f]{8}$/);
    expect(row.coupon_hash).toBe((await redemptionsOf(code))[0].coupon_hash);
  });

  it("previews as the UI's contract says, a code typed in lower case among them", async () => {
    const ip = freshIp();
    const percent = await issueCode({ template: "pct-10-once" });
    const trial = await issueCode({ template: "trial-14" });
    const amount = await issueCode({ template: "usd-10-once" });
    const repeating = await issueCode({ template: "pct-20-3mo", intervals: ["month"] });
    const comp = await issueCode({ grant_id: "design-partner", available_on: ["business"], intervals: ["month"], max_redemptions: 1 });
    const answers = [];
    for (const [code, plan] of [[percent.toLowerCase(), {}], [trial, {}], [amount, {}], [repeating, {}], [comp, { tier: "business" }]]) {
      const r = await preview(previewBody(code, plan), ip);
      expect(r.status).toBe(200);
      answers.push(await r.json());
    }
    expect(answers).toEqual([
      { applies: true, kind: "discount", percent_off: 10, duration: "once" },
      { applies: true, kind: "trial", days: 14 },
      { applies: true, kind: "discount", amount_off_cents: 1000, duration: "once" },
      { applies: true, kind: "discount", percent_off: 20, duration: "repeating", months: 3 },
      { applies: true, kind: "comp", tier_as: "business", seats: 25 },
    ]);
    // A preview reserves nothing.
    expect(await redemptionsOf(comp)).toEqual([]);
  });

  it("a trial's Checkout asks for no card and cancels without one, for the template's days", async () => {
    const code = await issueCode({ template: "trial-14" });
    const slug = freshSlug("ct");
    const { calls } = outbound();
    expect((await post("/api/tenants", paidBody(slug, { coupon_code: code }))).status).toBe(201);
    expect(checkoutForm(calls)).toMatchObject({
      "subscription_data[trial_period_days]": "14",
      payment_method_collection: "if_required",
      "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
    });
    expect(checkoutForm(calls)["discounts[0][coupon]"]).toBeUndefined();
    const row = await tenantRow(slug);
    expect(row.trial_end - row.created_at).toBe(14 * 86400);
    // Pending, and clamped from the start: a trial is free-tier-sized until Stripe says active.
    // (A pending tenant is not reachable through the Worker; its object is asked directly.)
    expect((await tenantObject(slug).stats()).entitlements).toMatchObject({ trial_clamped: true, members_max: 3, storage_gb: 1, connections_max: 9, relay_gb_included: 2 });
  });
});

describe("the last redemption", () => {
  it("two creations racing for it: one is created, the other refused, one row", async () => {
    const code = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
    outbound();
    const results = await Promise.all([0, 1].map(() => post("/api/tenants", paidBody(freshSlug("race"), { coupon_code: code }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await redemptionsOf(code)).toHaveLength(1);
  });

  it("is refused inside the reservation batch even when the check before it saw it free", async () => {
    const code = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
    const io = ioFor(env);
    const plan = { tier: "team", interval: "month" };
    // Both creations judged before either reserved: both see the coupon free.
    const [a, b] = await Promise.all([0, 1].map(() => couponFor(io, code, { ...plan, slug: freshSlug("tb") })));
    const reserve = async (coupon) => {
      const now = io.now();
      const row = {
        slug: freshSlug("tb"), tenant_id: crypto.randomUUID().replaceAll("-", ""), display_name: "x", tier: "team", interval: "month", seats: 1,
        storage_blocks: 0, link_packs: 0, expires_at: now + 3600, claim_hash: "h", reservation_hash: null, customer_terms_version: 1,
        coupon_hash: coupon.code_hash, grant_id: null, grant_unlimited: 0, trial_end: null, stripe_status: null,
      };
      return io.store.reserve(row, now, io.coupons.reservation({ coupon, row, nowSec: now, nowMs: Date.now(), replacing: null }));
    };
    expect(await reserve(a.coupon)).toBe(RESERVED);
    expect(await reserve(b.coupon)).toBe(EXHAUSTED);
    expect(await redemptionsOf(code)).toHaveLength(1);
  });

  it("a creation whose check read the coupon free just before another took it is refused uniformly", async () => {
    const code = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
    outbound();
    expect((await post("/api/tenants", paidBody(freshSlug("st"), { coupon_code: code }))).status).toBe(201);
    // The interleaving of a race, made deterministic: this creation's lookup is answered as it was
    // read before the other creation's batch committed.
    class StaleRead extends CouponStore {
      async lookup(...args) {
        return { ...(await super.lookup(...args)), held: 0 };
      }
    }
    const real = ioFor(env);
    const stale = new StaleRead(env.CONTROL_DB);
    const slug = freshSlug("st");
    outbound();
    const r = await createTenant({ ...real, coupons: stale }, config(env), paidBody(slug, { coupon_code: code }), "203.0.113.9");
    expect([r.status, await r.text()]).toEqual([400, UNAVAILABLE_BODY]);
    expect(await tenantRow(slug)).toBeNull();
    expect(await redemptionsOf(code)).toHaveLength(1);
  });

  it("a cancelled Checkout's retry gives its redemption back and takes it again", async () => {
    const code = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
    const slug = freshSlug("rr");
    outbound();
    const first = await (await post("/api/tenants", paidBody(slug, { coupon_code: code }))).json();
    const firstRow = await tenantRow(slug);
    outbound();
    const r = await post("/api/tenants", paidBody(slug, { coupon_code: code, reservation_token: first.reservation_token }));
    expect(r.status).toBe(201);
    const row = await tenantRow(slug);
    expect(row.tenant_id).not.toBe(firstRow.tenant_id);
    expect((await redemptionsOf(code)).map((x) => x.tenant_id)).toEqual([row.tenant_id]);
    // Someone else cannot have it meanwhile.
    outbound();
    expect((await post("/api/tenants", paidBody(freshSlug("rr"), { coupon_code: code }))).status).toBe(400);
  });

  it("a creation that fails at Stripe gives its redemption back", async () => {
    const code = await issueCode({ template: "pct-10-once", max_redemptions: 1 });
    const { PRICES } = await import("./helpers.mjs");
    const saved = PRICES["citadel-team-month"];
    delete PRICES["citadel-team-month"];
    outbound();
    try {
      expect((await post("/api/tenants", paidBody(freshSlug("sf"), { coupon_code: code }))).status).toBe(502);
    } finally {
      PRICES["citadel-team-month"] = saved;
    }
    expect(await redemptionsOf(code)).toEqual([]);
    expect((await eventsOf(code)).map((e) => e.action)).toEqual(["issue", "reserve", "release"]);
    outbound();
    expect((await post("/api/tenants", paidBody(freshSlug("sf"), { coupon_code: code }))).status).toBe(201);
  });
});
