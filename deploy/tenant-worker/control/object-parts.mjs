/**
 * The tenant object's parts that act on its plan and meter (worker.mjs's constructor): each
 * dimension's billing state, relay credentials, the purges on its alarm, and document appends.
 * `object` is the WorkspaceServer; `roll(nowMs)` moves its meter onto the current period and
 * `running()` starts its node -- both private to it, so passed in.
 */
import { IceMinter } from "./ice.mjs";
import { turnConfig } from "./http.mjs";
import { SupportStore } from "./support-store.mjs";
import { currentOf, TenantBilling } from "./tenant-billing.mjs";
import { TenantDocuments } from "./tenant-documents.mjs";
import { TenantLinks } from "./tenant-links.mjs";
import { TenantTelemetry } from "./tenant-telemetry.mjs";

export function objectParts(object, ctx, env, { roll, running }) {
  // Each dimension's billing state this period (control/tenant-billing.mjs), and relay credentials
  // for the kernel's GetIceServers (control/ice.mjs), gated on the plan, the meter and that state.
  const billing = new TenantBilling(ctx.storage, { nowMs: Date.now }, () => currentOf(object, roll));
  const ice = new IceMinter(turnConfig(env), { fetch: (url, init) => fetch(url, init), nowMs: Date.now }, () => billing.iceTenant());
  // The purge alarm, support reads and the grant mirror (control/tenant-telemetry.mjs).
  const telemetry = new TenantTelemetry(ctx.storage, {
    server: running, tenantId: () => object.provisioning.tenantId(), grants: new SupportStore(env.CONTROL_DB),
    nowMs: Date.now, wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  });
  // The secure-links purge (control/tenant-links.mjs), on the same alarm; telemetry's then links'.
  const links = new TenantLinks(ctx.storage, { ready: () => telemetry.ready() });
  // Document appends (control/tenant-documents.mjs), counted on this period's meter; refused once
  // the billing state has terminated them (control/termination.mjs).
  const documents = new TenantDocuments({ meter: () => object.meter, roll, writable: () => billing.documentsWritable(), nowMs: Date.now });
  return { billing, ice, telemetry, links, purges: [telemetry, links], documents };
}
