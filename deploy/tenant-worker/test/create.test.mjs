/** Creating tenants through the real Worker: Turnstile first, then free provisioning or Checkout. */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { createBody, freshSlug, get, objectStats, ORIGIN, outbound, post, sha256Hex, tenantRow } from "./helpers.mjs";

describe("POST /api/tenants, Turnstile", () => {
  it("a failed siteverify is 403 and writes no tenant row", async () => {
    const slug = freshSlug("tf");
    const { calls } = outbound({ turnstile: { success: false, "error-codes": ["invalid-input-response"] } });
    const r = await post("/api/tenants", createBody(slug));
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("turnstile");
    expect(await tenantRow(slug)).toBeNull();
    // Turnstile was asked, with the configured secret and the widget's token.
    expect(calls.map((c) => c.url)).toEqual(["https://challenges.cloudflare.com/turnstile/v0/siteverify"]);
    expect(calls[0].form.get("secret")).toBe(env.TURNSTILE_SECRET);
    expect(calls[0].form.get("response")).toBe("tok");
  });
  it("a pass for another hostname or another action is refused too", async () => {
    const slug = freshSlug("th");
    outbound({ turnstile: { success: true, hostname: "evil.example" } });
    expect((await post("/api/tenants", createBody(slug))).status).toBe(403);
    outbound({ turnstile: { success: true, hostname: "example.com", action: "sign-in" } });
    expect((await post("/api/tenants", createBody(slug))).status).toBe(403);
    expect(await tenantRow(slug)).toBeNull();
  });
  it("refuses a cross-origin post before asking Turnstile", async () => {
    const { calls } = outbound();
    const r = await post("/api/tenants", createBody(freshSlug("co")), { origin: "https://evil.example" });
    expect(r.status).toBe(403);
    expect(calls).toHaveLength(0);
  });
  it("refuses malformed bodies with 400 and asks no one", async () => {
    const { calls } = outbound();
    for (const body of [
      createBody("ab"),
      createBody("admin"),
      createBody(freshSlug("mb"), { tier: "gold" }),
      createBody(freshSlug("mb"), { seats: 3 }),
      createBody(freshSlug("mb"), { tier: "team", interval: "week", seats: 3 }),
      createBody(freshSlug("mb"), { tier: "team", interval: "month", seats: 101 }),
      createBody(freshSlug("mb"), { tier: "team", interval: "month", seats: 1.5 }),
      createBody(freshSlug("mb"), { display_name: "" }),
      createBody(freshSlug("mb"), { owner: "me" }),
      { ...createBody(freshSlug("mb")), turnstile_token: undefined },
    ]) {
      expect((await post("/api/tenants", body)).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    const big = await SELF.fetch(`${ORIGIN}/api/tenants`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify({ pad: "x".repeat(5000) }),
    });
    expect(big.status).toBe(413);
  });
});

describe("free tier, end to end in Miniflare", () => {
  it("creates an active tenant whose object holds the claim code as its master password", async () => {
    const slug = freshSlug("free");
    expect(await (await get(`/api/slug/${slug}`)).json()).toEqual({ slug, available: true });
    outbound();
    const r = await post("/api/tenants", createBody(slug));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(body).toMatchObject({ slug, status: "active", workspace_host: `${slug}.work.avarok.net` });
    expect(body.claim_code).toMatch(/^[0-9a-f]{64}$/);

    const row = await tenantRow(slug);
    expect(row).toMatchObject({ status: "active", tier: "free", seats: 0, storage_blocks: 0, claim_sealed: null, expires_at: null });
    expect(row.claim_hash).toBe(await sha256Hex(body.claim_code));

    const stats = await objectStats(slug);
    expect(stats.provisioned).toBe(true);
    expect(stats.master_password_sha256_prefix).toBe((await sha256Hex(body.claim_code)).slice(0, 8));
    expect(stats.entitlements).toMatchObject({ status: "active", tier: "free", members_max: 5, storage_gb: 1 });

    expect(await (await get(`/api/slug/${slug}`)).json()).toEqual({ slug, available: false, reason: "taken" });
    // The same slug twice: the second is refused and the first tenant's object is untouched.
    outbound();
    expect((await post("/api/tenants", createBody(slug))).status).toBe(409);
    expect((await objectStats(slug)).master_password_sha256_prefix).toBe(stats.master_password_sha256_prefix);
  });
  it("the tenant's host reaches its object; unknown or pending tenants reach nothing", async () => {
    const slug = freshSlug("host");
    outbound();
    await post("/api/tenants", createBody(slug));
    const viaHost = await SELF.fetch(`https://${slug}.work.avarok.net/`);
    expect((await viaHost.json()).provisioned).toBe(true);
    expect((await SELF.fetch(`https://nobody-here.work.avarok.net/`)).status).toBe(404);
    expect((await SELF.fetch(`https://a.b.work.avarok.net/`)).status).toBe(404);
  });
});

describe("paid tier: Checkout", () => {
  it("reserves a pending tenant and opens a subscription Checkout by lookup key", async () => {
    const slug = freshSlug("paid");
    const { calls } = outbound();
    const r = await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3, storage_blocks: 2 }));
    expect(r.status).toBe(201);
    const body = await r.json();
    expect(new URL(body.checkout_url).host).toBe("checkout.stripe.com");
    expect(body).toMatchObject({ slug, status: "pending" });
    expect(body.claim_code).toBeUndefined();

    const prices = calls.find((c) => c.url.endsWith("/v1/prices"));
    expect(prices.form.getAll("lookup_keys[]")).toEqual(["citadel-team-month", "citadel-storage-month", "citadel-relay-overage"]);
    const session = calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form;
    const row = await tenantRow(slug);
    expect(Object.fromEntries(session)).toMatchObject({
      mode: "subscription",
      "line_items[0][price]": "price_team_m",
      "line_items[0][quantity]": "3",
      "line_items[1][price]": "price_storage_m",
      "line_items[1][quantity]": "2",
      "line_items[2][price]": "price_relay_overage",
      "subscription_data[metadata][tenant]": slug,
      "subscription_data[metadata][tenant_id]": row.tenant_id,
      client_reference_id: row.tenant_id,
    });
    // The metered overage price bills by usage: no quantity, and no line item beyond it.
    expect([...session.keys()].filter((k) => k.startsWith("line_items[2]") || k.startsWith("line_items[3]"))).toEqual(["line_items[2][price]"]);
    expect(session.get("success_url")).toBe(`${ORIGIN}/create/done?tenant=${slug}&session_id={CHECKOUT_SESSION_ID}`);
    expect(row).toMatchObject({ status: "pending", tier: "team", interval: "month", seats: 3, storage_blocks: 2 });
    expect(row.claim_sealed).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);

    // Pending: the tenant's host is not served yet.
    expect((await SELF.fetch(`https://${slug}.work.avarok.net/`)).status).toBe(404);
    expect(await (await get(`/api/tenants/${slug}/status`)).json()).toMatchObject({ status: "pending" });
  });
  it("monthly without storage: the overage price is the second item; yearly carries none", async () => {
    const lineItems = (form) => Object.fromEntries([...form].filter(([k]) => k.startsWith("line_items")));
    const monthly = outbound();
    expect((await post("/api/tenants", createBody(freshSlug("om"), { tier: "business", interval: "month", seats: 2 }))).status).toBe(201);
    expect(lineItems(monthly.calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form)).toEqual({
      "line_items[0][price]": "price_business_m",
      "line_items[0][quantity]": "2",
      "line_items[1][price]": "price_relay_overage",
    });
    const yearly = outbound();
    expect((await post("/api/tenants", createBody(freshSlug("oy"), { tier: "team", interval: "year", seats: 2, storage_blocks: 1 }))).status).toBe(201);
    expect(yearly.calls.find((c) => c.url.endsWith("/v1/prices")).form.getAll("lookup_keys[]")).toEqual(["citadel-team-year", "citadel-storage-year"]);
    expect(lineItems(yearly.calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form)).toEqual({
      "line_items[0][price]": "price_team_y",
      "line_items[0][quantity]": "2",
      "line_items[1][price]": "price_storage_y",
      "line_items[1][quantity]": "1",
    });
  });
  it("a Stripe failure releases the slug and reports nothing charged", async () => {
    const slug = freshSlug("sf");
    outbound();
    // No such price: the lookup finds nothing for the business keys.
    const { PRICES } = await import("./helpers.mjs");
    const saved = PRICES["citadel-business-month"];
    delete PRICES["citadel-business-month"];
    try {
      const r = await post("/api/tenants", createBody(slug, { tier: "business", interval: "month", seats: 2 }));
      expect(r.status).toBe(502);
    } finally {
      PRICES["citadel-business-month"] = saved;
    }
    expect(await tenantRow(slug)).toBeNull();
  });
});
