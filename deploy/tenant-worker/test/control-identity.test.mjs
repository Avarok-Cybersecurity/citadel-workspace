/**
 * work.avarok.net's own server identity (batch 1116 lane I4c; sign-in-with-citadel.md §7): the
 * issuer-only `/.well-known/citadel` built from the secret seed and the issued_at var, the path
 * routing that keeps the control plane's segments off the tenants, and the refusal when the seed
 * is missing -- 404 and 503 with a log line, never a key of the Worker's own making.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import worker from "../worker.mjs";
import { CONTROL_SEGMENTS, tenantFor } from "../control/dispatch.mjs";
import { checkSlug } from "../control/slug.mjs";
import { config } from "../control/http.mjs";
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";
import { freeTenant } from "./helpers.mjs";
import { expectSignedBy, fixture, storedSeed, wellKnownAt } from "./identity-helpers.mjs";
import { beginBody, CFG, fromHex, KAT, signInFixture } from "./sign-in-helpers.mjs";

const ISSUER_ONLY = fixture("valid-issuer-only.json");
const controlUrl = (path) => `https://${CFG.controlHost}${path}`;

describe("the control host's /.well-known/citadel", () => {
  it("is C0's issuer-only document, reproduced from the KAT issuer seed, with no citadel member", async () => {
    expect(env.CONTROL_SERVER_KEY_SEED).toBe(KAT.issuer.key.seed_hex);
    const r = await wellKnownAt(CFG.controlHost);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    const doc = await r.json();
    expect(doc).toEqual(ISSUER_ONLY);
    expect(doc).not.toHaveProperty("citadel");
    expectSignedBy(doc, fromHex(KAT.issuer.key.seed_hex));
  });

  it("is byte-identical from two independent instances (two isolates), because issued_at is a var", () => {
    const issue = () => {
      const instance = instantiate(wasm);
      const identity = new instance.IssuerIdentity(fromHex(KAT.issuer.key.seed_hex), CFG.controlHost, BigInt(CFG.issuer.issuedAt));
      return new TextDecoder().decode(identity.well_known());
    };
    const [a, b] = [issue(), issue()];
    expect(a).toBe(b);
    expect(JSON.parse(a)).toEqual(ISSUER_ONLY);
  });
});

describe("path routing keeps the control plane's segments on the control host", () => {
  const routed = { ...CFG, pathRouting: true };

  it("tenantFor reads no control segment as a slug, and still reads a tenant's", () => {
    expect([...CONTROL_SEGMENTS].sort()).toEqual([".well-known", "api", "sign-in"]);
    for (const path of ["/.well-known/citadel", "/sign-in/begin", "/sign-in", "/api/admission", "/api"]) {
      expect(tenantFor(new URL(controlUrl(path)), routed), path).toBeNull();
    }
    expect(tenantFor(new URL(controlUrl("/acme/.well-known/citadel")), routed)).toBe("acme");
    expect(tenantFor(new URL("https://acme.work.avarok.net/.well-known/citadel"), CFG)).toBe("acme");
  });

  it("with TENANT_PATH_ROUTING on, /.well-known/citadel and /sign-in/* are the control host's, /<slug>/.well-known/citadel the tenant's", async () => {
    expect(CFG.pathRouting).toBe(true);
    const control = await SELF.fetch(controlUrl("/.well-known/citadel"));
    expect(await control.json()).toEqual(ISSUER_ONLY);
    const clients = await SELF.fetch(controlUrl("/sign-in/clients.json"));
    expect(clients.status).toBe(200);
    expect(await clients.json()).toEqual(signInFixture("ReturnAllowlist/valid.json"));

    const { slug, object } = await freeTenant("ctl");
    const tenant = await SELF.fetch(controlUrl(`/${slug}/.well-known/citadel`));
    expect(tenant.status).toBe(200);
    const doc = await tenant.json();
    expect(doc.citadel).toEqual({ wss: `wss://${slug}.${CFG.controlHost}/citadel` });
    expectSignedBy(doc, await storedSeed(object));
  });

  it("no tenant can be named sign-in", () => {
    expect(checkSlug("sign-in")).toEqual({ ok: false, reason: "reserved" });
  });
});

describe("without CONTROL_SERVER_KEY_SEED", () => {
  const unkeyed = { ...env, CONTROL_SERVER_KEY_SEED: undefined };
  const attempts = async () => (await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM sign_in_attempts").first()).n;

  it("the document answers 404 and every /sign-in/* route 503, each logged, and nothing is stored or signed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const doc = await worker.fetch(new Request(controlUrl("/.well-known/citadel")), unkeyed);
    expect(doc.status).toBe(404);
    expect(logged.mock.calls.flat().join("\n")).toMatch(/\/\.well-known\/citadel: CONTROL_SERVER_KEY_SEED is not set/);

    const before = await attempts();
    const begin = await worker.fetch(
      new Request(controlUrl("/sign-in/begin"), {
        method: "POST", headers: { origin: CFG.publicOrigin, "content-type": "application/json" }, body: JSON.stringify(beginBody()),
      }),
      unkeyed,
    );
    expect(begin.status).toBe(503);
    expect(await begin.json()).toMatchObject({ error: "issuer_unavailable" });
    expect(await attempts()).toBe(before);
    for (const path of ["/sign-in/clients.json", "/sign-in/prove", "/sign-in/complete"]) {
      expect((await worker.fetch(new Request(controlUrl(path), { method: "POST" }), unkeyed)).status, path).toBe(503);
    }
    expect(logged.mock.calls.flat().join("\n")).toMatch(/\/sign-in\/begin: CONTROL_SERVER_KEY_SEED is not set/);
  });

  it("a malformed seed or an issued_at outside the schema's range is a misconfiguration, not a default", () => {
    expect(() => config({ ...env, CONTROL_SERVER_KEY_SEED: "00" })).toThrow(/CONTROL_SERVER_KEY_SEED/);
    expect(() => config({ ...env, CONTROL_SERVER_KEY_ISSUED_AT: "17" })).toThrow(/CONTROL_SERVER_KEY_ISSUED_AT/);
    expect(() => config({ ...env, CONTROL_SERVER_KEY_ISSUED_AT: undefined })).toThrow(/CONTROL_SERVER_KEY_ISSUED_AT/);
  });
});
