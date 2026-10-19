/**
 * The four dunning emails (billing/dunning.mjs email actions): the failure (day 0), the reminders,
 * and the final warning. Every number and date is read from `policy` (billing/policy.json) and the
 * dunning state, never written here, so the emails say what the Worker does.
 */
import { DAY_SECONDS, dunningPolicy } from "../../../billing/dunning.mjs";

const isoDate = (seconds) => new Date(seconds * 1000).toISOString().slice(0, 10);

const REFUSED =
  "Until it is paid, the workspace refuses every connection: nobody can sign in, send or receive messages, " +
  "or reach its files and documents, and no relay is provided.";
const DELETED =
  "everything in it is deleted for good: every account, message, file, document and setting, " +
  "and its address is released for anyone to take.";

/**
 * `{subject, text}` for `email` ({kind, day}) about workspace `slug` in dunning `state`.
 * `publicOrigin` is where Plan & billing is opened (http.mjs config().publicOrigin).
 */
export function dunningMail({ policy, email, state, slug, publicOrigin }) {
  const p = dunningPolicy(policy);
  const purge = isoDate(state.purge_at);
  const daysLeft = Math.max(0, Math.ceil((state.purge_at - (state.since + email.day * DAY_SECONDS)) / DAY_SECONDS));
  const pay = [
    state.invoice?.hosted_invoice_url ? `Pay the invoice here: ${state.invoice.hosted_invoice_url}` : null,
    `Or open ${publicOrigin}/ and choose Plan & billing for the workspace "${slug}" to pay or change the payment method.`,
    "As soon as the payment goes through, the workspace opens again, as it was.",
  ].filter(Boolean);
  const clock = `If it is still unpaid on ${purge} (UTC), ${p.grace_days} days after the payment failed, ${DELETED}`;
  switch (email.kind) {
    case "failed":
      return {
        subject: `Payment failed: the Citadel workspace "${slug}" is closed until it is paid`,
        text: [`The payment for the Citadel workspace "${slug}" failed on ${isoDate(state.since)} (UTC).`, REFUSED, clock, "", ...pay].join("\n"),
      };
    case "reminder":
      return {
        subject: `Reminder: the Citadel workspace "${slug}" is deleted on ${purge} unless it is paid`,
        text: [
          `The payment for the Citadel workspace "${slug}" failed ${email.day} days ago and is still due; ${daysLeft} days remain.`,
          REFUSED, clock, "", ...pay,
        ].join("\n"),
      };
    case "final":
      return {
        subject: `Final warning: the Citadel workspace "${slug}" is deleted in ${p.final_warning_hours} hours`,
        text: [
          `The payment for the Citadel workspace "${slug}" is still due. In ${p.final_warning_hours} hours, on ${purge} (UTC), ${DELETED}`,
          "This cannot be undone.", REFUSED, "", ...pay,
        ].join("\n"),
      };
    default:
      throw new Error(`no dunning email of kind ${JSON.stringify(email.kind)}`);
  }
}
