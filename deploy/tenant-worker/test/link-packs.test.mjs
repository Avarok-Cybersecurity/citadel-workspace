/**
 * Secure-link packs, and the add-on loop they go through with storage: the rules, then the real
 * Worker's Checkout and webhook. The only mock is helpers.mjs `outbound` at the fetch boundary.
 */
import { describe, expect, it } from "vitest";
import { enforcedEntitlements, entitlements, MAX_LINK_PACKS, planOfItems } from "../control/plans.mjs";
import { createBody, deliver, freshSlug, item, objectStats, outbound, post, subscriptionEvent, tenantRow } from "./helpers.mjs";

const noPeriod = { period_start: null, period_end: null };
const plan = (extra) => ({ status: "active", storage_blocks: 0, link_packs: 0, overage_billing: false, ...noPeriod, ...extra });

describe("link-pack entitlements", () => {
  it("give each member the tier's own allowance and the workspace 50 shared links per pack", () => {
    expect(entitlements(plan({ tier: "team", interval: "month", seats: 3, link_packs: 2 }))).toMatchObject({
      link_packs: 2, secure_links_per_member: 50, secure_links_pool: 100, storage_gb: 6, storage_blocks: 0,
    });
    expect(entitlements(plan({ tier: "business", interval: "year", seats: 1, storage_blocks: 1, link_packs: 3 }))).toMatchObject({
      link_packs: 3, secure_links_pool: 150, storage_gb: 15, storage_blocks: 1,
    });
  });
  it("count no packs on Free, whose members hold 5 links each and share no pool", () => {
    expect(entitlements(plan({ tier: "free", interval: null, seats: 0, link_packs: 4 }))).toMatchObject({
      link_packs: 0, secure_links_per_member: 5, secure_links_pool: 0,
    });
  });
  it("are refused without a pack count, which is stated even as none", () => {
    const { link_packs: _none, ...unstated } = plan({ tier: "team", interval: "month", seats: 1 });
    expect(() => entitlements(unstated)).toThrow(/link_packs/);
    expect(() => entitlements(plan({ tier: "team", interval: "month", seats: 1, link_packs: -1 }))).toThrow(/link_packs/);
  });
  it("are filled in for a record stored before links existed, never overriding what it holds", () => {
    const old = { status: "active", tier: "team", interval: "month", seats: 2, storage_blocks: 1, members_max: 2 };
    expect(enforcedEntitlements(old)).toMatchObject({ secure_links_per_member: 50, secure_links_pool: 0, link_packs: 0, storage_gb: 14 });
    const oldFree = { status: "active", tier: "free", interval: null, seats: 0, storage_blocks: 0 };
    expect(enforcedEntitlements(oldFree)).toMatchObject({ secure_links_per_member: 5, secure_links_pool: 0 });
    expect(enforcedEntitlements({ ...old, link_packs: 2 })).toMatchObject({ secure_links_pool: 100 });
    expect(enforcedEntitlements({ ...old, secure_links_per_member: 7 })).toMatchObject({ secure_links_per_member: 7 });
  });
});

describe("a subscription's pack items", () => {
  it("are read as the pack count, beside storage", () => {
    expect(planOfItems([item("citadel-team-month", 3), item("citadel-secure-links-month", 4)])).toEqual({
      tier: "team", interval: "month", seats: 3, storage_blocks: 0, link_packs: 4,
    });
    expect(planOfItems([item("citadel-business-year", 2), item("citadel-storage-year", 1), item("citadel-secure-links-year", 2)])).toEqual({
      tier: "business", interval: "year", seats: 2, storage_blocks: 1, link_packs: 2,
    });
  });
  it("on another interval than the tier are refused", () => {
    expect(planOfItems([item("citadel-team-month", 1), item("citadel-secure-links-year", 1)]).error).toMatch(/secure-links and tier bill on different intervals/);
  });
});

const lineItems = (form) => Object.fromEntries([...form].filter(([k]) => k.startsWith("line_items")));

describe("Checkout with packs", () => {
  it("sells the packs as their own line, after storage, quantity = packs", async () => {
    const slug = freshSlug("lp");
    const { calls } = outbound();
    const r = await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 2, storage_blocks: 1, link_packs: 3 }));
    expect(r.status).toBe(201);
    const keys = calls.find((c) => c.url.endsWith("/v1/prices")).form.getAll("lookup_keys[]");
    expect(keys).toEqual(["citadel-team-month", "citadel-storage-month", "citadel-secure-links-month"]);
    expect(lineItems(calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form)).toEqual({
      "line_items[0][price]": "price_team_m",
      "line_items[0][quantity]": "2",
      "line_items[1][price]": "price_storage_m",
      "line_items[1][quantity]": "1",
      "line_items[2][price]": "price_links_m",
      "line_items[2][quantity]": "3",
    });
    expect(await tenantRow(slug)).toMatchObject({ tier: "team", seats: 2, storage_blocks: 1, link_packs: 3 });
  });
  it("carries no pack line when no packs are bought", async () => {
    for (const packs of [0, undefined]) {
      const slug = freshSlug("lp0");
      const { calls } = outbound();
      const r = await post("/api/tenants", createBody(slug, { tier: "business", interval: "year", seats: 1, link_packs: packs }));
      expect(r.status).toBe(201);
      expect(calls.find((c) => c.url.endsWith("/v1/prices")).form.getAll("lookup_keys[]")).toEqual(["citadel-business-year"]);
      expect(lineItems(calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form)).toEqual({
        "line_items[0][price]": "price_business_y",
        "line_items[0][quantity]": "1",
      });
      expect((await tenantRow(slug)).link_packs).toBe(0);
    }
  });
  it("refuses packs on Free, and a pack count that is not a count", async () => {
    for (const extra of [{ link_packs: 1 }, { link_packs: 0 }]) {
      const { calls } = outbound();
      const r = await post("/api/tenants", createBody(freshSlug("lpf"), extra));
      expect(r.status).toBe(400);
      expect((await r.json()).detail).toMatch(/free tier takes no .*link_packs/);
      expect(calls.some((c) => c.url.includes("api.stripe.com"))).toBe(false);
    }
    for (const link_packs of [-1, 1.5, "2", MAX_LINK_PACKS + 1]) {
      outbound();
      const r = await post("/api/tenants", createBody(freshSlug("lpb"), { tier: "team", interval: "month", seats: 1, link_packs }));
      expect(r.status).toBe(400);
      expect((await r.json()).detail).toMatch(/link_packs is an integer from 0 to/);
    }
  });
});

describe("the webhook with packs", () => {
  it("applies the pack count a subscription holds, and a later change to it", async () => {
    const slug = freshSlug("lpw");
    outbound();
    expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3, storage_blocks: 2 }))).status).toBe(201);
    const row = await tenantRow(slug);
    const at = Math.floor(Date.now() / 1000);
    const items = (packs) => [item("citadel-team-month", 3), item("citadel-storage-month", 2), item("citadel-secure-links-month", packs)];
    const send = (packs, created) => deliver(subscriptionEvent("customer.subscription.updated", row, { id: `evt_${crypto.randomUUID()}`, created, items: items(packs) }));
    expect((await send(2, at)).status).toBe(200);
    expect(await tenantRow(slug)).toMatchObject({ status: "active", storage_blocks: 2, link_packs: 2 });
    expect((await objectStats(slug)).entitlements).toMatchObject({ storage_gb: 26, link_packs: 2, secure_links_pool: 100 });
    // Packs bought later in the portal reach the object through the same parse.
    expect((await send(5, at + 1)).status).toBe(200);
    expect((await objectStats(slug)).entitlements).toMatchObject({ storage_gb: 26, secure_links_pool: 250 });
  });
});
