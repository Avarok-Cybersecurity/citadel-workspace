/**
 * `POST /api/tenants/<slug>/overage` (control/overage-billing.mjs) through the real Worker: the
 * claim code is the proof, Free is refused, and the usage subscription follows the switch.
 */
import { describe, expect, it } from "vitest";
import {
  createBody, deliver, freshSlug, get, item, objectStats, outbound, post, subscriptionEvent, tenantRow,
} from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);
const created = (calls) => calls.filter((c) => c.url === "https://api.stripe.com/v1/subscriptions" && c.method === "POST");
const cancelled = (calls) => calls.filter((c) => c.method === "DELETE" && c.url.startsWith("https://api.stripe.com/v1/subscriptions/"));

/** An active monthly Team tenant with overage billing as chosen, and its claim code. */
async function activeTeam(overage_billing) {
  const slug = freshSlug("ov");
  const sessionId = `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
  outbound({ checkout: { id: sessionId } });
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 2, overage_billing }))).status).toBe(201);
  const row = await tenantRow(slug);
  const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 2)] });
  expect((await deliver(event)).status).toBe(200);
  const completed = {
    id: `evt_${crypto.randomUUID()}`, type: "checkout.session.completed", created: now(),
    data: { object: { id: sessionId, customer: "cus_test_1", subscription: "sub_test_1", payment_status: "paid", metadata: { tenant: slug, tenant_id: row.tenant_id } } },
  };
  expect((await deliver(completed)).status).toBe(200);
  const { claim_code } = await (await get(`/api/tenants/${slug}/status?session_id=${sessionId}`)).json();
  expect(claim_code).toMatch(/^[0-9a-f]{64}$/);
  return { slug, claim_code, tenant_id: row.tenant_id };
}

describe("the owner's overage switch", () => {
  it("off then on: cancels the usage subscription, then creates a new one under a new key", async () => {
    const { slug, claim_code, tenant_id } = await activeTeam(true);
    expect((await tenantRow(slug)).usage_subscription).toBe("sub_usage_1");

    const off = outbound();
    const r = await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: false });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ overage_billing: false });
    expect(cancelled(off.calls).map((c) => c.url)).toEqual(["https://api.stripe.com/v1/subscriptions/sub_usage_1"]);
    expect(await tenantRow(slug)).toMatchObject({ overage_billing: 0, usage_subscription: null, usage_subscription_ended: "sub_usage_1" });
    expect((await objectStats(slug)).entitlements.overage_billing).toBe(false);

    const on = outbound();
    expect(await (await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: true })).json()).toEqual({ overage_billing: true });
    const [call] = created(on.calls);
    // Not the key of the one cancelled: within Stripe's idempotency window that would answer with it.
    expect(call.headers["idempotency-key"]).toBe(`usage-sub-${tenant_id}-after-sub_usage_1`);
    expect(await tenantRow(slug)).toMatchObject({ overage_billing: 1, usage_subscription: "sub_usage_1" });
    expect((await objectStats(slug)).entitlements.overage_billing).toBe(true);
  });

  it("on for a tenant that chose off creates the subscription; repeating it creates nothing more", async () => {
    const { slug, claim_code } = await activeTeam(false);
    const { calls } = outbound();
    expect((await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: true })).status).toBe(200);
    expect((await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: true })).status).toBe(200);
    expect(created(calls)).toHaveLength(1);
    expect((await tenantRow(slug)).usage_subscription).toBe("sub_usage_1");
  });

  it("a Stripe failure changes nothing", async () => {
    const { slug, claim_code } = await activeTeam(false);
    outbound({ subscriptions: { failures: 1 } });
    expect((await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: true })).status).toBe(500);
    expect(await tenantRow(slug)).toMatchObject({ overage_billing: 0, usage_subscription: null });
    expect((await objectStats(slug)).entitlements.overage_billing).toBe(false);
  });

  it("refuses a wrong code, an unknown workspace and a bad slug as the portal does", async () => {
    const { slug } = await activeTeam(true);
    const { calls } = outbound();
    const wrong = await post(`/api/tenants/${slug}/overage`, { claim_code: "0".repeat(64), enabled: false });
    expect([wrong.status, (await wrong.json()).error]).toEqual([403, "not-owner"]);
    const nobody = await post(`/api/tenants/${freshSlug("none")}/overage`, { claim_code: "0".repeat(64), enabled: false });
    expect([nobody.status, (await nobody.json()).error]).toEqual([403, "not-owner"]);
    const bad = await post("/api/tenants/AB/overage", { claim_code: "0".repeat(64), enabled: false });
    expect([bad.status, (await bad.json()).error]).toEqual([404, "not-found"]);
    expect(calls.filter((c) => c.url.startsWith("https://api.stripe.com/"))).toEqual([]);
    expect((await tenantRow(slug)).overage_billing).toBe(1);
  });

  it("refuses a body without a boolean `enabled`, or with other fields", async () => {
    const { slug, claim_code } = await activeTeam(true);
    outbound();
    for (const body of [{ claim_code }, { claim_code, enabled: "false" }, { claim_code, enabled: false, tier: "free" }]) {
      expect((await post(`/api/tenants/${slug}/overage`, body)).status).toBe(400);
    }
    expect((await tenantRow(slug)).overage_billing).toBe(1);
  });

  it("refuses the free plan with 409 free-plan, and asks Stripe nothing", async () => {
    const slug = freshSlug("ovf");
    outbound();
    const { claim_code } = await (await post("/api/tenants", createBody(slug))).json();
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/overage`, { claim_code, enabled: true });
    expect([r.status, (await r.json()).error]).toEqual([409, "free-plan"]);
    expect(calls).toEqual([]);
    expect((await tenantRow(slug)).overage_billing).toBe(0);
  });
});
