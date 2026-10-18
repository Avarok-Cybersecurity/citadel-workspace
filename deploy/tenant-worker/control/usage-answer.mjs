/**
 * `POST /api/tenants/<slug>/usage` with `{claim_code}`: the meters, to the claim-code holder
 * only (the proof the portal asks for, control/owner.mjs). The public status and discovery
 * answers carry only the coarse level; the numbers are here.
 */
import { json } from "./http.mjs";
import { ownedRow } from "./owner.mjs";
import { billingAnswer } from "./billing-answer.mjs";
import { percentOf } from "../../../billing/thresholds.mjs";

/** Seconds, as the period's bounds are; null when not counting down. */
const seconds = (ms) => (ms === null ? null : Math.floor(ms / 1000));

export async function usageAnswer(io, slug, body) {
  const owned = await ownedRow(io, slug, body);
  if (owned.error) return owned.error;
  const meters = await io.tenant(slug).meters();
  const dimensions = meters.dimensions.map(({ id, unit, used, included, state, terminate_at }) => {
    const percent = percentOf(used, included);
    return { id, unit, used, included, percent: Number.isFinite(percent) ? percent : null, state, terminate_at: seconds(terminate_at) };
  });
  return json({
    period: meters.period,
    // What the states were judged by: the object's enforced choice (the registry's is in billing).
    overage_billing: meters.overage_billing,
    dimensions,
    billing: await billingAnswer(io, owned.row, meters),
  });
}
