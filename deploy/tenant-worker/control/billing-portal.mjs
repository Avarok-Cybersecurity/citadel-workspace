/**
 * Opening a tenant's Stripe billing portal: the one place it is done, for both ways in.
 *
 *   - the claim code, over the control plane (tenants.mjs `openPortal`): someone not signed in
 *     proves ownership with the code the workspace was created with;
 *   - a member's session (tenantPortal below, which the tenant's object calls through the kernel's
 *     `OpenBillingPortal`): the kernel has admitted the session's own account, holding
 *     EditWorkspaceConfig, before the object is asked.
 *
 * The two differ only in how the caller was authorized; the row's subscription, the portal
 * configuration and the Stripe call are this module's.
 */
import { stripe } from "./stripe.mjs";

/** Each refusal: its HTTP status and detail on the control plane. The code is the wire's. */
export const PORTAL_REFUSALS = Object.freeze({
  "billing-not-configured": { status: 503, detail: "billing is not available yet" },
  "no-subscription": { status: 404, detail: "this workspace has no subscription to manage" },
  "portal-not-configured": { status: 503, detail: "managing a subscription is not available yet" },
});

/**
 * `{portal_url}` for `row`'s subscription, or `{refused}` naming a PORTAL_REFUSALS code. Throws
 * when Stripe does (StripeError). The portal returns to the control plane's own origin.
 */
export async function portalFor(io, cfg, row) {
  if (!cfg.stripeKey) return { refused: "billing-not-configured" };
  if (!row.stripe_customer) return { refused: "no-subscription" };
  if (!cfg.portalConfiguration) return { refused: "portal-not-configured" };
  const session = await stripe(io, cfg.stripeKey, "POST", "/billing_portal/sessions", {
    customer: row.stripe_customer,
    // Never the account's default portal: it belongs to another product on the same account.
    configuration: cfg.portalConfiguration,
    return_url: `${cfg.publicOrigin}/`,
  });
  return { portal_url: session.url };
}

/**
 * The session path: the portal of the tenant whose object asks, found by the object's OWN
 * tenant id (`tenantId`, what the control plane provisioned it with), never by anything the
 * request carried. Throws when no registry row holds that id, which the kernel reports as
 * unavailable: an object whose row is gone has no subscription anyone should reach.
 */
export async function tenantPortal(io, cfg, tenantId) {
  if (typeof tenantId !== "string" || tenantId.length === 0) throw new Error("this object has no tenant id");
  const row = await io.store.byTenantId(tenantId);
  if (!row) throw new Error("no registry row holds this object's tenant");
  return portalFor(io, cfg, row);
}
