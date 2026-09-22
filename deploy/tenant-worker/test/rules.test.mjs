/** The pure rules: slugs, lookup keys and entitlements, Turnstile's verdict, Stripe's signature. */
import { describe, expect, it } from "vitest";
import { checkSlug } from "../control/slug.mjs";
import { enforcedEntitlements, entitlements, planOfItems, PRICES, storageKey, tierKey } from "../control/plans.mjs";
import { verdict } from "../control/turnstile.mjs";
import { TOLERANCE_SECONDS, verifyWebhook } from "../control/stripe.mjs";
import { signLikeStripe } from "./stripe-sign.mjs";
import { item } from "./helpers.mjs";

describe("slug", () => {
  it("accepts 3..32 lowercase letters, digits and inner hyphens", () => {
    for (const ok of ["acme", "a1b", "my-org", "x".repeat(32), "0ab"]) expect(checkSlug(ok)).toEqual({ ok: true });
  });
  it("refuses everything else as invalid", () => {
    for (const bad of ["ab", "x".repeat(33), "-acme", "acme-", "Acme", "ac_me", "ac.me", "ac me", "", "é-org", null, 7]) {
      expect(checkSlug(bad)).toEqual({ ok: false, reason: "invalid" });
    }
  });
  it("refuses platform names and every avarok.net record as reserved", () => {
    for (const r of ["www", "api", "admin", "app", "local", "status", "mail", "docs", "blog", "auth", "gitlab", "work",
      "citadel", "ares", "activate", "dev-finco", "netdata", "rcon", "protonmail", "protonmail2", "protonmail-domainkey"]) {
      expect(checkSlug(r)).toEqual({ ok: false, reason: "reserved" });
    }
    // Two letters are invalid before they are reserved.
    expect(checkSlug("mx")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("lookup keys and plans", () => {
  it("derives every key from tiers.json through the catalogue", () => {
    expect([...PRICES.keys()].sort()).toEqual([
      "citadel-business-month", "citadel-business-year", "citadel-relay-overage", "citadel-storage-month", "citadel-storage-year",
      "citadel-team-month", "citadel-team-year",
    ]);
    expect(tierKey("team", "month")).toBe("citadel-team-month");
    expect(storageKey("year")).toBe("citadel-storage-year");
  });
  it("reads tier, seats and the storage add-on from a subscription's items", () => {
    expect(planOfItems([item("citadel-team-month", 3), item("citadel-storage-month", 2)])).toEqual({
      tier: "team", interval: "month", seats: 3, storage_blocks: 2,
    });
    expect(planOfItems([item("citadel-business-year", 10)])).toEqual({ tier: "business", interval: "year", seats: 10, storage_blocks: 0 });
    // The metered relay-overage item carries no quantity and no plan: the plan is the tier's.
    const metered = { price: { id: "price_relay", lookup_key: "citadel-relay-overage" } };
    expect(planOfItems([item("citadel-team-month", 3), metered])).toEqual({ tier: "team", interval: "month", seats: 3, storage_blocks: 0 });
    expect(planOfItems([item("citadel-team-year", 3), item("citadel-storage-year", 1), metered])).toEqual({
      tier: "team", interval: "year", seats: 3, storage_blocks: 1,
    });
  });
  it("refuses items this catalogue did not sell, or that do not make one plan", () => {
    expect(planOfItems([{ price: { id: "price_x", lookup_key: "other-thing" }, quantity: 1 }]).error).toMatch(/not in the catalogue/);
    expect(planOfItems([{ price: { id: "price_x" }, quantity: 1 }]).error).toMatch(/lookup key none/);
    expect(planOfItems([item("citadel-storage-month", 1)]).error).toMatch(/no tier/);
    expect(planOfItems([item("citadel-team-month", 1), item("citadel-business-month", 1)]).error).toMatch(/more than one tier/);
    expect(planOfItems([item("citadel-team-month", 1), item("citadel-storage-year", 1)]).error).toMatch(/different intervals/);
  });
  it("grants storage per seat plus 10 GB per block, and members up to the seats bought", () => {
    const noPeriod = { period_start: null, period_end: null };
    expect(entitlements({ tier: "team", interval: "month", seats: 3, storage_blocks: 2, status: "active", ...noPeriod })).toEqual({
      status: "active", tier: "team", interval: "month", seats: 3, storage_blocks: 2,
      members_max: 3, storage_gb: 50, workspaces_max: 1, priority_support: false,
      connections_max: 9, relay_gb_included: 150, max_frame_bytes: 4194304, ...noPeriod,
    });
    const business = entitlements({ tier: "business", interval: "year", seats: 2000, storage_blocks: 0, status: "active", ...noPeriod });
    expect([business.members_max, business.storage_gb, business.priority_support]).toEqual([1000, 50000, true]);
    expect([business.connections_max, business.relay_gb_included]).toEqual([500, 200000]);
    expect(entitlements({ tier: "free", interval: null, seats: 0, storage_blocks: 0, status: "active", ...noPeriod })).toMatchObject({
      members_max: 5, storage_gb: 1, seats: 0, storage_blocks: 0, connections_max: 15, relay_gb_included: 5,
    });
    const period = { period_start: 1000, period_end: 2000 };
    expect(entitlements({ tier: "team", interval: "month", seats: 1, storage_blocks: 0, status: "active", ...period })).toMatchObject(period);
  });
  it("an object enforces its stored entitlements, deriving from its plan only the limits they lack", () => {
    const old = { status: "active", tier: "business", interval: "year", seats: 4, storage_blocks: 1, members_max: 4 };
    expect(enforcedEntitlements(old)).toMatchObject({ connections_max: 12, relay_gb_included: 400, max_frame_bytes: 4194304, period_start: null, period_end: null, members_max: 4 });
    expect(enforcedEntitlements({ ...old, connections_max: 2, period_start: 10, period_end: 20 })).toMatchObject({ connections_max: 2, period_start: 10, period_end: 20 });
  });
  it("refuses entitlements whose billing period was not stated, even as none", () => {
    expect(() => entitlements({ tier: "team", interval: "month", seats: 1, storage_blocks: 0, status: "active" })).toThrow(/billing period/);
  });
});

describe("Turnstile verdict", () => {
  const ok = { success: true, hostname: "work.avarok.net", action: "create-workspace" };
  it("passes a success for this site and action", () => {
    expect(verdict(ok, "work.avarok.net", "create-workspace")).toBeNull();
    // The testing keys echo no action: bound by secret and hostname alone.
    expect(verdict({ success: true, hostname: "work.avarok.net" }, "work.avarok.net", "create-workspace")).toBeNull();
  });
  it("refuses a failure, another site, another action, or nonsense", () => {
    expect(verdict({ success: false, "error-codes": ["invalid-input-response"] }, "work.avarok.net", "create-workspace")).toMatch(/invalid-input-response/);
    expect(verdict({ ...ok, hostname: "evil.example" }, "work.avarok.net", "create-workspace")).toMatch(/another site/);
    expect(verdict({ ...ok, action: "sign-in" }, "work.avarok.net", "create-workspace")).toMatch(/another action/);
    expect(verdict({ success: true }, "work.avarok.net", "create-workspace")).toMatch(/another site/);
    expect(verdict(null, "work.avarok.net", "create-workspace")).toMatch(/could not be read/);
  });
});

describe("Stripe webhook signature", () => {
  const payload = JSON.stringify({ id: "evt_1", type: "customer.subscription.updated" });
  const secret = "whsec_rules";
  it("verifies Stripe's scheme within tolerance", async () => {
    const header = await signLikeStripe(payload, secret, 1000);
    expect((await verifyWebhook(payload, header, secret, 1000 + TOLERANCE_SECONDS)).event.id).toBe("evt_1");
    // Several v1 signatures (a secret being rolled): any one verifying is enough.
    const rolled = `${header},v1=${"0".repeat(64)}`;
    expect((await verifyWebhook(payload, rolled, secret, 1000)).event.id).toBe("evt_1");
  });
  it("refuses stale, forged, tampered and malformed signatures", async () => {
    const header = await signLikeStripe(payload, secret, 1000);
    expect(await verifyWebhook(payload, header, secret, 1000 + TOLERANCE_SECONDS + 1)).toEqual({ error: "signature-stale" });
    expect(await verifyWebhook(payload, header, secret, 1000 - TOLERANCE_SECONDS - 1)).toEqual({ error: "signature-stale" });
    expect(await verifyWebhook(payload, header, "whsec_other", 1000)).toEqual({ error: "signature-invalid" });
    expect(await verifyWebhook(payload.replace("evt_1", "evt_2"), header, secret, 1000)).toEqual({ error: "signature-invalid" });
    expect(await verifyWebhook(payload, "v1=abc", secret, 1000)).toEqual({ error: "signature-header" });
    expect(await verifyWebhook(payload, "t=1000", secret, 1000)).toEqual({ error: "signature-header" });
    expect(await verifyWebhook(payload, "t=1000,v1=zz", secret, 1000)).toEqual({ error: "signature-invalid" });
    expect(await verifyWebhook(payload, null, secret, 1000)).toEqual({ error: "signature-header" });
  });
});
