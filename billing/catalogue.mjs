// What Stripe must contain, derived from billing/tiers.json. Pure: no I/O, so the
// derivation is testable and scripts/stripe-catalogue.mjs only compares and writes.

/** Human description of a tier's limits, e.g. "Up to 100 members · 10 GB per seat". */
export function describeLimits(limits) {
  const parts = [];
  if (limits.members) parts.push(`Up to ${limits.members.toLocaleString('en-US')} members`);
  if (limits.storage_gb_total) parts.push(`${limits.storage_gb_total} GB storage`);
  if (limits.storage_gb_per_seat) parts.push(`${limits.storage_gb_per_seat} GB per seat`);
  if (limits.priority_support) parts.push('priority support');
  return parts.join(' · ');
}

/** `citadel-team-month` */
export function lookupKey(prefix, tierId, interval) {
  return `${prefix}-${tierId}-${interval}`;
}

/**
 * The products and prices Stripe must hold. A tier with no prices (Free) is not a
 * Stripe product: nothing is sold, so nothing is created.
 */
export function deriveCatalogue(table) {
  if (!table.currency || !table.lookup_prefix || !Array.isArray(table.tiers)) {
    throw new Error('tiers.json needs currency, lookup_prefix and tiers');
  }
  const tierIds = new Set(table.tiers.map((t) => t.id));
  // Add-ons are sold the same way as tiers -- one product, per-unit licensed prices,
  // quantity = units -- so they go through the same derivation. An add-on's key is
  // its own id; `available_on` must name real tiers.
  const addons = (table.addons ?? []).map((addon) => {
    for (const t of addon.available_on) {
      if (!tierIds.has(t)) throw new Error(`add-on ${addon.id} is offered on unknown tier ${t}`);
    }
    if (tierIds.has(addon.id)) throw new Error(`add-on id ${addon.id} collides with a tier`);
    return {
      id: addon.id,
      name: addon.name,
      description: `${addon.grants.storage_gb} GB per ${addon.unit.replace(/^\d+ GB /, '')}, on ${addon.available_on.join(' and ')}`,
      prices: addon.prices,
    };
  });
  const seen = new Set();
  const products = [
    ...table.tiers.filter((tier) => tier.prices.length > 0).map((tier) => ({ ...tier, description: describeLimits(tier.limits) })),
    ...addons,
  ];
  return products
    .map((tier) => ({
      tier: tier.id,
      product: {
        name: tier.name,
        description: tier.description,
        metadata: { citadel_tier: tier.id },
      },
      prices: tier.prices.map((price) => {
        if (!Number.isInteger(price.unit_amount) || price.unit_amount <= 0) {
          throw new Error(`${tier.id}/${price.interval}: unit_amount must be a positive integer of cents`);
        }
        const key = lookupKey(table.lookup_prefix, tier.id, price.interval);
        if (seen.has(key)) throw new Error(`duplicate lookup key ${key}`);
        seen.add(key);
        return {
          lookup_key: key,
          unit_amount: price.unit_amount,
          currency: table.currency,
          interval: price.interval,
          // Per seat: the subscription's quantity is the number of seats.
          usage_type: 'licensed',
          metadata: { citadel_tier: tier.id },
        };
      }),
    }));
}

/** Differences between a wanted price and the one Stripe holds under its lookup key. */
export function priceDiffs(want, have, productId) {
  if (!have) return ['missing'];
  const diffs = [];
  if (have.unit_amount !== want.unit_amount) diffs.push(`unit_amount ${have.unit_amount} ≠ ${want.unit_amount}`);
  if (have.currency !== want.currency) diffs.push(`currency ${have.currency} ≠ ${want.currency}`);
  if (have.recurring?.interval !== want.interval) diffs.push(`interval ${have.recurring?.interval} ≠ ${want.interval}`);
  if (have.recurring?.usage_type !== want.usage_type) diffs.push(`usage_type ${have.recurring?.usage_type} ≠ ${want.usage_type}`);
  const haveProduct = typeof have.product === 'string' ? have.product : have.product?.id;
  if (productId && haveProduct !== productId) diffs.push(`product ${haveProduct} ≠ ${productId}`);
  if (have.metadata?.citadel_tier !== want.metadata.citadel_tier) diffs.push('metadata.citadel_tier');
  if (!have.active) diffs.push('archived');
  return diffs;
}

/** Differences between a wanted product and the one Stripe holds for that tier. */
export function productDiffs(want, have) {
  if (!have) return ['missing'];
  const diffs = [];
  if (have.name !== want.name) diffs.push('name');
  if ((have.description ?? '') !== want.description) diffs.push('description');
  if (!have.active) diffs.push('archived');
  return diffs;
}
