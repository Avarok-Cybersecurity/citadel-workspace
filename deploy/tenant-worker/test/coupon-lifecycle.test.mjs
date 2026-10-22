/**
 * A coupon after creation: the webhook confirming its redemption, a trial's clamp and its cardless
 * end, a comp grant's activation, and the monitor keeping a grant and raising its spend alarm.
 * Real Worker, D1 and tenant objects; Stripe and Turnstile answered at the fetch boundary.
 */
import { env } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import {
  deliver, freshSlug, item, monitorOf, objectStats, outbound, post, relay, sha256Hex, subscriptionEvent, tenantObject, tenantRow,
} from "./helpers.mjs";
import { eventsOf, issueCode, paidBody, redemptionsOf } from "./coupon-helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);
const evt = () => `evt_${crypto.randomUUID()}`;
const UNLIMITED = {
  unlimited: true, relay_unmetered: true, members_max: null, storage_gb: null, connections_max: null, relay_gb_included: null,
  secure_links_per_member: null, secure_links_pool: null, workspaces_max: 1, max_frame_bytes: 4194304, v: 2,
};

const completed = (row, sessionId, paymentStatus) => ({
  id: evt(), type: "checkout.session.completed", created: now(),
  data: { object: { id: sessionId, customer: "cus_test_1", subscription: "sub_test_1", payment_status: paymentStatus, metadata: { tenant: row.slug, tenant_id: row.tenant_id } } },
});

/** A pending Team creation with `code`, and its Checkout Session id. */
async function pendingWith(code) {
  const slug = freshSlug("lc");
  const sessionId = `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
  outbound({ checkout: { id: sessionId } });
  expect((await post("/api/tenants", paidBody(slug, { coupon_code: code }))).status).toBe(201);
  return { row: await tenantRow(slug), sessionId };
}

/** An active comp tenant created through the control plane with a fresh unlimited code. */
async function compTenant() {
  const code = await issueCode({ grant_id: "design-partner", available_on: ["business"], intervals: ["month"], max_redemptions: 1 });
  const slug = freshSlug("comp");
  const { calls } = outbound();
  const r = await post("/api/tenants", paidBody(slug, { tier: "business", coupon_code: code }));
  return { code, slug, r, calls };
}

describe("a discount", () => {
  it("is redeemed when its Checkout completes, in the same batch as the activation", async () => {
    const code = await issueCode({ template: "pct-10-once" });
    const { row, sessionId } = await pendingWith(code);
    expect((await deliver(completed(row, sessionId, "paid"))).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active" });
    expect(await redemptionsOf(code)).toMatchObject([{ tenant_id: row.tenant_id, state: "redeemed" }]);
    expect((await eventsOf(code)).map((e) => e.action)).toEqual(["issue", "reserve", "redeem"]);
  });
});

describe("a trial", () => {
  it("is clamped to trial_caps while trialing, and the clamp lifts once Stripe calls it active", async () => {
    const code = await issueCode({ template: "trial-14" });
    const { row, sessionId } = await pendingWith(code);
    expect((await deliver(completed(row, sessionId, "no_payment_required"))).status).toBe(200);
    const trialEnd = now() + 14 * 86400;
    const trialing = subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), status: "trialing", items: [item("citadel-team-month", 3)] });
    trialing.data.object.trial_end = trialEnd;
    expect((await deliver(trialing)).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", stripe_status: "trialing", trial_end: trialEnd });
    expect((await objectStats(row.slug)).entitlements).toMatchObject({
      trial_clamped: true, members_max: 3, storage_gb: 1, connections_max: 9, relay_gb_included: 2, secure_links_per_member: 5, secure_links_pool: 0,
    });
    expect(await redemptionsOf(code)).toMatchObject([{ state: "redeemed" }]);

    // A card was added: the trial ended into an active subscription.
    const active = subscriptionEvent("customer.subscription.updated", row, { id: evt(), created: now() + 1, status: "active", items: [item("citadel-team-month", 3)] });
    active.data.object.trial_end = trialEnd;
    expect((await deliver(active)).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ stripe_status: "active", trial_end: null });
    expect((await objectStats(row.slug)).entitlements).toMatchObject({
      trial_clamped: false, members_max: 3, storage_gb: 30, connections_max: 9, relay_gb_included: 60, secure_links_per_member: 50,
    });
  });

  it("that ends with no card is cancelled by Stripe, and the tenant falls back to Free with its data", async () => {
    const code = await issueCode({ template: "trial-14" });
    const { row, sessionId } = await pendingWith(code);
    await deliver(completed(row, sessionId, "no_payment_required"));
    const trialing = subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), status: "trialing", items: [item("citadel-team-month", 3)] });
    trialing.data.object.trial_end = now() + 60;
    await deliver(trialing);
    const before = await objectStats(row.slug);
    const ended = subscriptionEvent("customer.subscription.deleted", row, { id: evt(), created: now() + 2, status: "canceled", items: [item("citadel-team-month", 3)] });
    expect((await deliver(ended)).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", tier: "free", seats: 0, interval: null, trial_end: null, stripe_status: null });
    const after = await objectStats(row.slug);
    expect(after.entitlements).toMatchObject({ tier: "free", trial_clamped: false, members_max: 5, storage_gb: 1 });
    // The same workspace: provisioned, under the same master password.
    expect(after.master_password_sha256_prefix).toBe(before.master_password_sha256_prefix);
  });

  it("is recorded but never billed for relay beyond its clamp", async () => {
    const code = await issueCode({ template: "trial-14" });
    const { row, sessionId } = await pendingWith(code);
    await deliver(completed(row, sessionId, "no_payment_required"));
    const trialing = subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), status: "trialing", items: [item("citadel-team-month", 3)] });
    trialing.data.object.trial_end = now() + 86400;
    await deliver(trialing);
    await relay(row.slug, 5e9);
    const { calls } = outbound();
    await monitorOf(row.slug)();
    expect(calls.filter((c) => c.url.endsWith("/v1/billing/meter_events"))).toEqual([]);
  });
});

describe("a comp grant", () => {
  it("creates an active tenant with no Stripe call at all, unlimited, its redemption redeemed", async () => {
    const { code, slug, r, calls } = await compTenant();
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ slug, status: "active", workspace_host: `${slug}.work.avarok.net` });
    expect(body.claim_code).toMatch(/^[0-9a-f]{64}$/);
    expect(body.checkout_url).toBeUndefined();
    expect(calls.map((c) => new URL(c.url).hostname)).toEqual(["challenges.cloudflare.com"]);
    const row = await tenantRow(slug);
    expect(row).toMatchObject({
      status: "active", tier: "business", seats: 25, interval: null, grant_id: "design-partner", grant_unlimited: 1,
      stripe_customer: null, stripe_subscription: null, expires_at: null, claim_hash: await sha256Hex(body.claim_code),
    });
    expect(await redemptionsOf(code)).toMatchObject([{ tenant_id: row.tenant_id, state: "redeemed" }]);
    expect((await objectStats(slug)).entitlements).toMatchObject({ ...UNLIMITED, status: "active", tier: "business", seats: 25 });
  });

  it("survives the monitor: drift repair pushes the unlimited entitlements, never reverts them", async () => {
    const { slug } = await compTenant();
    const granted = (await objectStats(slug)).entitlements;
    const warn = vi.spyOn(console, "warn");
    outbound();
    await monitorOf(slug)();
    expect((await objectStats(slug)).entitlements).toEqual(granted);
    expect(warn.mock.calls.filter(([m]) => String(m).includes(`${slug}: the object's entitlements differ`))).toEqual([]);
    // An object that lost them (a push that never landed) is given them back.
    await tenantObject(slug).setEntitlements({ ...granted, unlimited: false, members_max: 25, connections_max: 75 });
    await monitorOf(slug)();
    expect((await objectStats(slug)).entitlements).toEqual(granted);
  });

  it("is neither billed nor cut for relay, and raises its spend alarm once per period", async () => {
    const { code, slug } = await compTenant();
    const row = await tenantRow(slug);
    await relay(slug, 501e9);
    const warn = vi.spyOn(console, "warn");
    const { calls } = outbound();
    await monitorOf(slug)();
    await monitorOf(slug)();
    expect(calls.filter((c) => c.url.includes("api.stripe.com"))).toEqual([]);
    const alarms = (await env.CONTROL_DB.prepare("SELECT detail FROM coupon_events WHERE tenant_id = ? AND action = 'alarm'").bind(row.tenant_id).all()).results;
    expect(alarms.map((a) => JSON.parse(a.detail))).toMatchObject([{ metric: "relay_gb_per_period", value: 501, threshold: 500 }]);
    expect(warn.mock.calls.filter(([m]) => m === `[monitor] ALARM ${slug} relay_gb_per_period 501`)).toHaveLength(1);
    expect((await eventsOf(code)).filter((e) => e.action === "alarm")).toHaveLength(1);
    // Nothing was cut: the grant and its unlimited entitlements stand.
    expect((await objectStats(slug)).entitlements).toMatchObject(UNLIMITED);
    expect(await env.CONTROL_DB.prepare("SELECT 1 FROM tenant_usage WHERE tenant_id = ?").bind(row.tenant_id).first()).toBeNull();
  });
});
