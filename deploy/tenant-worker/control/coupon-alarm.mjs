/**
 * The spend alarm of a comp grant (billing/tiers.json `coupons.grants[].alarm`): which of its
 * thresholds a tenant's measured use has reached. An alarm is recorded and logged, never acted on:
 * an unlimited tenant is not cut off by it. Pure.
 */
import { METERING } from "./plans.mjs";
import { relayBytes } from "./meter.mjs";

/**
 * `[{metric, value, threshold, period_start}]` for each threshold of `alarm` that `measured`
 * reaches (a null threshold is none): relay per billing period, and storage and members in
 * `periodStart`, the period the object meters now, so each is raised at most once per period.
 * `measured`: `{periods: [{period_start, ...each relay quota field (meter.mjs)}], storage_bytes, members}`.
 */
export function alarmsOf(alarm, measured, periodStart) {
  const out = [];
  const gb = (bytes) => Math.floor(bytes / METERING.gb_bytes);
  if (alarm.relay_gb_per_period !== null) {
    for (const p of measured.periods) {
      const value = gb(relayBytes(p));
      if (value >= alarm.relay_gb_per_period) out.push({ metric: "relay_gb_per_period", value, threshold: alarm.relay_gb_per_period, period_start: p.period_start });
    }
  }
  if (alarm.storage_gb !== null && gb(measured.storage_bytes) >= alarm.storage_gb) {
    out.push({ metric: "storage_gb", value: gb(measured.storage_bytes), threshold: alarm.storage_gb, period_start: periodStart });
  }
  if (alarm.members !== null && measured.members >= alarm.members) {
    out.push({ metric: "members", value: measured.members, threshold: alarm.members, period_start: periodStart });
  }
  return out;
}
