/**
 * The chat-document limit (owner, 2026-10-24): documents shared in chats, counted workspace-wide,
 * 50 on Free, 1000 on Team, 10000 on Business, plus Business-only packs of 5000. The packs go
 * through the same add-on loop as storage and secure-link packs: the rules, then the real
 * Worker's Checkout and webhook. The only mock is helpers.mjs `outbound` at the fetch boundary.
 */
import { describe, expect, it } from "vitest";
import { enforcedEntitlements, entitlements, planOfItems } from "../control/plans.mjs";
import { MAX_CHAT_DOCUMENT_PACKS } from "../control/addons.mjs";
import { chatDocumentLimit, linkQuotaHost } from "../control/tenant-links.mjs";
import { createBody, deliver, freshSlug, item, objectStats, outbound, post, subscriptionEvent, tenantRow } from "./helpers.mjs";

const noPeriod = { period_start: null, period_end: null };
const plan = (extra) => ({
  status: "active", storage_blocks: 0, link_packs: 0, chat_document_packs: 0, ...noPeriod,
  grant_id: null, grant_unlimited: 0, trial_end: null, stripe_status: null, ...extra,
});

describe("chat-document entitlements", () => {
  it("are the tier's own count, plus 5000 per pack on Business", () => {
    expect(entitlements(plan({ tier: "free", interval: null, seats: 0 }))).toMatchObject({ chat_documents: 50, chat_document_packs: 0 });
    expect(entitlements(plan({ tier: "team", interval: "month", seats: 2 }))).toMatchObject({ chat_documents: 1000 });
    expect(entitlements(plan({ tier: "business", interval: "year", seats: 1 }))).toMatchObject({ chat_documents: 10000 });
    expect(entitlements(plan({ tier: "business", interval: "month", seats: 1, chat_document_packs: 3 }))).toMatchObject({
      chat_documents: 25000, chat_document_packs: 3,
    });
  });
  it("are refused without a pack count, which is stated even as none", () => {
    const { chat_document_packs: _none, ...unstated } = plan({ tier: "business", interval: "month", seats: 1 });
    expect(() => entitlements(unstated)).toThrow(/chat_document_packs/);
  });
  it("lift to no limit on an unlimited grant, and clamp to the trial cap on a trial", () => {
    expect(entitlements(plan({ tier: "free", interval: null, seats: 0, grant_id: "design-partner", grant_unlimited: 1 })).chat_documents).toBeNull();
    expect(entitlements(plan({ tier: "business", interval: "month", seats: 1, trial_end: 1, stripe_status: "trialing" })).chat_documents).toBe(50);
  });
  it("are filled in for a record stored before the limit existed, never overriding what it holds", () => {
    const old = { status: "active", tier: "team", interval: "month", seats: 2, storage_blocks: 0, link_packs: 0 };
    expect(enforcedEntitlements(old)).toMatchObject({ chat_documents: 1000, chat_document_packs: 0 });
    expect(enforcedEntitlements({ ...old, chat_documents: 7 })).toMatchObject({ chat_documents: 7 });
  });
});

describe("the limit the kernel is told", () => {
  it("is the stored entitlement, null only for an unlimited grant, and refused when it is not there", () => {
    const business = enforcedEntitlements({ status: "active", tier: "business", interval: "month", seats: 1, storage_blocks: 0, link_packs: 0, chat_document_packs: 2 });
    expect(linkQuotaHost(() => business).chatDocuments()).toEqual({ limit: 20000 });
    expect(chatDocumentLimit({ chat_documents: null, unlimited: true })).toEqual({ limit: null });
    expect(() => chatDocumentLimit({ unlimited: false })).toThrow(/chat_documents/);
    expect(() => chatDocumentLimit({ chat_documents: null, unlimited: false })).toThrow(/without being unlimited/);
  });
});

describe("a subscription's chat-document pack items", () => {
  it("are read as the pack count on Business", () => {
    expect(planOfItems([item("citadel-business-month", 2), item("citadel-chat-documents-month", 4)])).toEqual({
      tier: "business", interval: "month", seats: 2, storage_blocks: 0, link_packs: 0, chat_document_packs: 4,
    });
  });
  it("are refused on Team, where they are not sold", () => {
    expect(planOfItems([item("citadel-team-month", 1), item("citadel-chat-documents-month", 1)]).error).toMatch(/chat-documents is not sold on team/);
  });
});

const lineItems = (form) => Object.fromEntries([...form].filter(([k]) => k.startsWith("line_items")));

describe("Checkout with chat-document packs", () => {
  it("sells the packs as their own line on Business, quantity = packs", async () => {
    const slug = freshSlug("cd");
    const { calls } = outbound();
    const r = await post("/api/tenants", createBody(slug, { tier: "business", interval: "year", seats: 1, chat_document_packs: 2 }));
    expect(r.status).toBe(201);
    expect(calls.find((c) => c.url.endsWith("/v1/prices")).form.getAll("lookup_keys[]")).toEqual(["citadel-business-year", "citadel-chat-documents-year"]);
    expect(lineItems(calls.find((c) => c.url.endsWith("/v1/checkout/sessions")).form)).toEqual({
      "line_items[0][price]": "price_business_y",
      "line_items[0][quantity]": "1",
      "line_items[1][price]": "price_chat_docs_y",
      "line_items[1][quantity]": "2",
    });
    expect(await tenantRow(slug)).toMatchObject({ tier: "business", chat_document_packs: 2 });
  });
  it("carries no pack line when none are bought", async () => {
    const slug = freshSlug("cd0");
    const { calls } = outbound();
    expect((await post("/api/tenants", createBody(slug, { tier: "business", interval: "year", seats: 1, chat_document_packs: 0 }))).status).toBe(201);
    expect(calls.find((c) => c.url.endsWith("/v1/prices")).form.getAll("lookup_keys[]")).toEqual(["citadel-business-year"]);
    expect((await tenantRow(slug)).chat_document_packs).toBe(0);
  });
  it("refuses packs on Free and on Team, and a pack count that is not a count", async () => {
    const refusals = [
      [{ chat_document_packs: 1 }, /free tier takes no .*chat_document_packs/],
      [{ tier: "team", interval: "month", seats: 1, chat_document_packs: 1 }, /chat-documents is not sold on team/],
    ];
    for (const [body, why] of refusals) {
      const { calls } = outbound();
      const r = await post("/api/tenants", createBody(freshSlug("cdf"), body));
      expect(r.status).toBe(400);
      expect((await r.json()).detail).toMatch(why);
      expect(calls.some((c) => c.url.includes("api.stripe.com"))).toBe(false);
    }
    for (const chat_document_packs of [-1, 1.5, MAX_CHAT_DOCUMENT_PACKS + 1]) {
      outbound();
      const r = await post("/api/tenants", createBody(freshSlug("cdb"), { tier: "business", interval: "month", seats: 1, chat_document_packs }));
      expect(r.status).toBe(400);
      expect((await r.json()).detail).toMatch(/chat_document_packs is an integer from 0 to/);
    }
  });
});

describe("the webhook with chat-document packs", () => {
  it("applies the pack count a subscription holds to the object's limit", async () => {
    const slug = freshSlug("cdw");
    outbound();
    expect((await post("/api/tenants", createBody(slug, { tier: "business", interval: "month", seats: 1 }))).status).toBe(201);
    const row = await tenantRow(slug);
    const items = [item("citadel-business-month", 1), item("citadel-chat-documents-month", 2)];
    const at = Math.floor(Date.now() / 1000);
    expect((await deliver(subscriptionEvent("customer.subscription.updated", row, { id: `evt_${crypto.randomUUID()}`, created: at, items }))).status).toBe(200);
    expect(await tenantRow(slug)).toMatchObject({ chat_document_packs: 2 });
    expect((await objectStats(slug)).entitlements).toMatchObject({ chat_document_packs: 2, chat_documents: 20000 });
  });
});
