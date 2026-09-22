/**
 * A cancelled Checkout's creator retries the same slug with the reservation token its first 201
 * returned; nobody else can release that reservation, and the old session can no longer
 * activate anything.
 */
import { describe, expect, it } from "vitest";
import { createBody, deliver, freshSlug, get, item, outbound, post, subscriptionEvent, tenantRow } from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);
const team = (slug, extra = {}) => createBody(slug, { tier: "team", interval: "month", seats: 3, ...extra });
const sessionOf = (checkoutUrl) => new URL(checkoutUrl).pathname.split("/").pop();

/** A pending Team tenant: its first 201 body and row. */
async function pending() {
  const slug = freshSlug("rt");
  outbound();
  const r = await post("/api/tenants", team(slug));
  expect(r.status).toBe(201);
  const body = await r.json();
  expect(body.reservation_token).toMatch(/^[0-9a-f]{64}$/);
  return { slug, body, row: await tenantRow(slug) };
}

const completedFor = (row, sessionId) => ({
  id: `evt_${crypto.randomUUID()}`,
  type: "checkout.session.completed",
  created: now(),
  data: { object: { id: sessionId, object: "checkout.session", customer: "cus_old", subscription: "sub_old", payment_status: "paid", metadata: { tenant: row.slug, tenant_id: row.tenant_id } } },
});

describe("retrying a cancelled Checkout", () => {
  it("the right token replaces the reservation with a new Checkout and expires the old one", async () => {
    const { slug, body, row } = await pending();
    expect(row.reservation_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.reservation_hash).not.toBe(body.reservation_token);
    const { calls } = outbound();
    const r = await post("/api/tenants", team(slug, { seats: 5, reservation_token: body.reservation_token }));
    expect(r.status).toBe(201);
    const retried = await r.json();
    expect(retried).toMatchObject({ slug, status: "pending" });
    expect(retried.checkout_url).not.toBe(body.checkout_url);
    expect(retried.reservation_token).toMatch(/^[0-9a-f]{64}$/);
    expect(retried.reservation_token).not.toBe(body.reservation_token);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toContain(
      `POST https://api.stripe.com/v1/checkout/sessions/${sessionOf(body.checkout_url)}/expire`,
    );
    const after = await tenantRow(slug);
    expect(after).toMatchObject({ status: "pending", seats: 5 });
    expect(after.tenant_id).not.toBe(row.tenant_id);
    // The spent token is spent: it no longer matches the new reservation.
    outbound();
    expect((await post("/api/tenants", team(slug, { reservation_token: body.reservation_token }))).status).toBe(409);
  });

  it("a wrong token or none is 409 slug-taken and changes nothing", async () => {
    const { slug, row } = await pending();
    for (const extra of [{}, { reservation_token: "0".repeat(64) }]) {
      const { calls } = outbound();
      const r = await post("/api/tenants", team(slug, extra));
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "slug-taken", detail: "that address is taken" });
      expect(calls.some((c) => c.url.includes("/expire"))).toBe(false);
    }
    expect(await tenantRow(slug)).toEqual(row);
    outbound();
    expect((await post("/api/tenants", team(slug, { reservation_token: "not-hex" }))).status).toBe(400);
  });

  it("the old session's webhooks after a retry activate nothing", async () => {
    const { slug, body, row: old } = await pending();
    outbound();
    const retried = await (await post("/api/tenants", team(slug, { reservation_token: body.reservation_token }))).json();
    const late = await deliver(completedFor(old, sessionOf(body.checkout_url)));
    expect(late.status).toBe(200);
    expect(await late.json()).toMatchObject({ applied: false, note: "no tenant for this session" });
    const lateSub = subscriptionEvent("customer.subscription.created", old, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 3)] });
    expect(await (await deliver(lateSub)).json()).toMatchObject({ applied: false });
    const row = await tenantRow(slug);
    expect(row).toMatchObject({ status: "pending", stripe_customer: null, stripe_subscription: null });
    expect((await get(`/api/tenants/${slug}/status?session_id=${sessionOf(body.checkout_url)}`)).status).toBe(200);
    expect((await (await get(`/api/tenants/${slug}/status?session_id=${sessionOf(body.checkout_url)}`)).json()).claim_code).toBeUndefined();
    // The new session still activates its own tenant.
    const current = await deliver(completedFor(row, sessionOf(retried.checkout_url)));
    expect(await current.json()).toMatchObject({ applied: true, tenant: slug });
    expect((await tenantRow(slug)).status).toBe("active");
  });

  it("an old session that was already paid is not superseded", async () => {
    const { slug, body, row } = await pending();
    outbound({ expire: { refuse: "complete" } });
    const r = await post("/api/tenants", team(slug, { reservation_token: body.reservation_token }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toBe("checkout-completed");
    expect(await tenantRow(slug)).toEqual(row);
  });

  it("an old session Stripe already expired is superseded", async () => {
    const { slug, body, row } = await pending();
    outbound({ expire: { refuse: "expired" } });
    const r = await post("/api/tenants", team(slug, { reservation_token: body.reservation_token }));
    expect(r.status).toBe(201);
    expect((await tenantRow(slug)).tenant_id).not.toBe(row.tenant_id);
  });

  it("a token cannot take over an active tenant", async () => {
    const { slug, body, row } = await pending();
    await deliver(completedFor(row, sessionOf(body.checkout_url)));
    expect((await tenantRow(slug)).status).toBe("active");
    const { calls } = outbound();
    expect((await post("/api/tenants", team(slug, { reservation_token: body.reservation_token }))).status).toBe(409);
    expect(calls.some((c) => c.url.includes("/expire"))).toBe(false);
  });

  it("a free creation has no reservation to retry", async () => {
    const slug = freshSlug("rf");
    outbound();
    const body = await (await post("/api/tenants", createBody(slug))).json();
    expect(body.reservation_token).toBeUndefined();
    expect((await tenantRow(slug)).reservation_hash).toBeNull();
  });
});
