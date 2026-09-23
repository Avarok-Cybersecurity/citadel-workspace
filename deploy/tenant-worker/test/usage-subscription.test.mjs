/**
 * The usage-only subscription a yearly paid tenant gets so its relay overage is billed
 * (control/usage-subscription.mjs), through the real Worker's webhook. Stripe is the one mock.
 */
import { describe, expect, it } from "vitest";
import { createBody, deliver, eventRecorded, freshSlug, item, outbound, post, PRICES, subscriptionEvent, tenantRow } from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);
const evt = () => `evt_${crypto.randomUUID()}`;

async function pending(interval) {
  const slug = freshSlug("us");
  outbound();
  const r = await post("/api/tenants", createBody(slug, { tier: "team", interval, seats: 2 }));
  expect(r.status).toBe(201);
  return tenantRow(slug);
}

const created = (calls) => calls.filter((c) => c.url === "https://api.stripe.com/v1/subscriptions" && c.method === "POST");
const cancelled = (calls) => calls.filter((c) => c.method === "DELETE" && c.url.startsWith("https://api.stripe.com/v1/subscriptions/"));

describe("a yearly plan's usage subscription", () => {
  it("is created once when the yearly plan becomes active, carrying only the overage price", async () => {
    const row = await pending("year");
    const { calls } = outbound();
    const items = [item("citadel-team-year", 2)];
    const r = await deliver(subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), items }));
    expect(r.status).toBe(200);
    const [call, ...more] = created(calls);
    expect(more).toEqual([]);
    expect(Object.fromEntries(call.form)).toEqual({
      customer: "cus_test_1",
      "items[0][price]": PRICES["citadel-relay-overage"],
      "metadata[tenant]": row.slug,
      "metadata[tenant_id]": row.tenant_id,
      "metadata[kind]": "usage",
    });
    expect(call.headers["idempotency-key"]).toBe(`usage-sub-${row.tenant_id}`);
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", interval: "year", usage_subscription: "sub_usage_1" });

    // A later update of the same plan creates nothing more.
    await deliver(subscriptionEvent("customer.subscription.updated", row, { id: evt(), created: now() + 1, items }));
    expect(created(calls)).toHaveLength(1);
  });

  it("is not created for a monthly plan, whose own subscription carries the metered price", async () => {
    const row = await pending("month");
    const { calls } = outbound();
    await deliver(subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), items: [item("citadel-team-month", 2)] }));
    expect(created(calls)).toEqual([]);
    expect((await tenantRow(row.slug)).usage_subscription).toBeNull();
  });

  it("is cancelled when the yearly plan ends", async () => {
    const row = await pending("year");
    outbound();
    await deliver(subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), items: [item("citadel-team-year", 2)] }));
    const { calls } = outbound();
    await deliver(subscriptionEvent("customer.subscription.deleted", row, { id: evt(), created: now() + 1, status: "canceled", items: [item("citadel-team-year", 2)] }));
    expect(cancelled(calls).map((c) => c.url)).toEqual(["https://api.stripe.com/v1/subscriptions/sub_usage_1"]);
    expect(await tenantRow(row.slug)).toMatchObject({ tier: "free", usage_subscription: null });
  });

  it("is replaced when the customer cancels it, so overage cannot go unbilled", async () => {
    const row = await pending("year");
    outbound();
    await deliver(subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), items: [item("citadel-team-year", 2)] }));
    const { calls } = outbound();
    const gone = subscriptionEvent("customer.subscription.deleted", row, {
      id: evt(), created: now() + 1, status: "canceled", subId: "sub_usage_1", items: [item("citadel-relay-overage")],
    });
    expect((await deliver(gone)).status).toBe(200);
    const [call] = created(calls);
    expect(call.headers["idempotency-key"]).toBe(`usage-sub-${row.tenant_id}-after-sub_usage_1`);
    // The plan itself is untouched: still Team, yearly, active.
    expect(await tenantRow(row.slug)).toMatchObject({ tier: "team", interval: "year", status: "active", usage_subscription: "sub_usage_1" });
  });

  it("a Stripe failure records nothing, so Stripe's retry creates it", async () => {
    const row = await pending("year");
    outbound({ subscriptions: { failures: 1 } });
    const event = subscriptionEvent("customer.subscription.created", row, { id: evt(), created: now(), items: [item("citadel-team-year", 2)] });
    expect((await deliver(event)).status).toBe(500);
    expect(await eventRecorded(event.id)).toBe(false);
    expect((await tenantRow(row.slug)).status).toBe("pending");
    outbound();
    expect((await deliver(event)).status).toBe(200);
    expect((await tenantRow(row.slug)).usage_subscription).toBe("sub_usage_1");
  });
});
