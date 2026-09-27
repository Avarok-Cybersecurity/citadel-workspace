/**
 * The name a workspace is created with reaches its kernel. It used to stop at D1: /create stored
 * `display_name` and never provisioned it, the object's kernel config had no name, and every
 * hosted workspace was seeded as "Root Workspace" -- indistinguishable in the workspace switcher.
 *
 * Through the real Worker and the real tenant object with its wasm server. The seeded name is read
 * back from the node's own SQLite rows, so what is checked is what the kernel wrote.
 */
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createBody, freshSlug, objectStats, openSocket, outbound, post, tenantObject, until } from "./helpers.mjs";

const PROVISIONING_KEY = "control:provisioning";

async function namedTenant(stem, display_name) {
  const slug = freshSlug(stem);
  outbound();
  const r = await post("/api/tenants", createBody(slug, { display_name }));
  expect(r.status).toBe(201);
  vi.restoreAllMocks();
  return { slug, object: tenantObject(slug) };
}

const kernelConfig = (object) => runInDurableObject(object, (instance) => instance.provisioning.kernelConfig());

/**
 * Whether any of the node's stored records is named `name`. The kernel stores records as compact
 * serde_json, so a record named `name` holds the bytes `"name":<name as a JSON string>`.
 */
const nodeStored = (object, name) =>
  runInDurableObject(object, (_instance, state) => {
    const sql = state.storage.sql;
    const needle = new TextEncoder().encode(`"name":${JSON.stringify(name)}`);
    const tables = [...sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'citadel_%'")].map((r) => r.name);
    for (const t of tables) {
      if ([...sql.exec(`SELECT name FROM pragma_table_info('${t}') WHERE name = 'bin'`)].length === 0) continue;
      for (const { bin } of sql.exec(`SELECT bin FROM ${t} WHERE bin IS NOT NULL`)) {
        const hay = new Uint8Array(bin);
        outer: for (let i = 0; i + needle.length <= hay.length; i++) {
          for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
          return true;
        }
      }
    }
    return false;
  });

async function startNode(slug) {
  const s = await openSocket(slug);
  expect(s.ws).toBeTruthy();
  return s;
}

describe("the workspace's name", () => {
  it("is provisioned with the tenant, trimmed, and named in the kernel config", async () => {
    const { slug, object } = await namedTenant("wn", "  Admin Lab  ");
    expect((await objectStats(slug)).display_name).toBe("Admin Lab");
    expect((await kernelConfig(object)).split("\n")).toContain('workspace_name = "Admin Lab"');
  });

  it("is what the node seeds the root workspace with", async () => {
    const name = `Lab ${crypto.randomUUID().slice(0, 8)}`;
    const { slug, object } = await namedTenant("ws", name);
    const s = await startNode(slug);
    await until("the root workspace to be seeded", () => nodeStored(object, name), 30000);
    expect(await nodeStored(object, "Root Workspace")).toBe(false);
    const stats = await objectStats(slug);
    expect(stats.exit).toBeNull();
    s.ws.close(1000, "done");
  });

  it("is quoted for TOML, so a name with quotes and backslashes cannot break the config", async () => {
    const name = 'Ops "Blue" \\ Team';
    const { slug, object } = await namedTenant("wq", name);
    const s = await startNode(slug);
    await until("the root workspace to be seeded", () => nodeStored(object, name), 30000);
    expect((await objectStats(slug)).exit).toBeNull();
    s.ws.close(1000, "done");
  });

  // "An object provisioned before names were passed still starts, under the default name" was
  // superseded by adoption below: routing any request to such an object now hands it its D1 name.
  // That a kernel with no name configured starts exactly as before is the kernel's own None test
  // (the_root_workspace_takes_the_configured_name.rs).

  it("an object provisioned before names were passed adopts its D1 name when it is next reached", async () => {
    // admin-lab and bench were provisioned before this: their objects hold no name, so their
    // kernels keep "Root Workspace". Routing a connection to the object hands it the name D1
    // has held all along; the kernel renames a still-default root on its next start.
    const { slug, object } = await namedTenant("wa", "Admin Lab");
    await runInDurableObject(object, async (instance, state) => {
      const { display_name: _dropped, ...old } = await state.storage.get(PROVISIONING_KEY);
      await state.storage.put(PROVISIONING_KEY, old);
      await instance.provisioning.load();
    });
    // Read inside the object: any routed request, objectStats included, already adopts.
    expect(await runInDurableObject(object, (i) => i.provisioning.displayName())).toBeNull();
    const s = await startNode(slug);
    expect((await objectStats(slug)).display_name).toBe("Admin Lab");
    expect((await kernelConfig(object)).split("\n")).toContain('workspace_name = "Admin Lab"');
    s.ws.close(1000, "done");
    // Adoption never overwrites a name the object already holds.
    expect(await runInDurableObject(object, (i) => i.provisioning.adoptDisplayName("Something Else"))).toBe(false);
    expect((await objectStats(slug)).display_name).toBe("Admin Lab");
  });

  it("a name the kernel would refuse is refused at creation and at provisioning", async () => {
    const { calls } = outbound();
    for (const display_name of ["", "   ", "tab\there", "next\u0085line", "x".repeat(65), "lone \ud800 surrogate"]) {
      expect((await post("/api/tenants", createBody(freshSlug("wb"), { display_name }))).status).toBe(400);
    }
    expect(calls).toHaveLength(0);
    vi.restoreAllMocks();

    const { object } = await namedTenant("wp", "Fine");
    const { tenant_id, master_password, entitlements } = await runInDurableObject(object, (i) => i.provisioning.record);
    // In the object, so the refusal is caught where it is thrown rather than crossing the RPC.
    const refusals = await runInDurableObject(object, async (instance) => {
      const refused = [];
      for (const display_name of ["a\u0085b", undefined]) {
        try {
          await instance.provisioning.provision({ tenant_id, master_password, entitlements, display_name }, false);
          refused.push(null);
        } catch (e) {
          refused.push(e.message);
        }
      }
      return refused;
    });
    expect(refusals).toEqual([expect.stringMatching(/display_name/), expect.stringMatching(/display_name/)]);
    expect(await runInDurableObject(object, (i) => i.provisioning.displayName())).toBe("Fine");
  });
});
