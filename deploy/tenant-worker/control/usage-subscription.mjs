/**
 * The usage-only subscription a yearly paid tenant needs for its relay overage to be billed.
 *
 * A Stripe subscription bills all its items on one interval, and the overage price is monthly, so
 * a yearly plan cannot carry it. Instead a second subscription holds only the metered price; it
 * has no fixed amount, so its monthly invoice is zero unless there was overage. The meter events
 * the monitor sends are per customer, so this subscription is what makes them billable.
 *
 * Reconciled on every webhook event that changes a tenant, and applied in the same D1 batch as
 * the event (webhook.mjs), so a Stripe failure answers 500, nothing is recorded, and Stripe's
 * retry repeats the call under the same idempotency key: never a duplicate subscription.
 */
import { needsUsageSubscription, overageKey } from "./plans.mjs";
import { priceIds, stripe, StripeError } from "./stripe.mjs";

/**
 * The `usage_subscription` field the tenant should end with after `after` (its row once the
 * event's change is applied): unchanged when nothing is to be done, else the new id or null.
 * `cancelled` names a usage subscription Stripe just reported deleted (the customer cancelled it
 * in the portal): it is replaced at once, so overage cannot be left unbilled by cancelling it.
 */
export async function reconcileUsageSubscription(io, cfg, after, { cancelled = null } = {}) {
  const held = after.usage_subscription === cancelled ? null : after.usage_subscription ?? null;
  const wanted = after.status === "active" && needsUsageSubscription(after.tier, after.interval) && Boolean(after.stripe_customer);
  if (wanted && !held) return { usage_subscription: await create(io, cfg, after, cancelled) };
  if (!wanted && held) {
    await cancel(io, cfg, held);
    return { usage_subscription: null };
  }
  return held === (after.usage_subscription ?? null) ? {} : { usage_subscription: held };
}

async function create(io, cfg, row, replacing) {
  if (!cfg.stripeKey) throw new Error("STRIPE_SECRET_KEY is not set: the usage subscription cannot be created");
  const ids = await priceIds(io, cfg.stripeKey, [overageKey()]);
  const sub = await stripe(io, cfg.stripeKey, "POST", "/subscriptions", {
    customer: row.stripe_customer,
    "items[0][price]": ids.get(overageKey()),
    "metadata[tenant]": row.slug,
    "metadata[tenant_id]": row.tenant_id,
    "metadata[kind]": "usage",
  }, `usage-sub-${row.tenant_id}${replacing ? `-after-${replacing}` : ""}`);
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
