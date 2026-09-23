/**
 * What each tier sells and grants, read from billing/tiers.json -- the one table Stripe is made to
 * match (scripts/stripe-catalogue.mjs). Lookup keys come from the catalogue's own `lookupKey`, so
 * a key renamed there is renamed here without a line changing. Pure.
 */
import table from "../../../billing/tiers.json";
import { lookupKey, meteredLookupKey } from "../../../billing/catalogue.mjs";

/** Input bound, not a business rule: no tier grants more blocks than a request may ask for. */
export const MAX_STORAGE_BLOCKS = 1000;

const tiers = new Map(table.tiers.map((t) => [t.id, t]));
const storage = table.addons.find((a) => a.id === "storage");
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
  ...storage.prices.map((p) => [
    lookupKey(table.lookup_prefix, storage.id, p.interval),
    { kind: "storage", id: storage.id, interval: p.interval },
  ]),
  [meteredLookupKey(table.lookup_prefix, overage.id), { kind: "metered", id: overage.id, interval: overage.prices[0].interval }],
]);

export const tierKey = (tier, interval) => lookupKey(table.lookup_prefix, tier, interval);
export const storageKey = (interval) => lookupKey(table.lookup_prefix, storage.id, interval);

export const tierIds = () => [...tiers.keys()];
export const isPaid = (tier) => (tiers.get(tier)?.prices.length ?? 0) > 0;
export const intervalsOf = (tier) => (tiers.get(tier)?.prices ?? []).map((p) => p.interval);
export const maxSeats = (tier) => tiers.get(tier)?.limits.members ?? 0;
export const storageOfferedOn = (tier) => storage.available_on.includes(tier);
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
 * What a tenant may use, from its plan. Paid members are capped by the seats bought (and the
 * tier's ceiling); storage is the tier's per-seat grant times seats plus the add-on blocks;
 * connections and included relay scale with seats the same way. The billing period is Stripe's
 * (null until a subscription event names it: the object then meters by calendar month).
 */
export function entitlements({ tier, interval, seats, storage_blocks, status, period_start, period_end }) {
  const t = tiers.get(tier);
  if (!t) throw new Error(`unknown tier ${tier}`);
  if (period_start === undefined || period_end === undefined) throw new Error("entitlements need the billing period (null when none)");
  const limits = t.limits;
  const paid = t.prices.length > 0;
  const storageGb = paid
    ? limits.storage_gb_per_seat * seats + storage.grants.storage_gb * storage_blocks
    : limits.storage_gb_total;
  return {
    status,
    tier,
    interval: paid ? interval : null,
    seats: paid ? seats : 0,
    storage_blocks: paid ? storage_blocks : 0,
    members_max: paid ? Math.min(seats, limits.members) : limits.members,
    storage_gb: storageGb,
    workspaces_max: limits.workspaces,
    priority_support: Boolean(limits.priority_support),
    connections_max: paid ? Math.min(limits.connections_per_seat * seats, limits.connections) : limits.connections,
    relay_gb_included: paid ? limits.relay_gb_per_seat * seats : limits.relay_gb_total,
    max_frame_bytes: METERING.max_frame_bytes,
    period_start,
    period_end,
  };
}

/**
 * The plan a subscription's items describe, by the lookup keys of their prices:
 * `{tier, interval, seats, storage_blocks}`, or `{error}` for items this catalogue did not sell.
 */
/**
 * The entitlements a tenant's object enforces: what the control plane stored, with any limit it
 * lacks derived from the same stored plan (tier, interval, seats, blocks) through this table. An
 * object provisioned before a limit existed so enforces the limit its plan grants, with no
 * refusal while the monitor's drift repair catches up; a value it does hold is never overridden.
 * A stored record with no billing period had none: `null`, which meters by calendar month.
 */
export function enforcedEntitlements(stored) {
  const period = { period_start: stored.period_start ?? null, period_end: stored.period_end ?? null };
  return { ...entitlements({ ...stored, ...period }), ...stored };
}

export function planOfItems(items) {
  let plan = null;
  let blocks = 0;
  let blocksInterval = null;
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
      blocks += quantity;
      blocksInterval = sold.interval;
    }
  }
  if (!plan) return { error: "a subscription holds no tier" };
  if (blocks > 0 && !storageOfferedOn(plan.tier)) return { error: `storage is not sold on ${plan.tier}` };
  if (blocks > 0 && blocksInterval !== plan.interval) return { error: "storage and tier bill on different intervals" };
  return { ...plan, storage_blocks: blocks };
}
