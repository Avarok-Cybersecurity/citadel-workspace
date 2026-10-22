// The Stripe coupons billing/tiers.json `coupons.templates` call for, and how Stripe's differ.
// Pure: scripts/stripe-catalogue.mjs lists, compares and writes; nothing here touches Stripe.
//
// One Stripe coupon per DISCOUNT template, its id content-addressed (stripeCouponId), so the
// Worker names it at Checkout without asking Stripe. Trials and comp grants have no Stripe object.
// Stripe's own max_redemptions is never set: D1 is the one counter. Only coupons carrying
// metadata.citadel_coupon are ever ours to read or delete (the Stripe account is shared).
import { couponCatalogue, stripeCouponId } from '../../billing/coupons-catalogue.mjs';

const money = (cents, currency) => `${currency === 'usd' ? '$' : `${currency.toUpperCase()} `}${(cents / 100).toFixed(2)}`;

/** "10% off", "$10.00 off", "20% off for 3 months": what a customer sees on the invoice. */
export function couponName(template, currency) {
  const d = template.discount;
  const off = d.kind === 'percent' ? `${d.percent_off}% off` : `${money(d.amount_off, currency)} off`;
  return template.duration === 'repeating' ? `${off} for ${template.months} months` : off;
}

/**
 * `[{id, template, tiers, coupon}]`: each discount template's Stripe coupon. `tiers` are the paid
 * tiers it may discount (any of them may be named by a dynamic code), resolved to product ids by
 * the caller for `applies_to`, so a discount never reaches an add-on or the metered overage.
 */
export async function deriveCoupons(table, sha256Hex) {
  const cat = couponCatalogue(table);
  const out = [];
  for (const t of cat.templates.values()) {
    if (!t.discount) continue;
    const coupon = {
      duration: t.duration,
      name: couponName(t, table.currency),
      metadata: { citadel_coupon: t.id },
      ...(t.duration === 'repeating' ? { duration_in_months: t.months } : {}),
      ...(t.discount.kind === 'percent' ? { percent_off: t.discount.percent_off } : { amount_off: t.discount.amount_off, currency: table.currency }),
    };
    out.push({ id: await stripeCouponId(t, sha256Hex), template: t.id, tiers: [...cat.paidTiers], coupon });
  }
  return out;
}

/** The form that creates `want` at Stripe, its products already resolved (`productIds`, in tier order). */
export function couponForm(want, productIds) {
  const c = want.coupon;
  const form = { id: want.id, name: c.name, duration: c.duration, 'metadata[citadel_coupon]': c.metadata.citadel_coupon };
  if (c.duration_in_months !== undefined) form.duration_in_months = String(c.duration_in_months);
  if (c.percent_off !== undefined) form.percent_off = String(c.percent_off);
  if (c.amount_off !== undefined) Object.assign(form, { amount_off: String(c.amount_off), currency: c.currency });
  productIds.forEach((id, i) => { form[`applies_to[products][${i}]`] = id; });
  return form;
}

/**
 * Differences between a wanted coupon and the one Stripe holds under its id (listed with
 * `expand[]=data.applies_to`). A Stripe coupon's terms cannot be edited, which is why its id is
 * content-addressed: a difference here means someone changed it by hand.
 */
export function couponDiffs(want, have, productIds) {
  if (!have) return ['missing'];
  const c = want.coupon;
  const diffs = [];
  for (const k of ['percent_off', 'amount_off', 'currency', 'duration', 'duration_in_months']) {
    if ((have[k] ?? undefined) !== c[k]) diffs.push(`${k} ${have[k]} ≠ ${c[k]}`);
  }
  if (have.metadata?.citadel_coupon !== c.metadata.citadel_coupon) diffs.push('metadata.citadel_coupon');
  if (have.max_redemptions !== null && have.max_redemptions !== undefined) diffs.push('max_redemptions is set at Stripe');
  const products = [...(have.applies_to?.products ?? [])].sort();
  if (JSON.stringify(products) !== JSON.stringify([...productIds].sort())) diffs.push('applies_to products');
  if (have.valid === false) diffs.push('no longer valid');
  return diffs;
}

/** Coupons of ours (metadata.citadel_coupon) naming a template this table no longer derives. */
export function staleCoupons(wanted, have) {
  const derived = new Set(wanted.map((w) => w.template));
  return have.filter((c) => typeof c.metadata?.citadel_coupon === 'string' && !derived.has(c.metadata.citadel_coupon));
}
