/**
 * What each tier sells and grants, read from billing/tiers.json -- the one table Stripe is made to
 * match (scripts/stripe-catalogue.mjs). Lookup keys come from the catalogue's own `lookupKey`, so
 * a key renamed there is renamed here without a line changing. Pure.
 */
import table from "../../../billing/tiers.json";
import { lookupKey, meteredLookupKey } from "../../../billing/catalogue.mjs";
import { addonsOf } from "./addons.mjs";

export { MAX_LINK_PACKS, MAX_STORAGE_BLOCKS } from "./addons.mjs";

const tiers = new Map(table.tiers.map((t) => [t.id, t]));
/** Every add-on a paid plan may buy (control/addons.mjs). */
export const ADDONS = addonsOf(table);
const storage = ADDONS.find((a) => a.id === "storage");
if (!storage) throw new Error("tiers.json has no storage add-on");
const overage = (table.metered ?? []).find((m) => m.id === "relay-overage");
if (!overage) throw new Error("tiers.json has no relay-overage metered price");
/** How usage is metered (tiers.json `metering`): GB size, frame cap, flush interval. */
export const METERING = table.metering;
for (const k of ["gb_bytes", "max_frame_bytes", "flush_seconds"]) {
  if (!Number.isInteger(METERING?.[k]) || METERING[k] <= 0) throw new Error(`tiers.json metering.${k} is a positive integer`);
}
/** The Billing Meter relay overage is reported to. */
export const OVERAGE_EVENT = overage.meter.event_name;

/** Every price this Worker may sell or read back, by lookup key. */
export const PRICES = new Map([
  ...table.tiers.flatMap((t) =>
    t.prices.map((p) => [lookupKey(table.lookup_prefix, t.id, p.interval), { kind: "tier", id: t.id, interval: p.interval }]),
  ),
  ...ADDONS.flatMap((a) => a.intervals.map((interval) => [a.priceKey(interval), { kind: "addon", id: a.id, interval }])),
  [meteredLookupKey(table.lookup_prefix, overage.id), { kind: "metered", id: overage.id, interval: overage.prices[0].interval }],
]);

export const tierKey = (tier, interval) => lookupKey(table.lookup_prefix, tier, interval);
export const storageKey = (interval) => storage.priceKey(interval);

export const tierIds = () => [...tiers.keys()];
export const isPaid = (tier) => (tiers.get(tier)?.prices.length ?? 0) > 0;
export const intervalsOf = (tier) => (tiers.get(tier)?.prices ?? []).map((p) => p.interval);
export const maxSeats = (tier) => tiers.get(tier)?.limits.members ?? 0;
export const storageOfferedOn = (tier) => storage.offeredOn(tier);
export const overageBilledOn = (tier) => overage.available_on.includes(tier);
export const overageKey = () => meteredLookupKey(table.lookup_prefix, overage.id);
/**
 * Whether a Checkout for `tier` on `interval` carries the metered overage price. A Stripe
 * subscription bills all its items on one interval and the overage price is monthly, so a yearly
 * plan cannot hold it; a yearly tenant gets a usage-only subscription instead (needsUsageSubscription).
 */
export const overageSoldWith = (tier, interval) => overageBilledOn(tier) && interval === overage.prices[0].interval;
/**
 * Whether a paid tenant needs the separate usage-only subscription (usage-subscription.mjs): its
 * tier bills overage but its plan's interval cannot carry the monthly metered price.
 */
export const needsUsageSubscription = (tier, interval) => overageBilledOn(tier) && interval !== null && interval !== overage.prices[0].interval;

/**
 * What each add-on grant adds to, before any add-on: the tier's own storage, and a shared
 * secure-link pool that only packs fill. A grant with no base here is refused when this loads.
 */
const grantBases = (limits, seats, paid) => ({
  storage_gb: paid ? limits.storage_gb_per_seat * seats : limits.storage_gb_total,
  secure_links_pool: 0,
});
for (const a of ADDONS) {
  for (const grant of Object.keys(a.grants)) {
    if (!(grant in grantBases({}, 0, false))) throw new Error(`add-on ${a.id} grants ${grant}, which no entitlement adds up`);
  }
}

/**
 * What a tenant may use, from its plan. Paid members are capped by the seats bought (and the
 * tier's ceiling); storage is the tier's per-seat grant times seats plus the add-on blocks;
 * connections and included relay scale with seats the same way. Each member may hold the tier's
 * own allowance of live secure links; packs add to one pool the workspace shares. An add-on's
 * quantity counts only on a paid tier. The billing period is Stripe's (null until a subscription
 * event names it: the object then meters by calendar month).
 */
export function entitlements(plan) {
  const { tier, interval, seats, status, period_start, period_end } = plan;
  const t = tiers.get(tier);
  if (!t) throw new Error(`unknown tier ${tier}`);
  if (period_start === undefined || period_end === undefined) throw new Error("entitlements need the billing period (null when none)");
  const limits = t.limits;
  const paid = t.prices.length > 0;
  const granted = grantBases(limits, seats, paid);
  const quantities = {};
  for (const a of ADDONS) {
    const n = plan[a.quantityField];
    if (!Number.isInteger(n) || n < 0) throw new Error(`entitlements need ${a.quantityField} (0 when none was bought)`);
    quantities[a.quantityField] = paid ? n : 0;
    for (const [grant, per] of Object.entries(a.grants)) granted[grant] += per * quantities[a.quantityField];
  }
  if (!Number.isInteger(limits.secure_links_per_member)) throw new Error(`tiers.json ${tier} has no secure_links_per_member`);
  return {
    status,
    tier,
    interval: paid ? interval : null,
    seats: paid ? seats : 0,
    ...quantities,
    members_max: paid ? Math.min(seats, limits.members) : limits.members,
    storage_gb: granted.storage_gb,
    workspaces_max: limits.workspaces,
    priority_support: Boolean(limits.priority_support),
    connections_max: paid ? Math.min(limits.connections_per_seat * seats, limits.connections) : limits.connections,
    relay_gb_included: paid ? limits.relay_gb_per_seat * seats : limits.relay_gb_total,
    secure_links_per_member: limits.secure_links_per_member,
    secure_links_pool: granted.secure_links_pool,
    max_frame_bytes: METERING.max_frame_bytes,
    period_start,
    period_end,
  };
}

/**
 * The entitlements a tenant's object enforces: what the control plane stored, with any limit it
 * lacks derived from the same stored plan (tier, interval, seats, blocks) through this table. An
 * object provisioned before a limit existed so enforces the limit its plan grants, with no
 * refusal while the monitor's drift repair catches up; a value it does hold is never overridden.
 * A stored record with no billing period had none: `null`, which meters by calendar month. One
 * stored before an add-on existed bought none of it: 0.
 */
export function enforcedEntitlements(stored) {
  const period = { period_start: stored.period_start ?? null, period_end: stored.period_end ?? null };
  const predating = Object.fromEntries(ADDONS.filter((a) => !(a.quantityField in stored)).map((a) => [a.quantityField, 0]));
  return { ...entitlements({ ...stored, ...predating, ...period }), ...stored };
}

/**
 * The plan a subscription's items describe, by the lookup keys of their prices:
 * `{tier, interval, seats, storage_blocks, link_packs}`, or `{error}` for items this catalogue did not sell.
 */

export function planOfItems(items) {
  let plan = null;
  const bought = new Map(ADDONS.map((a) => [a.id, { addon: a, quantity: 0, interval: null }]));
  for (const item of items) {
    const key = item?.price?.lookup_key;
    const sold = key ? PRICES.get(key) : undefined;
    if (!sold) return { error: `price ${item?.price?.id ?? "?"} (lookup key ${key ?? "none"}) is not in the catalogue` };
    const quantity = Number(item.quantity ?? 0);
    if (!Number.isInteger(quantity) || quantity < 0) return { error: `bad quantity on ${key}` };
    if (sold.kind === "metered") continue; // billed by usage: it carries no plan
    if (sold.kind === "tier") {
      if (plan) return { error: "a subscription holds more than one tier" };
      plan = { tier: sold.id, interval: sold.interval, seats: quantity };
    } else {
      const held = bought.get(sold.id);
      held.quantity += quantity;
      held.interval = sold.interval;
    }
  }
  if (!plan) return { error: "a subscription holds no tier" };
  const quantities = {};
  for (const { addon, quantity, interval } of bought.values()) {
    if (quantity > 0 && !addon.offeredOn(plan.tier)) return { error: `${addon.id} is not sold on ${plan.tier}` };
    if (quantity > 0 && interval !== plan.interval) return { error: `${addon.id} and tier bill on different intervals` };
    quantities[addon.quantityField] = quantity;
  }
  return { ...plan, ...quantities };
}
