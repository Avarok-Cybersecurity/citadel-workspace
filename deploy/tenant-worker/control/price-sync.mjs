/**
 * Price ids by lookup key, with the catalogue enforced at the moment of sale: a price whose amount
 * or tax behaviour drifted from billing/tiers.json (and pricing-model.json `tax`) is replaced
 * before anything is sold on it -- the new price takes the lookup key, the old one is archived,
 * and subscriptions already on it keep it. A MISSING price or product is not repaired here: that
 * is the operator's scripts/stripe-catalogue.mjs, and the sale fails naming the key.
 */
import model from "../../../billing/pricing-model.json";
import { planPriceSync } from "../../../billing/reconcile.mjs";
import { sha256Hex } from "./secrets.mjs";
import { stripe } from "./stripe.mjs";

const TAX_BEHAVIOR = model.tax?.behavior;
if (!["exclusive", "inclusive"].includes(TAX_BEHAVIOR)) throw new Error("pricing-model.json tax.behavior is exclusive or inclusive");

/**
 * Active price ids for `lookupKeys` as a Map, each matching `wanted` (lookup key -> the
 * catalogue's derived price, plans.mjs WANTED_PRICES); throws naming any key Stripe lacks.
 */
export async function ensurePrices(io, key, lookupKeys, wanted) {
  const query = new URLSearchParams({ active: "true", limit: "100" });
  for (const k of lookupKeys) query.append("lookup_keys[]", k);
  const list = await stripe(io, key, "GET", "/prices", query);
  const found = new Map((list.data ?? []).map((p) => [p.lookup_key, p]));
  const missing = lookupKeys.filter((k) => !found.has(k));
  if (missing.length) throw new Error(`Stripe holds no active price under ${missing.join(", ")}`);
  const ids = new Map();
  for (const k of lookupKeys) {
    const want = wanted.get(k);
    if (!want) throw new Error(`${k} is not a price billing/tiers.json sells`);
    const have = found.get(k);
    if (typeof have.product !== "string" || have.product === "") throw new Error(`the price under ${k} names no product`);
    const ops = planPriceSync(want, have, { productId: have.product, meterId: have.recurring?.meter, taxBehavior: TAX_BEHAVIOR });
    ids.set(k, ops.length ? await replace(io, key, k, ops) : have.id);
  }
  return ids;
}

/** Runs `ops` (create, then archive): the replacement's id. */
async function replace(io, key, lookupKey, ops) {
  let created = null;
  for (const op of ops) {
    if (op.op === "create_price") {
      // Two sales racing over one drifted price create ONE replacement: the key names the form.
      const form = Object.entries(op.form).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
      const price = await stripe(io, key, "POST", "/prices", op.form, `price-sync-${await sha256Hex(form)}`);
      if (typeof price?.id !== "string") throw new Error(`Stripe created a price for ${lookupKey} without an id`);
      created = price.id;
      console.warn(`[control] ${lookupKey} differed from billing/tiers.json; replaced by ${created}`);
    } else if (op.op === "archive_price") {
      if (created === null) throw new Error(`refusing to archive ${op.id} before its replacement exists`);
      await stripe(io, key, "POST", `/prices/${encodeURIComponent(op.id)}`, { active: "false" });
    } else {
      throw new Error(`unknown price-sync op ${op.op}`);
    }
  }
  if (created === null) throw new Error(`the price under ${lookupKey} differs but no replacement was planned`);
  return created;
}
