/**
 * Cloudflare refuses (API code 10061) a deploy that deletes a Durable Object class while keeping a
 * binding name the live Worker binds to that class (do-binding-rule.mjs). deploy.sh asks the live
 * Worker; these hold wrangler.toml to the rule against the binding production had before the reset.
 */
import { describe, expect, it } from "vitest";
import { bindingReuseRefusals } from "../do-binding-rule.mjs";
import deployScript from "../deploy.sh?raw";
import { production } from "./helpers.mjs";

// citadel-tenant's Durable Object binding before the reset (CF API workers/scripts/citadel-tenant/
// settings, 2026-11-21).
const PRE_RESET_LIVE = [{ name: "WORKSPACE", class_name: "WorkspaceServer" }];

const MIGRATIONS = [
  { tag: "v1", new_sqlite_classes: ["WorkspaceServer"] },
  { tag: "v2", new_sqlite_classes: ["WorkspaceServerV2"], deleted_classes: ["WorkspaceServer"] },
];
const withBinding = (name) => ({ durable_objects: { bindings: [{ name, class_name: "WorkspaceServerV2" }] }, migrations: MIGRATIONS });

describe("deleting a Durable Object class", () => {
  it("wrangler.toml passes against production's pre-reset binding", () => {
    expect(bindingReuseRefusals(PRE_RESET_LIVE, production())).toEqual([]);
  });
  it("wrangler.toml's binding is not the deleted class's name", () => {
    const deleted = production().migrations.flatMap((m) => m.deleted_classes ?? []);
    expect(deleted).toContain("WorkspaceServer");
    expect(production().durable_objects.bindings.map((b) => b.name)).not.toContain("WORKSPACE");
  });
  // The control: the shape Cloudflare refused on 2026-11-22 (deploy run 44968283960).
  it("control: reusing the deleted class's binding name for the new class is refused", () => {
    const refusals = bindingReuseRefusals(PRE_RESET_LIVE, withBinding("WORKSPACE"));
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatch(/WORKSPACE .*WorkspaceServer/);
  });
  it("a new binding name for the new class is allowed", () => {
    expect(bindingReuseRefusals(PRE_RESET_LIVE, withBinding("WORKSPACE_V2"))).toEqual([]);
  });
  it("keeping a binding name is allowed when no class it is bound to is deleted", () => {
    expect(bindingReuseRefusals([{ name: "WORKSPACE", class_name: "WorkspaceServerV2" }], withBinding("WORKSPACE"))).toEqual([]);
  });
  it("deploy.sh checks the live Worker before its D1 migrations and its deploy", () => {
    const at = (needle) => deployScript.indexOf(needle);
    expect(at("/check-do-bindings.mjs\" ./wrangler.toml")).toBeGreaterThan(0);
    expect(at("/check-do-bindings.mjs\" ./wrangler.toml")).toBeLessThan(at("wr d1 migrations apply"));
  });
});
