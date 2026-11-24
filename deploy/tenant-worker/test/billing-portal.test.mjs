/**
 * The billing portal's two ways in, through the real Worker, D1 and tenant objects; Stripe is
 * answered at the fetch boundary by helpers.mjs `outbound()` (never the real API).
 *
 *   - the claim code (POST /api/tenants/:slug/portal): still opens the owner's portal, still
 *     refuses a wrong code without asking Stripe;
 *   - a member's session: the tenant object's `billingPortal()`, which the node calls once the
 *     kernel has admitted the member (kernel test `only_who_configures_the_workspace_opens_its_
 *     billing_portal`). It opens the object's OWN tenant's portal, by the tenant id it was
 *     provisioned with: it takes no argument, so nothing can point it at another workspace.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { config } from "../control/http.mjs";
import { ioFor } from "../control/dispatch.mjs";
import { portalFor } from "../control/billing-portal.mjs";
import { createBody, freshSlug, outbound, post, tenantObject, tenantRow } from "./helpers.mjs";

const PORTALS = "https://api.stripe.com/v1/billing_portal/sessions";

/** A free tenant, its claim code, and (with `customer`) the Stripe customer a paid plan would have. */
async function tenant(stem, customer = null) {
  const slug = freshSlug(stem);
  outbound();
  const created = await post("/api/tenants", createBody(slug));
  expect(created.status).toBe(201);
  const { claim_code } = await created.json();
  if (customer !== null) await env.CONTROL_DB.prepare("UPDATE tenants SET stripe_customer = ? WHERE slug = ?").bind(customer, slug).run();
  return { slug, claim: claim_code, row: await tenantRow(slug) };
}

const portalCalls = (calls) => calls.filter((c) => c.url === PORTALS);
const fromObject = (slug) => runInDurableObject(tenantObject(slug), (instance) => instance.billingPortal());

describe("the claim-code path", () => {
  it("opens the owner's portal, and a wrong code is refused before Stripe is asked", async () => {
    const { slug, claim } = await tenant("claim", "cus_claim_owner");
    const { calls } = outbound();
    const wrong = await post(`/api/tenants/${slug}/portal`, { claim_code: "0".repeat(64) });
    expect([wrong.status, (await wrong.json()).error]).toEqual([403, "not-owner"]);
    expect(portalCalls(calls)).toEqual([]);
    const right = await post(`/api/tenants/${slug}/portal`, { claim_code: claim });
    expect(right.status).toBe(200);
    expect((await right.json()).portal_url).toBe("https://billing.stripe.com/p/session/test_1");
    expect(portalCalls(calls).map((c) => [c.form.get("customer"), c.form.get("configuration")])).toEqual([["cus_claim_owner", "bpc_test_citadel"]]);
  });

  it("says a Free workspace has no subscription", async () => {
    const { slug, claim } = await tenant("claimfree");
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/portal`, { claim_code: claim });
    expect([r.status, (await r.json()).error]).toEqual([404, "no-subscription"]);
    expect(portalCalls(calls)).toEqual([]);
  });
});

describe("the session path", () => {
  it("opens each object's own tenant's portal and never another's", async () => {
    const a = await tenant("sesa", "cus_session_a");
    const b = await tenant("sesb", "cus_session_b");
    const { calls } = outbound();
    expect(await fromObject(a.slug)).toEqual({ portal_url: "https://billing.stripe.com/p/session/test_1" });
    expect(await fromObject(b.slug)).toEqual({ portal_url: "https://billing.stripe.com/p/session/test_1" });
    expect(portalCalls(calls).map((c) => c.form.get("customer"))).toEqual(["cus_session_a", "cus_session_b"]);
    expect(portalCalls(calls).every((c) => c.form.get("configuration") === "bpc_test_citadel")).toBe(true);
  });

  it("finds the tenant by the id it was provisioned with, not by the slug it is reached at", async () => {
    const a = await tenant("sesid", "cus_by_id");
    // The registry row is renamed under it: the object still opens the subscription of the tenant id it holds.
    const renamed = freshSlug("renamed");
    await env.CONTROL_DB.prepare("UPDATE tenants SET slug = ? WHERE tenant_id = ?").bind(renamed, a.row.tenant_id).run();
    const { calls } = outbound();
    expect(await fromObject(a.slug)).toEqual({ portal_url: "https://billing.stripe.com/p/session/test_1" });
    expect(portalCalls(calls).map((c) => c.form.get("customer"))).toEqual(["cus_by_id"]);
  });

  it("says a Free workspace has no subscription, without asking Stripe", async () => {
    const { slug } = await tenant("sesfree");
    const { calls } = outbound();
    expect(await fromObject(slug)).toEqual({ refused: "no-subscription" });
    expect(portalCalls(calls)).toEqual([]);
  });

  it("fails, rather than guessing, for an object whose registry row is gone", async () => {
    const { slug, row } = await tenant("sesgone", "cus_gone");
    await env.CONTROL_DB.prepare("DELETE FROM tenants WHERE tenant_id = ?").bind(row.tenant_id).run();
    const { calls } = outbound();
    await expect(fromObject(slug)).rejects.toThrow("no registry row holds this object's tenant");
    expect(portalCalls(calls)).toEqual([]);
  });
});

describe("portalFor, the one Stripe call both paths make", () => {
  const row = { stripe_customer: "cus_cfg" };

  it("refuses without billing or without the portal configuration, and asks Stripe nothing", async () => {
    const cfg = config(env);
    const { calls } = outbound();
    expect(await portalFor(ioFor(env), { ...cfg, stripeKey: undefined }, row)).toEqual({ refused: "billing-not-configured" });
    expect(await portalFor(ioFor(env), { ...cfg, portalConfiguration: undefined }, row)).toEqual({ refused: "portal-not-configured" });
    expect(calls).toEqual([]);
  });

  it("returns to the control plane's own origin", async () => {
    const cfg = config(env);
    const { calls } = outbound();
    await portalFor(ioFor(env), cfg, row);
    expect(portalCalls(calls)[0].form.get("return_url")).toBe(`${cfg.publicOrigin}/`);
  });
});
