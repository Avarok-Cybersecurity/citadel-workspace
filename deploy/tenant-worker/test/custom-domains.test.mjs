/**
 * A custom domain (batch 1116 lane I4): attaching one makes it canonical and puts the slug host
 * among the former domains, in the registry and in the tenant's kernel, and the identity document
 * is served on both hosts. Plus where the landing page's Content-Signal and Link headers go:
 * the public landing only, never the app or a tenant host.
 */
import { env, runInDurableObject, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { dispatch, ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { attached, attachCustomDomain, MAX_FORMER_DOMAINS } from "../control/tenant-domains.mjs";
import { freeTenant, ORIGIN, productionEnv, tenantRow } from "./helpers.mjs";
import { expectSignedBy, storedSeed, wellKnownAt } from "./identity-helpers.mjs";

const CFG = config(env);
const attach = (slug, domain) => attachCustomDomain(ioFor(env), CFG, slug, domain);

describe("attaching a custom domain", () => {
  it("makes it canonical, keeps the slug host as a former domain, and serves one document on both hosts", async () => {
    const { slug, object } = await freeTenant("cd");
    const slugHost = `${slug}.${CFG.controlHost}`;
    const custom = `${slug}.example`;
    expect((await (await wellKnownAt(slugHost)).json()).canonical_domain).toBe(slugHost);

    expect(await attach(slug, custom)).toEqual({ ok: true, identity: { canonical_domain: custom, former_domains: [slugHost] } });
    const row = await tenantRow(slug);
    expect([row.custom_domain, JSON.parse(row.former_domains)]).toEqual([custom, [slugHost]]);

    const onCustom = await wellKnownAt(custom);
    const onSlug = await wellKnownAt(slugHost);
    expect([onCustom.status, onSlug.status]).toEqual([200, 200]);
    const text = await onCustom.text();
    expect(await onSlug.text()).toBe(text);
    const doc = JSON.parse(text);
    expect(doc).toMatchObject({ canonical_domain: custom, former_domains: [slugHost], citadel: { wss: `wss://${custom}/citadel` } });
    expectSignedBy(doc, await storedSeed(object));

    const kernel = await runInDurableObject(object, (instance) => instance.provisioning.kernelConfig());
    expect(kernel.split("\n")).toEqual(expect.arrayContaining([`canonical_domain = "${custom}"`, `former_domains = ["${slugHost}"]`]));
  });

  it("reaches the tenant's socket on the custom domain too", async () => {
    const { slug } = await freeTenant("cd");
    expect((await attach(slug, `${slug}.example`)).ok).toBe(true);
    const r = await SELF.fetch(`https://${slug}.example/citadel`, { headers: { upgrade: "websocket" } });
    expect(r.status).toBe(101);
    r.webSocket.accept();
    r.webSocket.close(1000, "done");
  });

  it("keeps every earlier name when a second custom domain replaces the first", async () => {
    const { slug } = await freeTenant("cd");
    await attach(slug, `${slug}.example`);
    const second = await attach(slug, `www.${slug}.example`);
    expect(second.identity).toEqual({ canonical_domain: `www.${slug}.example`, former_domains: [`${slug}.example`, `${slug}.${CFG.controlHost}`] });
    // The slug host always reaches the tenant; a former custom domain is a name accounts keep, not a route.
    expect((await (await wellKnownAt(`${slug}.${CFG.controlHost}`)).json()).former_domains).toEqual(second.identity.former_domains);
    expect(await ioFor(env).store.slugForDomain(`${slug}.example`)).toBeNull();
  });

  it("refuses a domain another tenant holds, the control plane's own names, and malformed ones", async () => {
    const a = await freeTenant("cd");
    const b = await freeTenant("cd");
    expect((await attach(a.slug, `${a.slug}.example`)).ok).toBe(true);
    expect(await attach(b.slug, `${a.slug}.example`)).toEqual({ ok: false, reason: "domain-taken" });
    expect((await tenantRow(b.slug)).custom_domain).toBeNull();
    for (const [domain, reason] of [
      [CFG.controlHost, "reserved-domain"],
      [`${a.slug}.${CFG.controlHost}`, "reserved-domain"],
      ["Acme.Example", "invalid-domain"],
      ["acme.example:8443", "invalid-domain"],
      ["acme.example/path", "invalid-domain"],
      ["localhost", "invalid-domain"],
    ]) {
      expect(await attach(b.slug, domain), domain).toEqual({ ok: false, reason });
    }
    expect(await attach("no-such-tenant", "x.example")).toEqual({ ok: false, reason: "not-found" });
  });

  it("refuses a domain that would publish more former domains than the document may hold", () => {
    const former = Array.from({ length: MAX_FORMER_DOMAINS }, (_, i) => `old${i}.example`);
    expect(attached(CFG, { canonical_domain: "now.example", former_domains: former }, "next.example")).toEqual({ ok: false, reason: "too-many-former-domains" });
    expect(attached(CFG, { canonical_domain: "now.example", former_domains: former.slice(1) }, "next.example").ok).toBe(true);
  });
});

describe("Content-Signal and Link", () => {
  // Under wrangler.toml's own vars (no path routing, as deployed): with the tests' TENANT_PATH_ROUTING,
  // "/workspace" would be the tenant "workspace", and an absence there would prove nothing.
  const ui = (path, init) => dispatch(new Request(`${ORIGIN}${path}`, init), productionEnv());
  const navigate = (path) => ui(path, { headers: { "sec-fetch-mode": "navigate" } });

  it("are on the public landing page", async () => {
    const r = await navigate("/");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-signal")).toBe("ai-train=no, search=yes, ai-input=yes");
    expect(r.headers.get("link")).toBe(`<${productionEnv().PUBLIC_ORIGIN}/>; rel="canonical"`);
  });

  it("are on no page of the app a signed-in person uses", async () => {
    for (const path of ["/workspace", "/office/abc", "/index.html", "/create"]) {
      const r = await navigate(path);
      // The page itself, so the absence below is of a header on a real page.
      expect([path, r.status, r.headers.get("content-type")]).toEqual([path, 200, expect.stringMatching(/^text\/html/)]);
      expect([path, r.headers.get("content-signal"), r.headers.get("link")]).toEqual([path, null, null]);
    }
  });

  it("are on no file, API answer or tenant host", async () => {
    const { slug } = await freeTenant("cd");
    const responses = [
      await ui("/sw.js"),
      await ui("/api/admission"),
      await wellKnownAt(`${slug}.${CFG.controlHost}`),
      await SELF.fetch(`https://${slug}.${CFG.controlHost}/`),
    ];
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    for (const r of responses) expect([r.url, r.headers.get("content-signal"), r.headers.get("link")]).toEqual([r.url, null, null]);
  });
});
