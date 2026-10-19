/**
 * billing/policy.json as the Worker's dunning reads it: the whole file, whose `dunning` section is
 * checked here, at load, so a missing or malformed key stops the Worker rather than defaulting.
 */
import policy from "../../../billing/policy.json";
import { dunningPolicy } from "../../../billing/dunning.mjs";

export const POLICY = policy;
/** `{grace_days, reminder_days, final_warning_hours}`, read once. */
export const DUNNING = dunningPolicy(POLICY);
