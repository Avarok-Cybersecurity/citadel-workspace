/**
 * The text of a usage alert (control/alerts.mjs), one per threshold key (billing/thresholds.mjs).
 * Every limit it states is rendered from billing/policy.json; nothing here carries a number of
 * its own. Pure.
 */
import { POLICY } from "./policy.mjs";
import { billedUnitOf } from "./dimensions.mjs";

const LABEL = { "relay-overage": "relay", "document-appends": "document edits", storage: "storage" };

const familyOf = (key) => key.slice(0, key.indexOf(":"));
const valueOf = (key) => Number(key.slice(key.indexOf(":") + 1));

function stopped(dimension) {
  const { terminated_service, data_deleted_on_termination } = POLICY.overage_billing;
  const kept = data_deleted_on_termination ? "" : " No data is deleted.";
  return `${terminated_service[dimension]}${kept}`;
}

function beyond(dimension, steps) {
  const { size, unit } = billedUnitOf(dimension);
  const amount = steps * POLICY.alerts.overage_step_units[dimension];
  return size === 1 ? `${amount} ${unit}` : `${amount} x ${unit}`;
}

/** `{subject, text}` for announcing `key` about `dimension` of workspace `slug`. */
export function alertMail({ slug, dimension, key, overage_billing }) {
  const label = LABEL[dimension];
  if (!label) throw new Error(`no alert text for dimension ${dimension}`);
  const n = valueOf(key);
  const ttl = POLICY.overage_billing.termination_ttl_hours;
  const head = `Citadel Workspace ${slug}:`;
  switch (familyOf(key)) {
    case "percent": {
      const after = dimension === "storage" || overage_billing
        ? (dimension === "storage" ? stopped("storage") : "Usage beyond it is billed as overage.")
        : `With overage billing off, reaching it stops the service ${ttl} hours later: ${stopped(dimension)}`;
      return { subject: `${head} ${n}% of the included ${label} used`, text: `${n}% of this period's included ${label} is used. ${after}` };
    }
    case "overage":
      return { subject: `${head} ${label} overage passed ${beyond(dimension, n)}`, text: `This period's ${label} is now more than ${beyond(dimension, n)} beyond the plan, billed as overage.` };
    case "countdown":
      if (n === 0) return { subject: `${head} ${label} stopped until the period resets`, text: `The included ${label} was used with overage billing off. ${stopped(dimension)}` };
      return { subject: `${head} ${label} stops in ${n} hours`, text: `The included ${label} is used and overage billing is off. In ${n} hours: ${stopped(dimension)} Enabling overage billing keeps it running.` };
    default:
      throw new Error(`no alert text for ${key}`);
  }
}
