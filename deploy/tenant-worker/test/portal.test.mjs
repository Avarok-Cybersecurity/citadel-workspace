/**
 * The billing portal: the claim code opens it until the owner's address is verified; after that,
 * the code only mails a single-use link to that address, and the link opens it.
 *
 * Through the real Worker and D1; the mail sink stands in for Email Sending and the outbound
 * stub for Stripe. The customer id is set in D1 directly: getting one needs a whole Checkout,
 * which webhook.test.mjs covers.
 */
import { env } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBody, freshSlug, mailsIn, outbound, ownerEmail, post, tenantRow } from "./helpers.mjs";

afterEach(() => vi.restoreAllMocks());

const portalCalls = (calls) => calls.filter((c) => c.url.endsWith("/v1/billing_portal/sessions"));

/** An active tenant with a Stripe customer; its address verified when `verified`. */
async function owner(verified) {
  const slug = freshSlug("po");
  const { calls } = outbound();
  const created = await (await post("/api/tenants", createBody(slug))).json();
  const token = /&v=([0-9a-f]{64})/.exec(mailsIn(calls)[0].text)[1];
  if (verified) expect((await post(`/api/tenants/${slug}/verify-email`, { token })).status).toBe(200);
  await env.CONTROL_DB.prepare("UPDATE tenants SET stripe_customer = 'cus_test_po' WHERE slug = ?").bind(slug).run();
  vi.restoreAllMocks();
  return { slug, code: created.claim_code };
}

/** The token of the billing link in a mailed message. */
const linkToken = (mail, slug) =>
  new RegExp(`https://work\\.avarok\\.net/billing#slug=${slug}&t=([0-9a-f]{64})`).exec(mail.text)?.[1];

describe("the billing portal", () => {
  it("opens for the claim code while the address is unverified", async () => {
    const { slug, code } = await owner(false);
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/portal`, { claim_code: code });
    expect(r.status).toBe(200);
    expect(new URL((await r.json()).portal_url).host).toBe("billing.stripe.com");
    expect(mailsIn(calls)).toHaveLength(0);
  });

  it("once the address is verified, the code mails a link to it and opens nothing", async () => {
    const { slug, code } = await owner(true);
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/portal`, { claim_code: code });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ portal_emailed: true });
    expect(portalCalls(calls)).toHaveLength(0);
    const mails = mailsIn(calls);
    expect(mails).toHaveLength(1);
    expect(mails[0].to).toEqual([ownerEmail(slug)]);
    expect(linkToken(mails[0], slug)).toMatch(/^[0-9a-f]{64}$/);
    expect(mails[0].text).not.toContain(code);
  });

  it("the mailed link opens the portal once, and never again", async () => {
    const { slug, code } = await owner(true);
    const { calls } = outbound();
    await post(`/api/tenants/${slug}/portal`, { claim_code: code });
    const token = linkToken(mailsIn(calls)[0], slug);
    expect((await post(`/api/tenants/${slug}/portal-link`, { token: "0".repeat(64) })).status).toBe(400);
    const opened = await post(`/api/tenants/${slug}/portal-link`, { token });
    expect(opened.status).toBe(200);
    expect(new URL((await opened.json()).portal_url).host).toBe("billing.stripe.com");
    expect(portalCalls(calls).at(-1).form.get("customer")).toBe("cus_test_po");
    expect((await post(`/api/tenants/${slug}/portal-link`, { token })).status).toBe(400);
  });

  it("an expired link opens nothing", async () => {
    const { slug, code } = await owner(true);
    const { calls } = outbound();
    await post(`/api/tenants/${slug}/portal`, { claim_code: code });
    const token = linkToken(mailsIn(calls)[0], slug);
    await env.CONTROL_DB.prepare("UPDATE tenants SET portal_expires = 1 WHERE slug = ?").bind(slug).run();
    expect((await post(`/api/tenants/${slug}/portal-link`, { token })).status).toBe(400);
    expect(portalCalls(calls)).toHaveLength(0);
  });

  it("a wrong code mails nothing and says only that it does not own the workspace", async () => {
    const { slug } = await owner(true);
    const { calls } = outbound();
    const r = await post(`/api/tenants/${slug}/portal`, { claim_code: "0".repeat(64) });
    expect(r.status).toBe(403);
    expect(mailsIn(calls)).toHaveLength(0);
    expect((await tenantRow(slug)).portal_hash).toBeNull();
  });
});
