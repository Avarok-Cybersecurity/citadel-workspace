/**
 * A paid creation's Stripe Checkout Session: opened for the plan (and its coupon), and expired
 * when a retry replaces the reservation it was opened for.
 */
import { stripeCouponId } from "../../../billing/coupons-catalogue.mjs";
import { ADDONS, COUPONS, overageKey, overageSoldWith, tierKey } from "./plans.mjs";
import { sha256Hex } from "./secrets.mjs";
import { priceIds, stripe, StripeError } from "./stripe.mjs";

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

/**
 * What a discount or trial coupon adds to the Checkout form. A discount names the Stripe coupon
 * its template derives (content-addressed, so no lookup); a trial needs no card, and a
 * subscription still without one when the trial ends is cancelled (the webhook then downgrades the
 * tenant to Free, data kept). A comp coupon never reaches Checkout.
 */
async function couponTerms(coupon) {
  if (coupon === null) return {};
  const template = COUPONS.templates.get(coupon.template);
  if (coupon.kind === "discount") return { "discounts[0][coupon]": await stripeCouponId(template, sha256Hex) };
  if (coupon.kind === "trial") {
    return {
      "subscription_data[trial_period_days]": String(template.trial_days),
      payment_method_collection: "if_required",
      "subscription_data[trial_settings][end_behavior][missing_payment_method]": "cancel",
    };
  }
  throw new Error(`a ${coupon.kind} coupon has no Checkout`);
}

/** Opens the subscription Checkout for `row`'s plan with `coupon`'s terms (null for none). */
export async function openCheckout(io, cfg, row, now, coupon) {
  const tierLookup = tierKey(row.tier, row.interval);
  const withOverage = overageSoldWith(row.tier, row.interval);
  const bought = ADDONS.filter((a) => row[a.quantityField] > 0);
  const keys = [tierLookup, ...bought.map((a) => a.priceKey(row.interval)), ...(withOverage ? [overageKey()] : [])];
  const ids = await priceIds(io, cfg.stripeKey, keys);
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
    ...(await couponTerms(coupon)),
  };
  let next = 1;
  for (const a of bought) {
    form[`line_items[${next}][price]`] = ids.get(a.priceKey(row.interval));
    form[`line_items[${next}][quantity]`] = String(row[a.quantityField]);
    next += 1;
  }
  // Metered: billed by what the meter records, so Stripe refuses a quantity on it.
  if (withOverage) form[`line_items[${next}][price]`] = ids.get(overageKey());
  return stripe(io, cfg.stripeKey, "POST", "/checkout/sessions", form, `checkout-${row.tenant_id}`);
}
