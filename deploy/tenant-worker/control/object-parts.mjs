/**
 * The tenant object's parts that act on its plan and meter (worker.mjs's constructor): relay
 * credentials, the purges on its alarm, and document appends. `object` is the WorkspaceServer;
 * `roll(nowMs)` moves its meter onto the current period and `running()` starts its node -- both
 * private to it, so passed in.
 */
import { turnConfig } from "./http.mjs";
import { IceMinter } from "./ice.mjs";
import { enforcedEntitlements } from "./plans.mjs";
import { SupportStore } from "./support-store.mjs";
import { TenantDocuments } from "./tenant-documents.mjs";
import { TenantLinks } from "./tenant-links.mjs";
import { TenantTelemetry } from "./tenant-telemetry.mjs";

export function objectParts(object, ctx, env, { roll, running }) {
  // Relay credentials for the kernel's GetIceServers (control/ice.mjs), gated on this tenant's
  // plan and this period's metered relay.
  const ice = new IceMinter(turnConfig(env), { fetch: (url, init) => fetch(url, init), nowMs: Date.now }, () => {
    const now = Date.now();
    roll(now);
    return { limits: enforcedEntitlements(object.provisioning.summary().entitlements), bytesIn: object.meter.snapshot(now).bytes_in };
  });
  // The purge alarm, support reads and the grant mirror (control/tenant-telemetry.mjs).
  const telemetry = new TenantTelemetry(ctx.storage, {
    server: running, tenantId: () => object.provisioning.tenantId(), grants: new SupportStore(env.CONTROL_DB),
    nowMs: Date.now, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  // The secure-links purge (control/tenant-links.mjs), on the same alarm; telemetry's then links'.
  const links = new TenantLinks(ctx.storage, { ready: () => telemetry.ready() });
  // Document appends (control/tenant-documents.mjs), counted on this period's meter.
  const documents = new TenantDocuments({ meter: () => object.meter, roll, writable: () => object.documentsWritable(), nowMs: Date.now });
  return { ice, telemetry, links, purges: [telemetry, links], documents };
}
