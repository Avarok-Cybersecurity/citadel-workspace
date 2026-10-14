/**
 * Avarok support's signed reads (control/support.mjs) through the real verifier (server-wasm, in
 * the Worker), the real D1 nonce store and grant mirror, and the real tenant object and kernel.
 *
 * The requests are fixtures signed with a test key at one fixed instant
 * (test/fixtures/support-requests.json, from citadel-support-signature's support_fixtures
 * example), so the handler is called with that instant as its clock (`io.nowMs`). The same
 * fixtures through the deployed route (SELF) meet the real clock and are expired, which the last
 * block shows. A grant is the kernel's, set by an admin over a Citadel session, which no test here
 * opens: the kernel's own tests (support_reads_are_signed_and_mirrored.rs,
 * telemetry_reads_are_gated_and_audited.rs) serve and audit a granted read and refuse an expired
 * grant; here the object's kernel has no grant, so a verified read reaches it and is refused.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { serveSupport, supportRoute } from "../control/support.mjs";
import fixtures from "./fixtures/support-requests.json";
import { createBody, ORIGIN, outbound, post, productionEnv, tenantObject, tenantRow } from "./helpers.mjs";

const NOW = fixtures.now_ms;
const HOUR = 60 * 60 * 1000;

function ask(route, name, at = NOW) {
  const io = { ...ioFor(env), nowMs: () => at };
  const request = new Request(`${ORIGIN}/api/support/${route}`, { method: "POST", body: fixtures.requests[name] });
  return serveSupport(io, config(env), request, supportRoute("POST", ["support", route]));
}

const nonceCount = async () => (await env.CONTROL_DB.prepare("SELECT COUNT(*) AS n FROM support_nonces").first()).n;

async function expectRefused(response, status, error) {
  expect(response.status).toBe(status);
  expect(await response.json()).toMatchObject({ error });
}

beforeAll(async () => {
  for (const slug of ["support-alpha", "support-beta"]) {
    outbound();
    expect((await post("/api/tenants", createBody(slug))).status).toBe(201);
    vi.restoreAllMocks();
  }
});

describe("a verified request", () => {
  it("is forwarded to the tenant, whose kernel refuses it without a grant", async () => {
    const r = await ask("telemetry", "fetch_beta");
    expect(r.status).toBe(403);
    expect(await r.text()).toContain("Support access is not granted");
  });
  it("is served once: the same nonce again is a replay", async () => {
    expect((await ask("telemetry", "fetch_alpha_replayed")).status).toBe(403);
    await expectRefused(await ask("telemetry", "fetch_alpha_replayed"), 409, "replayed");
  });
  it("names no tenant that is not active", async () => {
    await expectRefused(await ask("telemetry", "fetch_unknown_tenant"), 404, "not-found");
  });
  it("is served only at its own route", async () => {
    await expectRefused(await ask("telemetry", "list_grants_at_telemetry"), 400, "wrong-route");
  });
});

describe("a request that does not verify stores nothing and reaches no tenant", () => {
  for (const [name, why] of [
    ["wrong_key", /does not verify/],
    ["release_domain", /does not verify/],
    ["expired", /expired/],
    ["too_long", /more than 300 seconds/],
  ]) {
    it(`refuses ${name}`, async () => {
      const before = await nonceCount();
      const r = await ask("telemetry", name);
      expect(r.status).toBe(401);
      expect((await r.json()).detail).toMatch(why);
      expect(await nonceCount()).toBe(before);
    });
  }
  it("refuses a body that is not a signed request", async () => {
    const io = { ...ioFor(env), nowMs: () => NOW };
    const r = await serveSupport(io, config(env), new Request(`${ORIGIN}/api/support/grants`, { method: "POST", body: "{}" }), "grants");
    await expectRefused(r, 401, "unauthorized");
  });
});

describe("nonces", () => {
  it("are deleted once their request has expired", async () => {
    await env.CONTROL_DB.prepare("INSERT INTO support_nonces (nonce, expires_at_ms) VALUES (?, ?)").bind("0".repeat(32), NOW - 1).run();
    expect((await ask("grants", "list_grants")).status).toBe(200);
    const stale = await env.CONTROL_DB.prepare("SELECT 1 FROM support_nonces WHERE nonce = ?").bind("0".repeat(32)).first();
    expect(stale).toBeNull();
  });
});

describe("the grant list", () => {
  it("lists the tenants an object reported granted and unexpired, and drops revoked and expired ones", async () => {
    const beta = await tenantRow("support-beta");
    // The object's own grant host (worker.mjs `telemetry.grantHost()`), as the kernel calls it.
    const report = (slug, enabled, untilMs) =>
      runInDurableObject(tenantObject(slug), (instance) => instance.telemetry.grantHost().changed(enabled, untilMs));
    const mirrored = async (tenantId) =>
      (await env.CONTROL_DB.prepare("SELECT 1 FROM support_grants WHERE tenant_id = ?").bind(tenantId).first()) !== null;
    await report("support-alpha", true, NOW + HOUR);
    await report("support-beta", true, NOW + HOUR);
    expect(await mirrored(beta.tenant_id)).toBe(true);
    await report("support-beta", false, null);
    expect(await mirrored(beta.tenant_id)).toBe(false);
    await report("support-beta", true, NOW - 1);

    const r = await ask("grants", "list_grants_again");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ grants: [{ tenant: "support-alpha", until_ms: NOW + HOUR }] });
    expect(await mirrored(beta.tenant_id)).toBe(false);
  });
});

describe("the deployed routes", () => {
  it("verify against the real clock: a fixture made for another instant is refused", async () => {
    const r = await SELF.fetch(`${ORIGIN}/api/support/telemetry`, { method: "POST", body: fixtures.requests.fetch_alpha });
    expect(r.status).toBe(401);
    expect((await r.json()).detail).toMatch(/expire/);
  });
  it("answer 503 without CITADEL_SUPPORT_MLDSA_PUBLIC_KEY, as production does until it is set", async () => {
    const prod = productionEnv({ CITADEL_SUPPORT_MLDSA_PUBLIC_KEY: undefined });
    expect(config(prod).supportPublicKey).toBeNull();
    const io = { ...ioFor(env), nowMs: () => NOW };
    const r = await serveSupport(io, config(prod), new Request(`${ORIGIN}/api/support/grants`, { method: "POST", body: fixtures.requests.list_grants }), "grants");
    await expectRefused(r, 503, "unconfigured");
  });
});
