/**
 * billing/policy.json, the one source of every billing time limit and threshold, checked when
 * this module loads (billing/policy-shape.mjs): a missing key stops the Worker rather than
 * falling back to a number of its own. Imported as plans.mjs imports tiers.json.
 */
import policy from "../../../billing/policy.json";
import { checkPolicy, publicPolicy } from "../../../billing/policy-shape.mjs";

export const POLICY = checkPolicy(policy);

/** How long after the quota is crossed, with overage billing off, the dimension's service ends. */
export const TERMINATION_TTL_MS = POLICY.overage_billing.termination_ttl_hours * 3600 * 1000;

/** The usage share at which a dimension reads "warn": the second step of alerts.usage_percent. */
export const WARN_PERCENT = POLICY.alerts.usage_percent[1];

/** `GET /api/billing/policy`'s answer: what the UI renders its copy from. */
export const PUBLIC_POLICY = publicPolicy(POLICY);
