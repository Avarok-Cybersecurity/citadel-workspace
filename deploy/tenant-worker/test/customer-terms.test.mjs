/** Creating a workspace requires accepting the current Customer Terms, and records that it did. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { CUSTOMER_TERMS_VERSION } from "../control/customer-terms.mjs";
import { createBody, freshSlug, outbound, post, tenantRow } from "./helpers.mjs";

const acceptances = (tenantId) =>
  env.CONTROL_DB.prepare("SELECT * FROM customer_terms_acceptances WHERE tenant_id = ?").bind(tenantId).all().then((r) => r.results);
const withoutTerms = (slug) => {
  const { accepted_customer_terms_version: _dropped, ...rest } = createBody(slug);
  return rest;
};

describe("customer terms on creation", () => {
  it("refuses a creation that does not say it accepted them, and creates nothing", async () => {
    const slug = freshSlug("ctm");
    const { calls } = outbound();
    const r = await post("/api/tenants", withoutTerms(slug));
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("customer-terms-required");
    expect(await tenantRow(slug)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("refuses a stale or non-integer version", async () => {
    const slug = freshSlug("cts");
    const { calls } = outbound();
    for (const version of [CUSTOMER_TERMS_VERSION - 1, CUSTOMER_TERMS_VERSION + 1]) {
      const r = await post("/api/tenants", createBody(slug, { accepted_customer_terms_version: version }));
      expect(r.status).toBe(409);
      expect(await r.json()).toMatchObject({ error: "customer-terms-stale" });
    }
    for (const version of ["1", 1.5, null, true]) {
      expect((await post("/api/tenants", createBody(slug, { accepted_customer_terms_version: version }))).status).toBe(400);
    }
    expect(await tenantRow(slug)).toBeNull();
    expect(calls).toHaveLength(0);
  });
  it("accepts the current version and records who accepted what, when", async () => {
    const slug = freshSlug("ctc");
    outbound();
    const before = Math.floor(Date.now() / 1000);
    const r = await post("/api/tenants", createBody(slug));
    expect(r.status).toBe(201);
    const row = await tenantRow(slug);
    const [accepted, ...rest] = await acceptances(row.tenant_id);
    expect(rest).toEqual([]);
    expect(accepted).toEqual({ tenant_id: row.tenant_id, slug, version: CUSTOMER_TERMS_VERSION, accepted_at: expect.any(Number) });
    expect(accepted.accepted_at).toBeGreaterThanOrEqual(before);
    expect(accepted.accepted_at).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
  });
  it("records the acceptance of a paid creation too", async () => {
    const slug = freshSlug("ctp");
    outbound();
    const r = await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3 }));
    expect(r.status).toBe(201);
    expect(await acceptances((await tenantRow(slug)).tenant_id)).toHaveLength(1);
  });
});
