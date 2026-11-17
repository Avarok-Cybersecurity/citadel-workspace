/**
 * A tenant's server identity (batch 1116 lane I4): the key seed its object makes at provisioning,
 * the `[identity]` its kernel starts with, and `/.well-known/citadel` on its host, judged against
 * C0's schema and known answers by checks of the tests' own (json-schema.mjs, well-known-verify.mjs)
 * that are first proven against C0's fixtures.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { config } from "../control/http.mjs";
import { attached, createdIdentity } from "../control/tenant-domains.mjs";
import { SERVER_KEY_SEED_KEY } from "../control/tenant-identity.mjs";
import { freeTenant, freshSlug, tenantObject } from "./helpers.mjs";
import { C0, expectSignedBy, fixture, storedSeed, wellKnownAt } from "./identity-helpers.mjs";
import { violation } from "./json-schema.mjs";
import { fromHex, serverPublicKey, signatureVerifies, signedCbor, toHex } from "./well-known-verify.mjs";

const CFG = config(env);

describe("the tests' own checks hold C0's copy", () => {
  it("the schema check accepts every valid fixture and refuses every invalid one", () => {
    const names = Object.keys(C0.fixtures);
    expect(names.filter((n) => n.startsWith("invalid-")).length).toBeGreaterThan(5);
    for (const name of names) {
      const found = violation(C0.schema, fixture(name));
      if (name.startsWith("valid-")) expect(found, name).toBeNull();
      else expect(found, name).not.toBeNull();
    }
  });

  it("the verifier derives C0's keys, encodes C0's signed CBOR, and verifies only C0's signatures", () => {
    for (const server of Object.values(C0.servers)) {
      const doc = fixture(server.well_known.document.split("/").pop());
      expect(toHex(serverPublicKey(fromHex(server.key.seed_hex)))).toBe(server.key.pk_hex);
      expect(toHex(signedCbor(doc))).toBe(server.well_known.signed_cbor_hex);
      expect(signatureVerifies(doc, fromHex(server.key.pk_hex))).toBe(true);
      expect(signatureVerifies({ ...doc, issued_at: doc.issued_at + 1 }, fromHex(server.key.pk_hex))).toBe(false);
    }
    const [a, b] = Object.values(C0.servers);
    expect(signatureVerifies(fixture(a.well_known.document.split("/").pop()), fromHex(b.key.pk_hex))).toBe(false);
  });
});

/** The document an object issues at `issuedAtS` for `identity` under the seed `seedHex`. */
const issued = (slug, identity, seedHex, issuedAtS) =>
  runInDurableObject(tenantObject(slug), async (instance) => {
    const record = { tenant_id: crypto.randomUUID(), master_password: "ab".repeat(32), display_name: "KAT", entitlements: { status: "active" } };
    await instance.provisioning.provision({ ...record, identity }, false);
    await instance.ctx.storage.put(SERVER_KEY_SEED_KEY, fromHex(seedHex));
    await instance.identity.load();
    return new TextDecoder().decode(instance.identity.document(issuedAtS));
  });

describe("the document the kernel builds in the tenant's object", () => {
  it("is C0's known answer, byte for byte, for a slug host and for a custom domain", async () => {
    const main = C0.servers["main.work.avarok.net"];
    const mainDoc = fixture("valid-hosted-tenant.json");
    const mainOut = await issued(freshSlug("kat"), { canonical_domain: mainDoc.canonical_domain, former_domains: mainDoc.former_domains }, main.key.seed_hex, mainDoc.issued_at);
    expect(JSON.parse(mainOut)).toEqual(mainDoc);

    // The custom-domain answer is what attaching acme.example to the tenant `acme` produces.
    const acme = C0.servers["acme.example"];
    const acmeDoc = fixture("valid-custom-domain.json");
    const next = attached(CFG, createdIdentity(CFG, "acme"), "acme.example");
    expect(next).toEqual({ ok: true, identity: { canonical_domain: acmeDoc.canonical_domain, former_domains: acmeDoc.former_domains } });
    const acmeOut = await issued(freshSlug("kat"), next.identity, acme.key.seed_hex, acmeDoc.issued_at);
    expect(JSON.parse(acmeOut)).toEqual(acmeDoc);
  });
});

describe("GET /.well-known/citadel on a tenant's host", () => {
  it("serves a C0 document naming the slug host, signed by the key the object was provisioned with", async () => {
    const { slug, object } = await freeTenant("wk");
    const host = `${slug}.${CFG.controlHost}`;
    const r = await wellKnownAt(host);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/json");
    const doc = await r.json();
    expect(doc).toMatchObject({ canonical_domain: host, former_domains: [], citadel: { wss: `wss://${host}/citadel` } });
    expectSignedBy(doc, await storedSeed(object));
  });

  it("is issued once per instance: a second fetch gets the same bytes", async () => {
    const { slug } = await freeTenant("wk");
    const host = `${slug}.${CFG.controlHost}`;
    const first = await (await wellKnownAt(host)).text();
    await new Promise((r) => setTimeout(r, 1100));
    expect(await (await wellKnownAt(host)).text()).toBe(first);
  });

  it("is the key the object provisioned once: provisioning the same tenant again keeps it, a new tenant gets its own", async () => {
    const { object } = await freeTenant("wk");
    const first = toHex(await storedSeed(object));
    const [again, other] = await runInDurableObject(object, async (instance) => {
      const { started: _s, ...record } = await instance.ctx.storage.get("control:provisioning");
      await instance.provision(record);
      const kept = toHex(await instance.ctx.storage.get(SERVER_KEY_SEED_KEY));
      await instance.provision({ ...record, tenant_id: `${record.tenant_id}-next` });
      return [kept, toHex(await instance.ctx.storage.get(SERVER_KEY_SEED_KEY))];
    });
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("answers 404 and logs, never a document under a default key, for a workspace with no server key", async () => {
    const { slug, object } = await freeTenant("wk");
    // An object provisioned before server identities: no seed in its storage.
    await runInDurableObject(object, async (instance) => {
      await instance.ctx.storage.delete(SERVER_KEY_SEED_KEY);
      await instance.identity.load();
    });
    const logged = vi.spyOn(console, "error");
    const r = await wellKnownAt(`${slug}.${CFG.controlHost}`);
    expect(r.status).toBe(404);
    expect(await r.json()).toMatchObject({ error: "not-found" });
    expect(logged.mock.calls.some(([line]) => /well-known\/citadel: this workspace has no server key/.test(line))).toBe(true);
    // Reading never makes one, and the node will not start without it.
    expect(await storedSeed(object)).toBeUndefined();
    const start = await runInDurableObject(object, (instance) => {
      try {
        instance.identity.host();
        return "started";
      } catch (e) {
        return e.message;
      }
    });
    expect(start).toMatch(/no server key/);
  });

  it("is 404 for a slug nobody holds, as every tenant path is", async () => {
    expect((await wellKnownAt(`${freshSlug("none")}.${CFG.controlHost}`)).status).toBe(404);
  });
});

describe("the kernel.toml's [identity]", () => {
  it("names the slug host, no former domain, well_known discovery, and never a key file", async () => {
    const { slug, object } = await freeTenant("wk");
    const text = await runInDurableObject(object, (instance) => instance.provisioning.kernelConfig());
    const lines = text.split("\n");
    const at = lines.indexOf("[identity]");
    expect(at).toBeGreaterThan(-1);
    expect(lines.slice(at + 1, at + 5)).toEqual([
      `canonical_domain = "${slug}.${CFG.controlHost}"`,
      "former_domains = []",
      `discovery = "well_known"`,
      `citadel_wss = "wss://${slug}.${CFG.controlHost}/citadel"`,
    ]);
    expect(text).not.toMatch(/server_key_file|well_known_file/);
  });

  it("is refused, rather than defaulted, for a record provisioned without domains", async () => {
    const { object } = await freeTenant("wk");
    const refusals = await runInDurableObject(object, async (instance) => {
      const record = await instance.ctx.storage.get("control:provisioning");
      const out = [];
      for (const identity of [undefined, { canonical_domain: "x.example" }]) {
        try {
          await instance.provisioning.provision({ ...record, identity }, false);
          out.push(null);
        } catch (e) {
          out.push(e.message);
        }
      }
      instance.provisioning.record = { ...record, identity: undefined };
      try {
        instance.provisioning.kernelConfig();
        out.push(null);
      } catch (e) {
        out.push(e.message);
      }
      instance.provisioning.record = record;
      return out;
    });
    expect(refusals[0]).toMatch(/identity\.canonical_domain/);
    expect(refusals[1]).toMatch(/identity\.former_domains/);
    expect(refusals[2]).toMatch(/provisioned before server identities/);
  });
});
