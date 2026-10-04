/**
 * What a tenant's object holds for post-quantum sign-in (control/oprf-seed.mjs,
 * control/tenant-sign-in.mjs): its OPRF seed, generated once from the CSPRNG and kept apart from
 * the accounts, and the sign-in settings the node reads and writes through its host object. The
 * object, its storage and its wasm node are the real ones.
 */
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ensureOprfSeed, OPRF_SEED_BYTES, OPRF_SEED_KEY } from "../control/oprf-seed.mjs";
import { SIGN_IN_SETTINGS_KEY } from "../control/admission.mjs";
import { ksfParams } from "../control/tenant-sign-in.mjs";
import { freeTenant, objectStats, openSocket, production, until } from "./helpers.mjs";
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
const storedSeed = (object) => runInDurableObject(object, (instance) => instance.ctx.storage.get(OPRF_SEED_KEY));

describe("the OPRF seed", () => {
  it("is generated at provisioning: 32 random bytes in key-value storage, not in the account tables", async () => {
    const { object } = await freeTenant("seed");
    const seed = await storedSeed(object);
    expect(ArrayBuffer.isView(seed)).toBe(true);
    expect(seed.byteLength).toBe(OPRF_SEED_BYTES);
    expect(new Set(seed).size).toBeGreaterThan(8);
    const other = await storedSeed((await freeTenant("seed")).object);
    expect(hex(other)).not.toBe(hex(seed));
    const rows = await runInDurableObject(object, (instance) =>
      [...instance.ctx.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table'")].map((r) => r.name),
    );
    for (const table of rows) expect(table).not.toMatch(/seed|oprf/i);
  });

  it("is kept across loads, so an existing tenant gets one once and keeps it", async () => {
    const { object } = await freeTenant("seed");
    const first = hex(await storedSeed(object));
    const again = await runInDurableObject(object, async (instance) => {
      await instance.signIn.load();
      return hex(await ensureOprfSeed(instance.ctx.storage, crypto));
    });
    expect(again).toBe(first);
  });

  it("is generated on first boot for an object provisioned before seeds existed", async () => {
    const { object } = await freeTenant("seed");
    const fresh = await runInDurableObject(object, async (instance) => {
      await instance.ctx.storage.delete(OPRF_SEED_KEY);
      await instance.signIn.load();
      return instance.ctx.storage.get(OPRF_SEED_KEY);
    });
    expect(fresh.byteLength).toBe(OPRF_SEED_BYTES);
  });

  it("is refused, never replaced, when what is stored is not a seed", async () => {
    const { object } = await freeTenant("seed");
    const outcome = await runInDurableObject(object, async (instance) => {
      await instance.ctx.storage.put(OPRF_SEED_KEY, new Uint8Array(5));
      return instance.signIn.load().then(() => "loaded", (e) => e.message);
    });
    expect(outcome).toMatch(/not 32 bytes/);
    expect((await storedSeed(object)).byteLength).toBe(5);
  });

  it("is kept when its tenant is provisioned again, and replaced for a new tenant of a never-started object", async () => {
    const { object } = await freeTenant("seed");
    const first = hex(await storedSeed(object));
    const [again, other] = await runInDurableObject(object, async (instance) => {
      const record = await instance.ctx.storage.get("control:provisioning");
      const data = { tenant_id: record.tenant_id, master_password: record.master_password, entitlements: record.entitlements, display_name: "Acme" };
      await instance.provision(data);
      const kept = hex(await instance.ctx.storage.get(OPRF_SEED_KEY));
      await instance.provision({ ...data, tenant_id: `${record.tenant_id}-next` });
      return [kept, hex(await instance.ctx.storage.get(OPRF_SEED_KEY))];
    });
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it("never appears in the object's stats", async () => {
    const { slug, object } = await freeTenant("seed");
    const seed = hex(await storedSeed(object));
    const stats = JSON.stringify(await objectStats(slug));
    expect(stats).not.toContain(seed);
    expect(stats).not.toMatch(/oprf|seed/i);
  });

  it("starts the node with post-quantum sign-in, and the object keeps no copy once it has", async () => {
    const { slug, object } = await freeTenant("seed");
    const { ws } = await openSocket(slug);
    await until("the node running", async () => (await objectStats(slug)).running);
    const held = await runInDurableObject(object, (instance) => instance.signIn.seed);
    expect(held).toBeNull();
    ws.close();
  });
});

describe("the KSF parameters", () => {
  it("are read from the vars, and none may be missing or nonsense", () => {
    expect(ksfParams({ PQ_KSF_MEM_KIB: "19456", PQ_KSF_ITERATIONS: "2", PQ_KSF_LANES: "1" })).toEqual({ memKib: 19456, iterations: 2, lanes: 1 });
    expect(() => ksfParams({ PQ_KSF_ITERATIONS: "2", PQ_KSF_LANES: "1" })).toThrow(/PQ_KSF_MEM_KIB/);
    expect(() => ksfParams({ PQ_KSF_MEM_KIB: "19456", PQ_KSF_ITERATIONS: "0", PQ_KSF_LANES: "1" })).toThrow(/positive integer/);
  });

  it("as wrangler.toml deploys them, are ones the node accepts", () => {
    const ksf = ksfParams(production().vars);
    expect(() => new (instantiate(wasm).PqSignIn)(new Uint8Array(32), ksf.memKib, ksf.iterations, ksf.lanes)).not.toThrow();
  });

  it("below the SDK's floor, or with a seed of the wrong size, are refused by the node's own check", () => {
    const node = instantiate(wasm);
    expect(() => new node.PqSignIn(new Uint8Array(32), 1024, 1, 1)).toThrow(/floor/);
    expect(() => new node.PqSignIn(new Uint8Array(31), 19456, 2, 1)).toThrow(/32 bytes/);
    expect(() => new node.PqSignIn(new Uint8Array(32), 19456, 2, 1)).not.toThrow();
  });
});

describe("the sign-in settings host", () => {
  it("starts off, and a store through the host is what a load and the storage then hold", async () => {
    const { object } = await freeTenant("set");
    const answers = await runInDurableObject(object, async (instance) => {
      const host = instance.signIn.host();
      const before = await host.loadSettings();
      await host.storeSettings(JSON.stringify({ require_turnstile_sign_in: true }));
      return { before, after: await host.loadSettings(), stored: await instance.ctx.storage.get(SIGN_IN_SETTINGS_KEY) };
    });
    expect(JSON.parse(answers.before)).toEqual({ require_turnstile_sign_in: false });
    expect(JSON.parse(answers.after)).toEqual({ require_turnstile_sign_in: true });
    expect(answers.stored).toEqual({ require_turnstile_sign_in: true });
  });

  it("refuses to store anything that is not the settings, and keeps what it had", async () => {
    const { object } = await freeTenant("set");
    const outcome = await runInDurableObject(object, async (instance) => {
      const host = instance.signIn.host();
      const refused = await host.storeSettings(JSON.stringify({ require_turnstile_sign_in: "yes" })).then(() => null, (e) => e.message);
      return { refused, now: JSON.parse(await host.loadSettings()) };
    });
    expect(outcome.refused).toMatch(/require_turnstile_sign_in: boolean/);
    expect(outcome.now).toEqual({ require_turnstile_sign_in: false });
  });
});
