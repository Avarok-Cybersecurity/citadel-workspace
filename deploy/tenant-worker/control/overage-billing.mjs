/**
 * `POST /api/tenants/<slug>/overage` `{claim_code, enabled}`: the owner switches overage billing
 * (billing/policy.json overage_billing, G1). The claim code is the proof, exactly as the billing
 * portal checks it (owner.mjs). Free is always off. In order: the usage-only subscription is
 * reconciled (created when switched on, cancelled when off), the object is given its new
 * entitlements, and only then is the registry written -- so a failure at Stripe or the object
 * records nothing, and a retry repeats the Stripe call under the same idempotency key.
 */
import { entitlements, isPaid } from "./plans.mjs";
import { reconcileUsageSubscription } from "./usage-subscription.mjs";
import { json, refuse } from "./http.mjs";
import { ownedRow } from "./owner.mjs";

const FIELDS = new Set(["claim_code", "enabled"]);

export async function setOverageBilling(io, cfg, slug, body) {
  if (!cfg.stripeKey) return refuse("billing-not-configured", "billing is not available yet", 503);
  const extra = Object.keys(body).filter((k) => !FIELDS.has(k));
  if (extra.length) return refuse("malformed-request", `unknown fields: ${extra.join(", ")}`, 400);
  if (typeof body.enabled !== "boolean") return refuse("malformed-request", "enabled is required: true or false", 400);
  const owned = await ownedRow(io, slug, body);
  if (owned.error) return owned.error;
  const { row } = owned;
  if (!isPaid(row.tier)) return refuse("free-plan", "the free plan has no overage billing: it has no payment method", 409);
  const after = { ...row, overage_billing: body.enabled ? 1 : 0 };
  const fields = { overage_billing: body.enabled, ...(await reconcileUsageSubscription(io, cfg, after)) };
  await io.tenant(slug).setEntitlements(entitlements({ ...after, ...fields }));
  if (!(await io.store.setOverageBilling(slug, row.tenant_id, fields))) {
    throw new Error(`${slug} changed hands while its overage billing was being switched`);
  }
  return json({ overage_billing: body.enabled });
}
