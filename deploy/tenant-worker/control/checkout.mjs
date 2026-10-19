/**
 * The Stripe Checkout a paid creation opens, and expiring one a retry supersedes. The plan's
 * Checkout carries the tier and the add-ons only: overage bills through the usage-only
 * subscription (usage-subscription.mjs), whatever the plan's interval.
 */
import { ADDONS, tierKey, WANTED_PRICES } from "./plans.mjs";
import { ensurePrices } from "./price-sync.mjs";
import { stripe, StripeError } from "./stripe.mjs";

/**
 * Stripe Tax on a Checkout (docs.stripe.com/tax/checkout): the tax from the billing address,
 * which is always collected. `customer_update[address]=auto` belongs to a Checkout given an
 * existing `customer` -- Stripe refuses it otherwise ("can only be provided when customer is
 * provided") -- and a creation's Checkout makes a new customer, so it is not sent.
 */
const checkoutTax = (cfg) => (cfg.stripeTax ? { "automatic_tax[enabled]": "true", billing_address_collection: "required" } : {});

export async function openCheckout(io, cfg, row, now) {
  const tierLookup = tierKey(row.tier, row.interval);
  const bought = ADDONS.filter((a) => row[a.quantityField] > 0);
  const keys = [tierLookup, ...bought.map((a) => a.priceKey(row.interval))];
  const ids = await ensurePrices(io, cfg.stripeKey, keys, WANTED_PRICES);
  const back = (path) => `${cfg.publicOrigin}${path}?tenant=${encodeURIComponent(row.slug)}`;
  const form = {
    mode: "subscription",
    client_reference_id: row.tenant_id,
    "line_items[0][price]": ids.get(tierLookup),
    "line_items[0][quantity]": String(row.seats),
    "metadata[tenant]": row.slug,
    "metadata[tenant_id]": row.tenant_id,
    // On the subscription too, so every event about it for its whole life says whose it is.
    "subscription_data[metadata][tenant]": row.slug,
    "subscription_data[metadata][tenant_id]": row.tenant_id,
    success_url: `${back("/create/done")}&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${back("/create")}&canceled=1`,
    expires_at: String(now + cfg.checkoutTtl),
    ...checkoutTax(cfg),
  };
  bought.forEach((a, i) => {
    form[`line_items[${i + 1}][price]`] = ids.get(a.priceKey(row.interval));
    form[`line_items[${i + 1}][quantity]`] = String(row[a.quantityField]);
  });
  return stripe(io, cfg.stripeKey, "POST", "/checkout/sessions", form, `checkout-${row.tenant_id}`);
}

/** True once `sessionId` can no longer be paid: expired now, or already. */
export async function expireCheckout(io, cfg, sessionId) {
  const path = `/checkout/sessions/${encodeURIComponent(sessionId)}`;
  try {
    await stripe(io, cfg.stripeKey, "POST", `${path}/expire`, {}, `expire-${sessionId}`);
    return true;
  } catch (e) {
    // Stripe refuses to expire a session that is not open; ask it which state that is.
    if (!(e instanceof StripeError) || e.status >= 500) throw e;
    return (await stripe(io, cfg.stripeKey, "GET", path)).status === "expired";
  }
}
