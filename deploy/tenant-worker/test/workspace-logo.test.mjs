/**
 * The icon chosen at /create reaches the tenant's kernel config, and only a small raster image is
 * accepted.
 *
 * Owner, 2026-09-27: "ideally, during the setup phase that creates a workspace, the user can
 * provide an icon for the workspace". The icon travels in the create request as `logo`, is
 * checked here by the same rules the kernel applies to UpdateWorkspaceProfile (WebP, PNG or JPEG,
 * at most 32 KB decoded, bytes matching the declared type), is provisioned with the tenant, and
 * is written into the node's kernel.toml as `workspace_logo`. The kernel seeds it into the root
 * workspace's metadata; that half is tested in the kernel (a_created_workspace_keeps_its_icon.rs).
 *
 * Through the real Worker and the real tenant object.
 */
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createBody, freshSlug, objectStats, outbound, post, tenantObject } from "./helpers.mjs";

const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
const png = (length) => {
  const bytes = new Uint8Array(length);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return `data:image/png;base64,${b64(bytes)}`;
};

async function create(stem, extra) {
  const slug = freshSlug(stem);
  outbound();
  const r = await post("/api/tenants", createBody(slug, extra));
  vi.restoreAllMocks();
  return { slug, r };
}

const kernelConfig = (slug) => runInDurableObject(tenantObject(slug), (instance) => instance.provisioning.kernelConfig());

describe("the icon chosen at /create", () => {
  it("is provisioned with the tenant and named in the kernel config", async () => {
    const logo = png(4096);
    const { slug, r } = await create("wl", { logo });
    expect(r.status).toBe(201);
    expect((await objectStats(slug)).logo_bytes).toBe(logo.length);
    expect((await kernelConfig(slug)).split("\n")).toContain(`workspace_logo = ${JSON.stringify(logo)}`);
  });

  it("is optional: a workspace created without one has no icon line", async () => {
    const { slug, r } = await create("wn", {});
    expect(r.status).toBe(201);
    expect(await kernelConfig(slug)).not.toContain("workspace_logo");
  });

  it("is accepted at the size limit, which the create route's body limit makes room for", async () => {
    const { r } = await create("wm", { logo: png(32 * 1024) });
    expect(r.status).toBe(201);
  });

  it("is refused unless it is a small raster image of the type it claims", async () => {
    const refused = [
      `data:image/svg+xml;base64,${btoa('<svg onload="alert(1)"/>')}`,
      png(32 * 1024 + 1),
      `data:image/png;base64,${btoa("<html>not a png</html>")}`,
      "https://example.com/logo.png",
      42,
    ];
    for (const logo of refused) {
      const { r } = await create("wx", { logo });
      expect(r.status, String(logo).slice(0, 30)).toBe(400);
      expect((await r.json()).error).toBe("malformed-request");
    }
  });
});
