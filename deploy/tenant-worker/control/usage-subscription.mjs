/**
 * The usage-only subscription every paid tenant with overage billing on holds: ALL overage bills
 * through it, whatever the plan's interval (billing/policy.json overage_billing). It carries every
 * metered price in tiers.json (relay overage, document appends) and no fixed amount, so its
 * monthly invoice is zero unless there was overage. The meter events the monitor sends are per
 * customer; this subscription is what makes them billable. The plan's own Checkout carries no
 * metered item.
 *
 * Reconciled on every webhook event that changes a tenant (applied in the same D1 batch as the
 * event, webhook.mjs) and when the owner switches overage billing (overage-billing.mjs), so a
 * Stripe failure answers 500, nothing is recorded, and the retry repeats the call under the same
 * idempotency key: never a duplicate subscription.
 */
import { METERED, WANTED_PRICES } from "./plans.mjs";
import { ensurePrices } from "./price-sync.mjs";
import { stripe, StripeError } from "./stripe.mjs";

/** Whether `row` should hold the usage subscription: active, overage billing on, a paid tier, a customer. */
export const wantsUsageSubscription = (row) =>
  row.status === "active" && (row.overage_billing === 1 || row.overage_billing === true) &&
  METERED.some((m) => m.offeredOn(row.tier)) && Boolean(row.stripe_customer);

/**
 * The fields the tenant should end with after `after` (its row once the change is applied):
 * nothing when nothing is to be done, else the new `usage_subscription` (and, on a cancellation,
 * `usage_subscription_ended`). `cancelled` names a usage subscription Stripe just reported
 * deleted (the customer cancelled it in the portal): it is replaced at once, so overage cannot be
 * left unbilled by cancelling it.
 */
export async function reconcileUsageSubscription(io, cfg, after, { cancelled = null } = {}) {
  const held = after.usage_subscription === cancelled ? null : after.usage_subscription ?? null;
  const wanted = wantsUsageSubscription(after);
  if (wanted && !held) {
    const replacing = cancelled ?? after.usage_subscription_ended ?? null;
    return { usage_subscription: await create(io, cfg, after, replacing) };
  }
  if (!wanted && held) {
    await cancel(io, cfg, held);
    return { usage_subscription: null, usage_subscription_ended: held };
  }
  return held === (after.usage_subscription ?? null) ? {} : { usage_subscription: held };
}

async function create(io, cfg, row, replacing) {
  if (!cfg.stripeKey) throw new Error("STRIPE_SECRET_KEY is not set: the usage subscription cannot be created");
  const metered = METERED.filter((m) => m.offeredOn(row.tier));
  const ids = await ensurePrices(io, cfg.stripeKey, metered.map((m) => m.key), WANTED_PRICES);
  const form = {
    customer: row.stripe_customer,
    ...Object.fromEntries(metered.map((m, i) => [`items[${i}][price]`, ids.get(m.key)])),
    "metadata[tenant]": row.slug,
    "metadata[tenant_id]": row.tenant_id,
    "metadata[kind]": "usage",
    ...(cfg.stripeTax ? { "automatic_tax[enabled]": "true" } : {}),
  };
  const sub = await stripe(io, cfg.stripeKey, "POST", "/subscriptions", form, `usage-sub-${row.tenant_id}${replacing ? `-after-${replacing}` : ""}`);
  if (typeof sub?.id !== "string") throw new Error("Stripe created a usage subscription without an id");
  return sub.id;
}

async function cancel(io, cfg, id) {
  if (!cfg.stripeKey) throw new Error("STRIPE_SECRET_KEY is not set: the usage subscription cannot be cancelled");
  try {
    await stripe(io, cfg.stripeKey, "DELETE", `/subscriptions/${encodeURIComponent(id)}`, {});
  } catch (e) {
    // Already gone is the outcome wanted; anything else is retried with the event.
    if (!(e instanceof StripeError) || e.status !== 404) throw e;
  }
}
