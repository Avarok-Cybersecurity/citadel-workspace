/**
 * The one-time upgrade of tenants provisioned before server identities (control/identity-upgrade.mjs):
 * a pre-I4 object -- no `[identity]` in its record, no server key seed -- is provisioned again
 * through its own provision(), once, and then starts and serves a document signed by that key.
 * Everything is the real Worker, its D1 and its objects; the suite's D1 holds every other test's
 * tenants too, so each run is narrowed to this test's slugs (`among`), the registry's own query
 * underneath.
 */
import { createScheduledController, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { IDENTITY_UPGRADE_RUN, upgradeIdentities } from "../control/identity-upgrade.mjs";
import { runScheduled } from "../control/scheduled.mjs";
import { attachCustomDomain } from "../control/tenant-domains.mjs";
import { SERVER_KEY_SEED_KEY } from "../control/tenant-identity.mjs";
import { freeTenant, freshSlug, openSocket, tenantRow } from "./helpers.mjs";
import { expectSignedBy, storedSeed, wellKnownAt } from "./identity-helpers.mjs";
import { toHex } from "./well-known-verify.mjs";

const CFG = config(env);
const PROVISIONING_KEY = "control:provisioning";

/** The control plane's I/O with the registry's pending rows narrowed to `slugs`. */
function among(slugs) {
  const io = ioFor(env);
  const pending = async (after, limit) => {
    const rows = await io.store.identityPending(after, limit);
    const mine = rows.filter((r) => slugs.includes(r.slug));
    // A page of other tests' rows only: page on past them rather than end the run early.
    return mine.length > 0 || rows.length === 0 ? mine : pending(rows.at(-1).slug, limit);
  };
  return { ...io, store: Object.assign(Object.create(io.store), { identityPending: pending }) };
}

const upgrade = (slugs, run = IDENTITY_UPGRADE_RUN) => upgradeIdentities(among(slugs), CFG, run);

/**
 * A tenant as a build before server identities left it: created, then its object's record
 * stripped of `identity` and its seed deleted, and its registry row at version 0.
 */
async function preIdentityTenant(stem) {
  const { slug, object } = await freeTenant(stem);
  await runInDurableObject(object, async (instance, state) => {
    const { identity: _identity, ...record } = await state.storage.get(PROVISIONING_KEY);
    await state.storage.put(PROVISIONING_KEY, record);
    await state.storage.delete(SERVER_KEY_SEED_KEY);
    await instance.provisioning.load();
    await instance.identity.load();
  });
  await env.CONTROL_DB.prepare("UPDATE tenants SET identity_version = 0 WHERE slug = ?").bind(slug).run();
  return { slug, object };
}

const recordOf = (object) => runInDurableObject(object, (_i, state) => state.storage.get(PROVISIONING_KEY));
const startRefusal = (object) =>
  runInDurableObject(object, (instance) => {
    try {
      instance.identity.host();
      return null;
    } catch (e) {
      return e.message;
    }
  });

describe("the identity upgrade", () => {
  it("brings a pre-identity tenant up once: it then starts and serves a document that verifies", async () => {
    const { slug, object } = await preIdentityTenant("up");
    const host = `${slug}.${CFG.controlHost}`;
    expect((await wellKnownAt(host)).status).toBe(404);
    expect(await startRefusal(object)).toMatch(/no server key/);
    await expect(openSocket(slug)).rejects.toThrow(/provisioned before server identities/);

    const logged = vi.spyOn(console, "log");
    const outcome = await upgrade([slug]);
    expect(outcome).toEqual({ upgraded: [slug], unchanged: [], failed: [], more: false });
    expect(logged.mock.calls.some(([line]) => line === `[identity-upgrade] ${slug}: provisioned as ${host} with its server key`)).toBe(true);
    expect((await tenantRow(slug)).identity_version).toBe(1);
    expect((await recordOf(object)).identity).toEqual({ canonical_domain: host, former_domains: [] });

    const r = await wellKnownAt(host);
    expect(r.status).toBe(200);
    expectSignedBy(await r.json(), await storedSeed(object));
    const { ws, refused } = await openSocket(slug);
    expect(refused).toBeUndefined();
    ws.close(1000, "done");
  });

  it("changes nothing a second time: the row is not visited again, and the object keeps its key", async () => {
    const { slug, object } = await preIdentityTenant("up");
    await upgrade([slug]);
    const key = toHex(await storedSeed(object));
    const record = await recordOf(object);

    expect(await upgrade([slug])).toEqual({ upgraded: [], unchanged: [], failed: [], more: false });
    // Even a registry that forgot it had been there finds nothing to do.
    await env.CONTROL_DB.prepare("UPDATE tenants SET identity_version = 0 WHERE slug = ?").bind(slug).run();
    expect(await upgrade([slug])).toMatchObject({ upgraded: [], unchanged: [slug] });
    expect(toHex(await storedSeed(object))).toBe(key);
    expect(await recordOf(object)).toEqual(record);
  });

  it("leaves a tenant created with its identity untouched, a custom domain attached since included", async () => {
    const { slug, object } = await freeTenant("up");
    expect((await tenantRow(slug)).identity_version).toBe(1);
    expect((await attachCustomDomain(ioFor(env), CFG, slug, `${slug}.example`)).ok).toBe(true);
    const key = toHex(await storedSeed(object));
    const record = await recordOf(object);

    expect(await upgrade([slug])).toEqual({ upgraded: [], unchanged: [], failed: [], more: false });
    await env.CONTROL_DB.prepare("UPDATE tenants SET identity_version = 0 WHERE slug = ?").bind(slug).run();
    expect(await upgrade([slug])).toMatchObject({ upgraded: [], unchanged: [slug] });
    expect(toHex(await storedSeed(object))).toBe(key);
    expect(await recordOf(object)).toEqual(record);
    expect(record.identity.canonical_domain).toBe(`${slug}.example`);
  });

  it("keeps a custom domain attached before the upgrade, and gives the tenant its key", async () => {
    const { slug, object } = await preIdentityTenant("up");
    const custom = `${slug}.example`;
    expect((await attachCustomDomain(ioFor(env), CFG, slug, custom)).ok).toBe(true);
    expect(await upgrade([slug])).toMatchObject({ upgraded: [slug], failed: [] });
    expect((await recordOf(object)).identity).toEqual({ canonical_domain: custom, former_domains: [`${slug}.${CFG.controlHost}`] });
    const r = await wellKnownAt(custom);
    expect(r.status).toBe(200);
    expectSignedBy(await r.json(), await storedSeed(object));
  });

  it("reports a tenant that fails, leaves it for the next run, and upgrades the others", async () => {
    // Slugs in this order, so the failure comes first: an active row whose object was never provisioned.
    const stem = freshSlug("ord");
    const broken = `${stem}-a`;
    await env.CONTROL_DB.prepare(
      "INSERT INTO tenants (slug, tenant_id, display_name, status, tier, interval, seats, storage_blocks, created_at, expires_at, claim_hash) " +
        "VALUES (?, ?, 'x', 'active', 'free', NULL, 1, 0, ?, NULL, 'h')",
    ).bind(broken, crypto.randomUUID().replaceAll("-", ""), Math.floor(Date.now() / 1000)).run();
    const fine = [await preIdentityTenant(`${stem}-b`), await preIdentityTenant(`${stem}-c`)];
    const slugs = [broken, ...fine.map((t) => t.slug)];

    const logged = vi.spyOn(console, "error");
    const outcome = await upgrade(slugs, { pageSize: 1, maxTenants: 10 });
    expect(outcome.upgraded).toEqual(fine.map((t) => t.slug));
    expect(outcome.failed).toEqual([{ slug: broken, reason: expect.stringMatching(/never provisioned/) }]);
    expect(logged.mock.calls.some(([line]) => line.startsWith(`[identity-upgrade] ${broken}: FAILED`))).toBe(true);
    expect((await tenantRow(broken)).identity_version).toBe(0);
    for (const t of fine) expect((await wellKnownAt(`${t.slug}.${CFG.controlHost}`)).status).toBe(200);

    // The Cron trigger's run fails naming it, and tries it again.
    await expect(runScheduled(among(slugs), CFG)).rejects.toThrow(new RegExp(`identity upgrade: 1 tenant\\(s\\) failed: ${broken}: `));
    expect((await tenantRow(broken)).identity_version).toBe(0);
  });

  it("is bounded per run and resumes where the last one stopped", async () => {
    const stem = freshSlug("bnd");
    const tenants = [await preIdentityTenant(`${stem}-a`), await preIdentityTenant(`${stem}-b`), await preIdentityTenant(`${stem}-c`)];
    const slugs = tenants.map((t) => t.slug);
    expect(await upgrade(slugs, { pageSize: 1, maxTenants: 2 })).toEqual({ upgraded: slugs.slice(0, 2), unchanged: [], failed: [], more: true });
    expect(await startRefusal(tenants[2].object)).toMatch(/no server key/);
    expect(await upgrade(slugs, { pageSize: 1, maxTenants: 2 })).toEqual({ upgraded: slugs.slice(2), unchanged: [], failed: [], more: false });
    expect(await startRefusal(tenants[2].object)).toBeNull();
  });

  it("refuses a run with no stated bounds rather than assuming any", async () => {
    await expect(upgradeIdentities(among([]), CFG, {})).rejects.toThrow(/pageSize and maxTenants/);
  });

  it("never touches an object the registry row does not describe", async () => {
    const { slug, object } = await preIdentityTenant("up");
    await env.CONTROL_DB.prepare("UPDATE tenants SET tenant_id = ? WHERE slug = ?").bind(crypto.randomUUID().replaceAll("-", ""), slug).run();
    const outcome = await upgrade([slug]);
    expect(outcome.failed).toEqual([{ slug, reason: expect.stringMatching(/another tenant/) }]);
    expect(await storedSeed(object)).toBeUndefined();
  });
});

describe("the Worker's Cron trigger", () => {
  it("runs the identity upgrade", async () => {
    const { slug, object } = await preIdentityTenant("cron");
    const worker = (await import("../worker.mjs")).default;
    // Other tests' rows are in this D1 too; whatever they do, this tenant is upgraded and not among the failures.
    const failure = await worker.scheduled(createScheduledController({ cron: "*/15 * * * *", scheduledTime: Date.now() }), env).catch((e) => e);
    expect(String(failure?.message ?? "")).not.toContain(slug);
    expect((await tenantRow(slug)).identity_version).toBe(1);
    expect(await startRefusal(object)).toBeNull();
  });
});
