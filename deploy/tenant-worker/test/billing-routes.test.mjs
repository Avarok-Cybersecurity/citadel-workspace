/**
 * The billing answers: the public policy (one source, billing/policy.json), the owner's meters
 * behind the claim code, and the coarse alert level on the public status and discovery answers.
 * The real Worker; the fetch boundary (Turnstile) is the only mock.
 */
import { describe, expect, it } from "vitest";
import policyFile from "../../../billing/policy.json";
import { createBody, freshSlug, get, outbound, post, relay } from "./helpers.mjs";

/** The file's values as a reader renders them: every `$comment` dropped, here and not by the code under test. */
const values = (v) =>
  Array.isArray(v) ? v.map(values) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => k !== "$comment").map(([k, x]) => [k, values(x)])) : v;

async function freeWithCode(stem) {
  const slug = freshSlug(stem);
  outbound();
  const r = await post("/api/tenants", createBody(slug));
  expect(r.status).toBe(201);
  return { slug, claim: (await r.json()).claim_code };
}

describe("GET /api/billing/policy", () => {
  it("is billing/policy.json's values, cacheable for five minutes", async () => {
    const r = await get("/api/billing/policy");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    const file = values(policyFile);
    const { termination_ttl_hours, terminated_service, data_deleted_on_termination } = file.overage_billing;
    expect(await r.json()).toEqual({
      overage_billing: { termination_ttl_hours, terminated_service, data_deleted_on_termination },
      dunning: file.dunning,
      alerts: file.alerts,
      terms: file.terms,
    });
  });
});

describe("POST /api/tenants/<slug>/usage", () => {
  it("answers the claim-code holder with each dimension's numbers", async () => {
    const { slug, claim } = await freeWithCode("use");
    await relay(slug, 1.5e9);
    const r = await post(`/api/tenants/${slug}/usage`, { claim_code: claim });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.overage_billing).toBe(false);
    expect(body.period.end).toBeGreaterThan(body.period.start);
    expect(body.billing).toEqual({ state: "ok", alert: "none", overage_billing: false });
    expect(body.dimensions.map((d) => d.id)).toEqual(["relay-overage", "document-appends", "storage"]);
    expect(body.dimensions[0]).toEqual({ id: "relay-overage", unit: "GB", used: 1.5, included: 2, percent: 75, state: "ok", terminate_at: null });
    await relay(slug, 0.5e9);
    const crossed = (await (await post(`/api/tenants/${slug}/usage`, { claim_code: claim })).json()).dimensions[0];
    expect(crossed.state).toBe("terminating");
    expect(crossed.terminate_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("a wrong code is the same 403 as a workspace that does not exist; a malformed slug is 404", async () => {
    const { slug } = await freeWithCode("usew");
    const wrong = await post(`/api/tenants/${slug}/usage`, { claim_code: "0".repeat(64) });
    const unknown = await post(`/api/tenants/${freshSlug("nobody")}/usage`, { claim_code: "0".repeat(64) });
    const missing = await post(`/api/tenants/${slug}/usage`, {});
    expect([wrong.status, unknown.status, missing.status]).toEqual([403, 403, 403]);
    const [a, b, c] = [await wrong.json(), await unknown.json(), await missing.json()];
    expect(a).toEqual(b);
    expect(c).toEqual(b);
    expect(a).toEqual({ error: "not-owner", detail: "that claim code does not own this workspace" });
    expect((await post("/api/tenants/Not_A_Slug/usage", { claim_code: "0".repeat(64) })).status).toBe(404);
  });
});

describe("the public answers carry the level and no numbers", () => {
  it("status and discovery follow the worst dimension", async () => {
    const { slug } = await freeWithCode("lvl");
    const status = async () => (await get(`/api/tenants/${slug}/status`)).json();
    const discovery = async () => (await get(`/api/admission/${slug}`)).json();
    expect((await status()).billing).toEqual({ state: "ok", alert: "none", overage_billing: false });
    expect((await discovery()).alert).toBe("none");

    await relay(slug, 2e9);
    const s = await status();
    expect(s.billing.alert).toBe("terminating");
    expect((await discovery()).alert).toBe("terminating");
    const text = JSON.stringify(s);
    for (const leak of ["used", "included", "percent", "terminate_at", "bytes"]) expect(text).not.toContain(leak);
  });
});
