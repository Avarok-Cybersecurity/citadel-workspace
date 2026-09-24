/**
 * The UI on the control host, under the production configuration: what nginx
 * (docker/ui/nginx.conf.template) sent, per kind of file, plus Turnstile in the CSP and the
 * meta tags that switch the hosted flow on. The files are test/fixture-ui (vitest.config.mjs).
 */
import { describe, expect, it } from "vitest";
import { dispatch } from "../control/dispatch.mjs";
import { contentSecurityPolicy, webAnalyticsBeacon } from "../control/ui.mjs";
import { productionEnv } from "./helpers.mjs";

const AGENT = "wss://local.avarok.net:12345";
// A stand-in site token: the real one is a Worker secret, set at deploy (wrangler secret put).
const ANALYTICS_TOKEN = "0123456789abcdef0123456789abcdef";
const at = (path, init) => dispatch(new Request(`https://work.avarok.net${path}`, init), productionEnv({ WEB_ANALYTICS_TOKEN: ANALYTICS_TOKEN }));

function expectSecurityHeaders(r) {
  expect(r.headers.get("content-security-policy")).toBe(contentSecurityPolicy(AGENT));
  expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");
  expect(r.headers.get("x-frame-options")).toBe("DENY");
  expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  expect(r.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
  expect(r.headers.get("permissions-policy")).toBe("geolocation=(), microphone=(self), camera=(self), display-capture=(self)");
}

const meta = (html, name) => new RegExp(`<meta name="${name}" content="([^"]*)"`).exec(html)?.[1];

describe("the CSP", () => {
  it("is nginx's, with Turnstile's script and frame allowed and the agent the one extra socket", () => {
    const csp = contentSecurityPolicy(AGENT);
    expect(csp).toContain("script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' https://challenges.cloudflare.com https://static.cloudflareinsights.com;");
    expect(csp).toContain("frame-src https://challenges.cloudflare.com;");
    expect(csp).toContain(`connect-src 'self' ${AGENT} https://cloudflareinsights.com;`);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/\bwss?:(?!\/\/local\.avarok\.net)/);
  });
});

describe("Web Analytics", () => {
  it("the page carries the beacon itself, so a page the service worker serves from cache counts too", async () => {
    const html = await (await at("/")).text();
    expect(html).toContain(webAnalyticsBeacon(ANALYTICS_TOKEN));
    expect(html.match(/cloudflareinsights/g)).toHaveLength(1);
  });

  it("without the secret there is no beacon and the page may be transformed as before", async () => {
    const r = await dispatch(new Request("https://work.avarok.net/"), productionEnv());
    expect(r.headers.get("cache-control")).toBe("public, no-cache");
    expect(await r.text()).not.toContain("cloudflareinsights");
  });

  it("a malformed token is refused, not written into the page", async () => {
    await expect(dispatch(new Request("https://work.avarok.net/"), productionEnv({ WEB_ANALYTICS_TOKEN: "x' onload='alert(1)" })))
      .rejects.toThrow(/WEB_ANALYTICS_TOKEN/);
  });
});

describe("the SPA shell", () => {
  for (const path of ["/", "/create", "/create/done", "/some/deep/route"]) {
    it(`${path} is index.html with the meta tags filled in and the headers nginx sent`, async () => {
      const r = await at(path);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toMatch(/^text\/html/);
      expect(r.headers.get("cache-control")).toBe("public, no-cache, no-transform");
      expectSecurityHeaders(r);
      const html = await r.text();
      expect(html).toContain("<title>Fixture shell</title>");
      expect(meta(html, "citadel-control-plane")).toBe("/api");
      expect(meta(html, "citadel-loopback-agent")).toBe(AGENT);
      expect(meta(html, "citadel-default-server")).toBe("");
    });
  }
});

describe("files", () => {
  it("a hashed bundle is immutable for a year", async () => {
    const r = await at("/assets/index-f1x7ur3a.js");
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    expectSecurityHeaders(r);
    expect(await r.text()).toContain("hashed bundle");
  });
  it("a missing bundle or binary is 404, not the shell cached as immutable", async () => {
    for (const path of ["/assets/index-deadbeef.js", "/wasm/missing_bg.wasm"]) {
      const r = await at(path);
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).not.toMatch(/html/);
      expect(r.headers.get("cache-control")).toBe("no-store");
      expectSecurityHeaders(r);
    }
  });
  it("the wasm binary revalidates and is application/wasm", async () => {
    const r = await at("/wasm/fixture_bg.wasm");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/wasm");
    expect(r.headers.get("cache-control")).toBe("public, no-cache");
    expectSecurityHeaders(r);
  });
  it("the service worker is never cached and the manifest has its real type", async () => {
    const sw = await at("/sw.js");
    expect(sw.headers.get("cache-control")).toBe("no-cache, no-store, must-revalidate");
    expectSecurityHeaders(sw);
    const manifest = await at("/manifest.webmanifest");
    expect(manifest.headers.get("content-type")).toBe("application/manifest+json");
    expect(manifest.headers.get("cache-control")).toBe("public, max-age=3600");
    expectSecurityHeaders(manifest);
  });
});

describe("what the site does not swallow", () => {
  it("/api/* is still the control plane", async () => {
    const r = await at("/api/no-such-route");
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not-found");
  });
  it("a tenant host is never answered with the site", async () => {
    const r = await dispatch(new Request("https://acme.work.avarok.net/index.html"), productionEnv());
    expect(r.status).toBe(426);
  });
});
