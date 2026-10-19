// What to write to Stripe so it holds what billing/catalogue.mjs derives. Pure: plans only;
// scripts/stripe-catalogue.mjs performs the ops.
import { priceDiffs } from './catalogue.mjs';

/**
 * The ops that make Stripe's price under `want.lookup_key` match `want`: none when it already
 * does (tax behaviour included); otherwise create the wanted price -- it takes the lookup key from
 * the old one -- and archive the old one if it is still active. Stripe prices are immutable, and
 * existing subscriptions keep the price they were created with.
 */
export function planPriceSync(want, have, { productId, meterId, taxBehavior }) {
  if (typeof productId !== 'string' || !productId) throw new Error(`planPriceSync ${want.lookup_key}: productId is required`);
  const metered = want.usage_type === 'metered';
  if (metered && (typeof meterId !== 'string' || !meterId)) throw new Error(`planPriceSync ${want.lookup_key}: a metered price needs meterId`);
  if (priceDiffs(want, have, productId, meterId, taxBehavior).length === 0) return [];
  const form = {
    product: productId,
    currency: want.currency,
    unit_amount: String(want.unit_amount),
    'recurring[interval]': want.interval,
    'recurring[usage_type]': want.usage_type,
    ...(metered ? { 'recurring[meter]': meterId } : {}),
    lookup_key: want.lookup_key,
    transfer_lookup_key: 'true',
    tax_behavior: taxBehavior,
    'metadata[citadel_tier]': want.metadata.citadel_tier,
  };
  return [{ op: 'create_price', form }, ...(have && have.active ? [{ op: 'archive_price', id: have.id }] : [])];
}

/**
 * Citadel's customer-portal configuration id, from deploy/tenant-worker/wrangler.toml -- the one
 * the Worker opens sessions with. Exactly one assignment, or a throw: the Stripe account is shared
 * with another product, so a guess (or the account default) would edit someone else's portal.
 */
export function portalConfigurationFrom(wranglerToml) {
  const found = [...wranglerToml.matchAll(/^\s*STRIPE_PORTAL_CONFIGURATION\s*=\s*"([^"]*)"\s*$/gm)].map((m) => m[1]);
  if (found.length !== 1) throw new Error(`wrangler.toml assigns STRIPE_PORTAL_CONFIGURATION ${found.length} times; expected exactly once`);
  if (!/^bpc_[A-Za-z0-9]+$/.test(found[0])) throw new Error(`STRIPE_PORTAL_CONFIGURATION ${found[0]} is not a bpc_ id`);
  return found[0];
}

function normalise(products) {
  return Object.fromEntries(products.map((p) => [p.product, [...p.prices].sort()]));
}

/** The quantity settings a product already carries in the portal, as form fields at index `i`. */
function quantityFields(i, q) {
  const at = `features[subscription_update][products][${i}][adjustable_quantity]`;
  if (typeof q?.enabled !== 'boolean') throw new Error(`portal product ${i} has no adjustable_quantity to carry over`);
  return {
    [`${at}[enabled]`]: String(q.enabled),
    ...(q.enabled && Number.isInteger(q.minimum) ? { [`${at}[minimum]`]: String(q.minimum) } : {}),
    ...(q.enabled && Number.isInteger(q.maximum) ? { [`${at}[maximum]`]: String(q.maximum) } : {}),
  };
}

/**
 * The portal's plan-change list must offer every licensed product with all its active prices.
 * `config` must be read with `expand[]=features.subscription_update.products` (Stripe omits the
 * list otherwise). `products`: [{ product: prod id, prices: [price ids] }]. Returns { diffs, form }:
 * `form` is the whole list to POST (Stripe replaces it), carrying each product's existing quantity
 * settings, or null when a product is new to the portal -- its seat/pack limits are an operator
 * choice made once in the Dashboard, never a default here. Refuses the account default portal.
 */
export function planPortal(config, products) {
  if (!config?.id) throw new Error('no portal configuration');
  if (config.is_default) throw new Error(`refusing ${config.id}: it is the account default portal, shared with another product`);
  const listed = config.features?.subscription_update?.products;
  if (!Array.isArray(listed)) throw new Error(`${config.id}: subscription_update.products absent; read it with expand[]=features.subscription_update.products`);
  for (const p of products) if (!p.prices.length) throw new Error(`portal product ${p.product} has no active price`);
  const want = normalise(products);
  const have = normalise(listed);
  const diffs = [];
  for (const [prod, prices] of Object.entries(want)) {
    if (!have[prod]) diffs.push(`${prod} missing (add it once in the Dashboard with its quantity limits)`);
    else if (have[prod].join() !== prices.join()) diffs.push(`${prod} prices ${have[prod].join(',')} ≠ ${prices.join(',')}`);
  }
  for (const prod of Object.keys(have)) if (!want[prod]) diffs.push(`${prod} not a licensed Citadel product`);
  if (Object.keys(want).some((prod) => !have[prod])) return { diffs, form: null };
  const form = {};
  Object.entries(want).forEach(([prod, prices], i) => {
    form[`features[subscription_update][products][${i}][product]`] = prod;
    prices.forEach((price, j) => { form[`features[subscription_update][products][${i}][prices][${j}]`] = price; });
    Object.assign(form, quantityFields(i, listed.find((l) => l.product === prod).adjustable_quantity));
  });
  return { diffs, form };
}
