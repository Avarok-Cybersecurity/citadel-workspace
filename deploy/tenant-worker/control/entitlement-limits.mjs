/**
 * The usage limits of entitlements v2 (control/plans.mjs `entitlements`), and how each consumer
 * in the tenant's object reads one. A limit is a count, or `null` for "no limit" -- which only an
 * unlimited comp grant ever gives. A v1 record (before coupons) holds only counts, so every
 * reader here treats it exactly as before. Pure.
 */

/** The limits an unlimited grant lifts. The platform's own ceilings (frame size, one workspace) stay. */
export const UNLIMITED_LIMITS = Object.freeze({
  members_max: null,
  storage_gb: null,
  connections_max: null,
  relay_gb_included: null,
  secure_links_per_member: null,
  secure_links_pool: null,
});

/** Which `trial_caps` entry bounds each limit while a trial is clamped. */
const TRIAL_CAP_OF = {
  members_max: "members",
  storage_gb: "storage_gb",
  connections_max: "connections",
  relay_gb_included: "relay_gb",
  secure_links_per_member: "secure_links_per_member",
  secure_links_pool: "secure_links_pool",
};

/** `limits` with each one no larger than its trial cap. */
export function clampToTrial(limits, caps) {
  const out = {};
  for (const [field, cap] of Object.entries(TRIAL_CAP_OF)) {
    if (!Number.isInteger(limits[field]) || !Number.isInteger(caps[cap])) throw new Error(`a trial clamps counts only (${field})`);
    out[field] = Math.min(limits[field], caps[cap]);
  }
  return out;
}

/** A limit as a count, or null for none; anything else is a record no limit can be read from. */
export function limitOf(entitlements, field) {
  const value = entitlements[field];
  if (value === null) {
    if (entitlements.unlimited !== true) throw new Error(`the tenant's entitlements lift ${field} without being unlimited`);
    return null;
  }
  if (!Number.isInteger(value) || value < 0) throw new Error(`the tenant's entitlements carry no usable ${field} (${JSON.stringify(value)})`);
  return value;
}
