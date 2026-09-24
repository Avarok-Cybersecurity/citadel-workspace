/**
 * What the deployed configuration promises: a tenant host answers its WebSocket and nothing else
 * (no stats: connections, row counts, entitlements, a claim-code fingerprint), tenants are reached
 * by subdomain only, and every host the routes send here reaches the Worker before any asset.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatch } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { createBody, freshSlug, outbound, post, production, productionEnv } from "./helpers.mjs";

const STATS_FIELDS = ["accepted", "connections", "stored", "entitlements", "master_password_sha256_prefix", "provisioned", "wasm_instance"];

async function activeTenant() {
  const slug = freshSlug("pc");
  outbound();
  const r = await post("/api/tenants", createBody(slug));
  expect(r.status).toBe(201);
  return slug;
}

async function expectNothingSaid(response) {
  expect(response.status).toBe(426);
  expect(response.headers.get("upgrade")).toBe("websocket");
  const text = await response.text();
  for (const field of STATS_FIELDS) expect(text).not.toContain(field);
  expect(text).toBe("a workspace is reached over a WebSocket");
}

describe("wrangler.toml, as wrangler reads it", () => {
  it("turns diagnostics and path routing off", () => {
    const { vars } = production();
    expect(vars.TENANT_DIAGNOSTICS).toBe("off");
    expect(vars.TENANT_PATH_ROUTING).toBe("off");
    expect(config(productionEnv())).toMatchObject({ diagnostics: false, pathRouting: false, controlHost: "work.avarok.net" });
  });
  it("routes the apex and every tenant host to the Worker, which runs before any asset", () => {
    const { routes, assets } = production();
    expect(routes).toEqual([
      { pattern: "work.avarok.net/*", zone_name: "avarok.net" },
      { pattern: "*.work.avarok.net/*", zone_name: "avarok.net" },
    ]);
    expect(assets).toMatchObject({ binding: "ASSETS", run_worker_first: true, not_found_handling: "single-page-application" });
  });
  it("refuses a diagnostics switch that is neither on nor off", () => {
    expect(() => config(productionEnv({ TENANT_DIAGNOSTICS: "yes" }))).toThrow(/TENANT_DIAGNOSTICS/);
    expect(() => config(productionEnv({ TENANT_DIAGNOSTICS: undefined }))).toThrow(/TENANT_DIAGNOSTICS/);
  });
});

describe("a tenant host under the production configuration", () => {
  it("answers a plain request to an active tenant with 426 and no stats", async () => {
    const slug = await activeTenant();
    const prod = productionEnv();
    await expectNothingSaid(await dispatch(new Request(`https://${slug}.work.avarok.net/`), prod));
    await expectNothingSaid(await dispatch(new Request(`https://${slug}.work.avarok.net/stats`), prod));
    await expectNothingSaid(await dispatch(new Request(`https://${slug}.work.avarok.net/`, { method: "POST", body: "x" }), prod));
  });
  it("says the same for a slug that does not exist, so a probe learns nothing", async () => {
    await expectNothingSaid(await dispatch(new Request(`https://${freshSlug("nx")}.work.avarok.net/`), productionEnv()));
  });
  it("does not reach a tenant by path: /<slug> on the apex is the site", async () => {
    const slug = await activeTenant();
    const r = await dispatch(new Request(`https://work.avarok.net/${slug}`), productionEnv());
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/^text\/html/);
    const text = await r.text();
    for (const field of STATS_FIELDS) expect(text).not.toContain(field);
  });
  // The control: the same request with diagnostics on is answered with the stats, so the
  // assertions above would see them if production exposed them.
  it("control: with TENANT_DIAGNOSTICS on, the same request is the object's stats", async () => {
    const slug = await activeTenant();
    const r = await dispatch(new Request(`https://${slug}.work.avarok.net/`), productionEnv({ TENANT_DIAGNOSTICS: "on" }));
    expect(r.status).toBe(200);
    const stats = await r.json();
    expect(stats).toMatchObject({ provisioned: true, accepted: 0 });
    expect(stats.master_password_sha256_prefix).toMatch(/^[0-9a-f]{8}$/);
  });
  it("the object itself serves no stats, whatever the Worker's switch", async () => {
    const slug = await activeTenant();
    const object = env.WORKSPACE.get(env.WORKSPACE.idFromName(slug));
    await expectNothingSaid(await object.fetch(new Request(`https://${slug}.work.avarok.net/`)));
  });
});
