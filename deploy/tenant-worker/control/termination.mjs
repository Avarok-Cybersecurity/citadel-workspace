/**
 * What a dimension's usage means for its service (docs/plans/billing-automation.md G2, G3). Pure:
 * the tenant object (control/tenant-billing.mjs) measures, remembers when the quota was crossed
 * and hands both in, with the time.
 *
 *   ok           below the warn share (policy alerts.usage_percent, second step)
 *   warn         at or past it, below the quota
 *   over         at or past the quota with overage billing on: the excess is billed
 *   terminating  at or past it with overage billing off: the service ends at terminate_at
 *   terminated   terminate_at has passed: the service stays off until the period resets
 */
import { percentOf, quotaReached } from "../../../billing/thresholds.mjs";
import { WARN_PERCENT } from "./policy.mjs";

/** Severity, least first: the public alert level is the worst state across dimensions. */
export const STATES = ["ok", "warn", "over", "terminating", "terminated"];
const LEVEL_OF = { ok: "none", warn: "warn", over: "over", terminating: "terminating", terminated: "terminated" };

/** For a dimension that is never terminated (storage, a hard cap): ok, warn or over. */
export function capOf({ used, included }) {
  if (quotaReached(used, included)) return { state: "over" };
  return { state: percentOf(used, included) >= WARN_PERCENT ? "warn" : "ok" };
}

/** `crossed_at` (ms) is when the object first saw the quota reached with overage billing off. */
export function terminationOf({ used, included, overage_billing, crossed_at, now_ms, ttl_hours }) {
  if (typeof overage_billing !== "boolean") throw new Error("terminationOf needs overage_billing as true or false");
  if (!Number.isInteger(ttl_hours) || ttl_hours <= 0) throw new Error("terminationOf needs ttl_hours from billing/policy.json");
  if (!quotaReached(used, included) || overage_billing) return capOf({ used, included });
  if (!Number.isFinite(crossed_at)) throw new Error("a quota reached with overage billing off has no crossed_at");
  const terminate_at = crossed_at + ttl_hours * 3600 * 1000;
  return { state: now_ms >= terminate_at ? "terminated" : "terminating", terminate_at };
}

/** The coarse level a public answer carries: no numbers, the worst state of any dimension. */
export function alertLevelOf(usage) {
  const states = usage.dimensions.map((d) => {
    if (!STATES.includes(d.state)) throw new Error(`dimension ${d.id} is in no known state (${d.state})`);
    return d.state;
  });
  const worst = states.reduce((a, b) => (STATES.indexOf(b) > STATES.indexOf(a) ? b : a), "ok");
  return LEVEL_OF[worst];
}
