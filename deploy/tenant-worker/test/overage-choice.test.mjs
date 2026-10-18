/**
 * The overage-billing choice at creation (billing/policy.json overage_billing, G1) and the Stripe
 * Tax switch on Checkout, through the real Worker. Stripe and Turnstile are the one mock.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatch } from "../control/dispatch.mjs";
import { createBody, freshSlug, ORIGIN, outbound, post, tenantRow } from "./helpers.mjs";

const team = { tier: "team", interval: "month", seats: 2 };
const sessionForm = (calls) => calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form;

describe("a paid creation names overage_billing", () => {
  it("refuses it absent or not a boolean, naming it, and asks no one", async () => {
    const { calls } = outbound();
    for (const overage_billing of [undefined, "true", 1, null]) {
      const r = await post("/api/tenants", createBody(freshSlug("ob"), { ...team, overage_billing }));
      expect(r.status).toBe(400);
      expect(await r.json()).toMatchObject({ error: "malformed-request", detail: expect.stringContaining("overage_billing") });
    }
    expect(calls).toHaveLength(0);
  });
  it("refuses it on the free tier, like every other paid-only field", async () => {
    const { calls } = outbound();
    const r = await post("/api/tenants", createBody(freshSlug("obf"), { overage_billing: false }));
    expect(r.status).toBe(400);
    expect((await r.json()).detail).toMatch(/free tier takes no .*overage_billing/);
    expect(calls).toHaveLength(0);
  });
  it("stores the choice either way, and the free tier's as off", async () => {
    for (const overage_billing of [true, false]) {
      const slug = freshSlug("obs");
      outbound();
      expect((await post("/api/tenants", createBody(slug, { ...team, overage_billing }))).status).toBe(201);
      expect((await tenantRow(slug)).overage_billing).toBe(overage_billing ? 1 : 0);
    }
    const free = freshSlug("obz");
    outbound();
    expect((await post("/api/tenants", createBody(free))).status).toBe(201);
    expect((await tenantRow(free)).overage_billing).toBe(0);
  });
});

describe("STRIPE_TAX", () => {
  const create = (slug, vars) =>
    dispatch(new Request(`${ORIGIN}/api/tenants`, {
      method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(createBody(slug, team)),
    }), { ...env, ...vars });

  it("off: the Checkout carries no tax parameter", async () => {
    const { calls } = outbound();
    expect((await create(freshSlug("tx0"), { STRIPE_TAX: "off" })).status).toBe(201);
    const keys = [...sessionForm(calls).keys()];
    expect(keys.filter((k) => k.startsWith("automatic_tax") || k.startsWith("billing_address") || k.startsWith("customer_update"))).toEqual([]);
  });
  it("on: automatic tax, from an address always collected", async () => {
    const { calls } = outbound();
    expect((await create(freshSlug("tx1"), { STRIPE_TAX: "on" })).status).toBe(201);
    expect(Object.fromEntries(sessionForm(calls))).toMatchObject({ "automatic_tax[enabled]": "true", billing_address_collection: "required" });
  });
});
