/**
 * The add-ons a paid plan may buy, derived from billing/tiers.json `addons`: one descriptor per
 * add-on, which request validation, Checkout, the webhook's item parse, entitlements and the
 * registry's columns all loop over, so a new add-on is a tiers.json entry plus one line here.
 * Pure.
 */
import { lookupKey } from "../../../billing/catalogue.mjs";

/** Input bound, not a business rule: no tier grants more blocks than a request may ask for. */
export const MAX_STORAGE_BLOCKS = 1000;
/** Input bound, not a business rule: no workspace needs more packs than a request may ask for. */
export const MAX_LINK_PACKS = 1000;

/**
 * What the control plane calls each add-on's quantity -- its request field, D1 column and
 * entitlement -- and the largest quantity a request may name. Every add-on in tiers.json must
 * have an entry; one without is refused when this module loads.
 */
const QUANTITY = {
  storage: { field: "storage_blocks", max: MAX_STORAGE_BLOCKS },
  secure_links: { field: "link_packs", max: MAX_LINK_PACKS },
};

/**
 * `[{id, quantityField, max, grants, offeredOn(tier), priceKey(interval), intervals}]`, in
 * tiers.json order (which is the order Checkout lists them in).
 */
export function addonsOf(table) {
  const fields = new Set();
  return (table.addons ?? []).map((addon) => {
    const quantity = QUANTITY[addon.id];
    if (!quantity) throw new Error(`tiers.json add-on ${addon.id} has no quantity field in control/addons.mjs`);
    if (fields.has(quantity.field)) throw new Error(`two add-ons share the quantity field ${quantity.field}`);
    fields.add(quantity.field);
    for (const [grant, n] of Object.entries(addon.grants)) {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`add-on ${addon.id}: ${grant} is a positive integer`);
    }
    return Object.freeze({
      id: addon.id,
      quantityField: quantity.field,
      max: quantity.max,
      grants: Object.freeze({ ...addon.grants }),
      intervals: addon.prices.map((p) => p.interval),
      offeredOn: (tier) => addon.available_on.includes(tier),
      priceKey: (interval) => lookupKey(table.lookup_prefix, addon.id, interval),
    });
  });
}

/** `{storage_blocks: 0, link_packs: 0}`: a plan that bought no add-on. */
export const noAddons = (addons) => Object.fromEntries(addons.map((a) => [a.quantityField, 0]));
