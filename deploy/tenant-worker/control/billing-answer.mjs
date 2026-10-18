/**
 * The `billing` object of the status answer and the usage answer: the payment state
 * (billing-status.mjs), the owner's overage choice and the coarse alert level -- the worst
 * dimension's state, with no numbers (control/termination.mjs `alertLevelOf`). Public on the
 * status route, so nothing here may carry a count.
 */
import { billingOf } from "./billing-status.mjs";
import { alertLevelOf } from "./termination.mjs";

/** `meters` is the object's `meters()` answer when the caller already has it. */
export async function billingAnswer(io, row, meters) {
  const alert = row.status === "active" ? alertLevelOf(meters ?? (await io.tenant(row.slug).meters())) : "none";
  return { ...(await billingOf(io, row)), alert, overage_billing: row.overage_billing === 1 };
}
