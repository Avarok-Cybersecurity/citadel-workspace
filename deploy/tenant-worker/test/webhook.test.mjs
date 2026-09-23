/** The Stripe webhook through the real Worker: signature, activation, idempotency, ordering, claim. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  createBody, deliver, eventRecorded, freshSlug, get, item, objectStats, outbound, post, sha256Hex, subscriptionEvent, tenantRow,
} from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);

/** A pending Team tenant (3 seats + 2 blocks) and the Checkout Session id that created it. */
async function pendingTeam() {
  const slug = freshSlug("wh");
  const sessionId = `cs_test_${crypto.randomUUID().replaceAll("-", "")}`;
  outbound({ checkout: { id: sessionId } });
  const r = await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3, storage_blocks: 2 }));
  expect(r.status).toBe(201);
  return { row: await tenantRow(slug), sessionId };
}

const completed = (row, sessionId, id) => ({
  id,
  type: "checkout.session.completed",
  created: now(),
  data: { object: { id: sessionId, object: "checkout.session", customer: "cus_test_1", subscription: "sub_test_1", payment_status: "paid", metadata: { tenant: row.slug, tenant_id: row.tenant_id } } },
});

const teamItems = [item("citadel-team-month", 3), item("citadel-storage-month", 2)];

describe("signature", () => {
  it("a bad, stale or missing signature is 400 and changes nothing", async () => {
    const { row } = await pendingTeam();
    const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: teamItems });
    expect((await deliver(event, { secret: "whsec_wrong" })).status).toBe(400);
    expect((await deliver(event, { timestamp: now() - 301 })).status).toBe(400);
    expect((await deliver(event, { header: "" })).status).toBe(400);
    expect(await eventRecorded(event.id)).toBe(false);
    expect((await tenantRow(row.slug)).status).toBe("pending");
  });
});

describe("activation", () => {
  it("subscription.created then checkout.session.completed: active with the bought entitlements, claim once", async () => {
    const { row, sessionId } = await pendingTeam();
    const created = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: teamItems });
    const r1 = await deliver(created);
    expect(r1.status).toBe(200);
    expect(await r1.json()).toMatchObject({ received: true, applied: true, tenant: row.slug });
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", tier: "team", seats: 3, storage_blocks: 2, stripe_customer: "cus_test_1", stripe_subscription: "sub_test_1" });

    expect((await deliver(completed(row, sessionId, `evt_${crypto.randomUUID()}`))).status).toBe(200);

    const stats = await objectStats(row.slug);
    expect(stats.entitlements).toEqual({
      status: "active", tier: "team", interval: "month", seats: 3, storage_blocks: 2, members_max: 3, storage_gb: 50, workspaces_max: 1, priority_support: false,
      connections_max: 9, relay_gb_included: 60, max_frame_bytes: 4194304, period_start: null, period_end: null,
    });

    // The claim code: only to the holder of the session id, exactly once, and it is the object's password.
    expect((await (await get(`/api/tenants/${row.slug}/status?session_id=cs_test_wrong_session`)).json()).claim_code).toBeUndefined();
    const first = await (await get(`/api/tenants/${row.slug}/status?session_id=${sessionId}`)).json();
    expect(first).toMatchObject({ status: "active", tier: "team" });
    expect(first.claim_code).toMatch(/^[0-9a-f]{64}$/);
    expect(await sha256Hex(first.claim_code)).toBe(row.claim_hash);
    expect(stats.master_password_sha256_prefix).toBe(row.claim_hash.slice(0, 8));
    expect((await (await get(`/api/tenants/${row.slug}/status?session_id=${sessionId}`)).json()).claim_code).toBeUndefined();
    expect((await tenantRow(row.slug)).claim_sealed).toBeNull();

    // The owner's portal: the claim code authenticates, anything else does not.
    const { calls } = outbound();
    expect((await post(`/api/tenants/${row.slug}/portal`, { claim_code: "0".repeat(64) })).status).toBe(403);
    const portal = await post(`/api/tenants/${row.slug}/portal`, { claim_code: first.claim_code });
    expect(portal.status).toBe(200);
    expect(new URL((await portal.json()).portal_url).host).toBe("billing.stripe.com");
    expect(calls.at(-1).form.get("customer")).toBe("cus_test_1");
  });

  it("checkout.session.completed alone activates the plan the tenant was created with", async () => {
    const { row } = await pendingTeam();
    expect((await deliver(completed(row, "cs_other", `evt_${crypto.randomUUID()}`))).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", tier: "team", seats: 3, storage_blocks: 2 });
  });
});

describe("idempotency and ordering", () => {
  it("the same event twice has one effect", async () => {
    const { row } = await pendingTeam();
    const id = `evt_${crypto.randomUUID()}`;
    await deliver(subscriptionEvent("customer.subscription.created", row, { id, created: now(), items: teamItems }));
    // An operator edit between the deliveries shows whether the repeat re-applies anything.
    await env.CONTROL_DB.prepare("UPDATE tenants SET seats = 99 WHERE slug = ?").bind(row.slug).run();
    const again = await deliver(subscriptionEvent("customer.subscription.created", row, { id, created: now(), items: teamItems }));
    expect(await again.json()).toEqual({ received: true, repeated: true });
    expect((await tenantRow(row.slug)).seats).toBe(99);
    const count = await env.CONTROL_DB.prepare("SELECT COUNT(*) AS n FROM stripe_events WHERE id = ?").bind(id).first();
    expect(count.n).toBe(1);
  });

  it("a failed entitlement write is not recorded, and Stripe's retry applies it", async () => {
    const { row } = await pendingTeam();
    const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: teamItems });
    await env.CONTROL_DB.prepare(
      `CREATE TRIGGER injected_failure BEFORE UPDATE ON tenants WHEN OLD.slug = '${row.slug}' BEGIN SELECT RAISE(ABORT, 'injected'); END`,
    ).run();
    try {
      expect((await deliver(event)).status).toBe(500);
      expect(await eventRecorded(event.id)).toBe(false);
      expect((await tenantRow(row.slug)).status).toBe("pending");
    } finally {
      await env.CONTROL_DB.prepare("DROP TRIGGER injected_failure").run();
    }
    expect((await deliver(event)).status).toBe(200);
    expect(await eventRecorded(event.id)).toBe(true);
    expect((await tenantRow(row.slug)).status).toBe("active");
  });

  it("a failed push to the tenant's object is not recorded either", async () => {
    // A registry row whose object was never provisioned: the object refuses the entitlements.
    const slug = freshSlug("np");
    const row = { slug, tenant_id: crypto.randomUUID().replaceAll("-", "") };
    await env.CONTROL_DB.prepare(
      "INSERT INTO tenants (slug, tenant_id, display_name, status, tier, interval, seats, storage_blocks, created_at, expires_at, claim_hash) " +
        "VALUES (?, ?, 'x', 'pending', 'team', 'month', 3, 0, ?, ?, 'h')",
    ).bind(slug, row.tenant_id, now(), now() + 3600).run();
    const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: teamItems });
    expect((await deliver(event)).status).toBe(500);
    expect(await eventRecorded(event.id)).toBe(false);
    expect((await tenantRow(slug)).status).toBe("pending");
  });

  it("an older subscription event after a newer one changes nothing", async () => {
    const { row } = await pendingTeam();
    const t = now();
    await deliver(subscriptionEvent("customer.subscription.updated", row, { id: `evt_${crypto.randomUUID()}`, created: t, items: [item("citadel-team-month", 7)] }));
    const stale = await deliver(subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: t - 10, items: teamItems }));
    expect((await stale.json()).applied).toBe(false);
    expect((await tenantRow(row.slug)).seats).toBe(7);
  });

  it("deletion downgrades to free; an unknown price is refused unrecorded", async () => {
    const { row } = await pendingTeam();
    const t = now();
    await deliver(subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: t, items: teamItems }));
    const odd = subscriptionEvent("customer.subscription.updated", row, { id: `evt_${crypto.randomUUID()}`, created: t + 1, items: [{ price: { id: "price_x", lookup_key: "someone-else" }, quantity: 1 }] });
    expect((await deliver(odd)).status).toBe(422);
    expect(await eventRecorded(odd.id)).toBe(false);
    await deliver(subscriptionEvent("customer.subscription.deleted", row, { id: `evt_${crypto.randomUUID()}`, created: t + 2, status: "canceled", items: teamItems }));
    expect(await tenantRow(row.slug)).toMatchObject({ status: "active", tier: "free", seats: 0, storage_blocks: 0, interval: null });
    expect((await objectStats(row.slug)).entitlements).toMatchObject({ tier: "free", members_max: 5, storage_gb: 1 });
  });
});
