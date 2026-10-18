/**
 * Opening the billing portal re-asks for the Customer Terms when the workspace accepted an older
 * version: the real Worker and its D1. The tenant is created through the control plane; only its
 * history is rewritten in D1 (an earlier acceptance, a Stripe customer, a known claim code), since
 * no request can make a workspace that accepted terms which are no longer current.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CUSTOMER_TERMS_VERSION } from "../control/customer-terms.mjs";
import { freeTenant, outbound, post, sha256Hex, tenantRow } from "./helpers.mjs";

const CLAIM = "c".repeat(64);

const acceptances = (tenantId) =>
  env.CONTROL_DB.prepare("SELECT version FROM customer_terms_acceptances WHERE tenant_id = ? ORDER BY version").bind(tenantId).all()
    .then((r) => r.results.map((a) => a.version));

/** A workspace with a subscription to manage whose latest accepted Customer Terms are `version`. */
async function workspaceThatAccepted(version) {
  const { slug } = await freeTenant("ptm");
  const row = await tenantRow(slug);
  await env.CONTROL_DB.batch([
    env.CONTROL_DB.prepare("UPDATE tenants SET stripe_customer = 'cus_test_1', claim_hash = ? WHERE slug = ?").bind(await sha256Hex(CLAIM), slug),
    env.CONTROL_DB.prepare("UPDATE customer_terms_acceptances SET version = ? WHERE tenant_id = ?").bind(version, row.tenant_id),
  ]);
  expect(await acceptances(row.tenant_id)).toEqual([version]);
  return { slug, tenantId: row.tenant_id };
}

const portal = (slug, extra = {}) => post(`/api/tenants/${slug}/portal`, { claim_code: CLAIM, ...extra });
const portalCalls = (calls) => calls.filter((c) => c.url.endsWith("/v1/billing_portal/sessions"));

describe("the billing portal and the Customer Terms", () => {
  it("refuses, naming the current version, while the workspace's accepted terms are stale", async () => {
    const { slug, tenantId } = await workspaceThatAccepted(CUSTOMER_TERMS_VERSION - 1);
    const { calls } = outbound();
    for (const extra of [{}, { accepted_customer_terms_version: CUSTOMER_TERMS_VERSION - 1 }]) {
      const r = await portal(slug, extra);
      expect(r.status).toBe(409);
      expect(await r.json()).toEqual({ error: "customer-terms-stale", current: CUSTOMER_TERMS_VERSION, document: "customer-terms" });
    }
    expect((await portal(slug, { accepted_customer_terms_version: "2" })).status).toBe(400);
    expect(portalCalls(calls)).toHaveLength(0);
    expect(await acceptances(tenantId)).toEqual([CUSTOMER_TERMS_VERSION - 1]);
  });

  it("asks nothing of a wrong claim code, which learns only that it is wrong", async () => {
    const { slug, tenantId } = await workspaceThatAccepted(CUSTOMER_TERMS_VERSION - 1);
    outbound();
    const r = await post(`/api/tenants/${slug}/portal`, { claim_code: "0".repeat(64), accepted_customer_terms_version: CUSTOMER_TERMS_VERSION });
    expect(r.status).toBe(403);
    expect(await acceptances(tenantId)).toEqual([CUSTOMER_TERMS_VERSION - 1]);
  });

  it("records the acceptance of the current version and opens the portal", async () => {
    const { slug, tenantId } = await workspaceThatAccepted(CUSTOMER_TERMS_VERSION - 1);
    const { calls } = outbound();
    const r = await portal(slug, { accepted_customer_terms_version: CUSTOMER_TERMS_VERSION });
    expect(r.status).toBe(200);
    expect(new URL((await r.json()).portal_url).host).toBe("billing.stripe.com");
    expect(portalCalls(calls)).toHaveLength(1);
    expect(await acceptances(tenantId)).toEqual([CUSTOMER_TERMS_VERSION - 1, CUSTOMER_TERMS_VERSION]);
    // Accepted once, asked no more.
    expect((await portal(slug)).status).toBe(200);
    expect(await acceptances(tenantId)).toEqual([CUSTOMER_TERMS_VERSION - 1, CUSTOMER_TERMS_VERSION]);
  });

  it("opens at once for a workspace already on the current terms, recording nothing", async () => {
    const { slug, tenantId } = await workspaceThatAccepted(CUSTOMER_TERMS_VERSION);
    const { calls } = outbound();
    expect((await portal(slug)).status).toBe(200);
    expect((await portal(slug, { accepted_customer_terms_version: CUSTOMER_TERMS_VERSION })).status).toBe(200);
    expect(portalCalls(calls)).toHaveLength(2);
    expect(await acceptances(tenantId)).toEqual([CUSTOMER_TERMS_VERSION]);
  });
});
