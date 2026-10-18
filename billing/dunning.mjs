// Dunning: what a failed payment does to a workspace, as a pure state machine. No I/O and no
// clock: the Worker (deploy/tenant-worker/control/dunning.mjs, dunning-tick.mjs) loads the state
// from D1, feeds it an event with its time, performs the actions returned, and records them.
// Every number comes from billing/policy.json `dunning`, passed in as `policy`.
//
// A state is ACTIVE or
//   { kind: "payment_required", since, purge_at, reminders_sent: [day...], final_warning_sent_at, invoice }
// (seconds, UTC; `invoice` is { id, hosted_invoice_url, customer_email }, any of them null).
// Events: { type: "payment_failed", at, invoice } | { type: "paid", at }
//       | { type: "canceled", reason, at, invoice } | { type: "tick", at }.
// Actions, in the order to perform them: { type: "suspend" } | { type: "restore" }
//       | { type: "email", kind: "failed" | "reminder" | "final", day } | { type: "purge" }
//       | { type: "voluntary_cancel" }.

export const DAY_SECONDS = 86400;
export const HOUR_SECONDS = 3600;
/** Stripe's `cancellation_details.reason` for a subscription it cancelled because payment failed. */
export const PAYMENT_FAILED_REASON = "payment_failed";

export const ACTIVE = Object.freeze({ kind: "active" });

const isCount = (v) => Number.isInteger(v) && v >= 0;

/** policy.json `dunning`, checked: every key required, nothing defaulted. Throws naming what is wrong. */
export function dunningPolicy(policy) {
  const d = policy?.dunning;
  if (d === null || typeof d !== "object") throw new Error("policy.json has no dunning section");
  const take = (key, valid, shape) => {
    if (!Object.hasOwn(d, key)) throw new Error(`policy.json dunning.${key} is required`);
    if (!valid(d[key])) throw new Error(`policy.json dunning.${key} is ${shape}`);
    return d[key];
  };
  const grace_days = take("grace_days", (v) => isCount(v) && v > 0, "a positive integer");
  const reminder_days = take(
    "reminder_days",
    (v) => Array.isArray(v) && v[0] === 0 && v.every((x, i) => isCount(x) && x < grace_days && (i === 0 || x > v[i - 1])),
    "an increasing list of days before grace_days, starting at 0 (the failure's own email)",
  );
  const final_warning_hours = take("final_warning_hours", (v) => isCount(v) && v > 0 && v < grace_days * 24, "a positive integer below grace_days in hours");
  return Object.freeze({ grace_days, reminder_days: Object.freeze([...reminder_days]), final_warning_hours });
}

const invoiceOf = (invoice) => ({
  id: invoice?.id ?? null,
  hosted_invoice_url: invoice?.hosted_invoice_url ?? null,
  customer_email: invoice?.customer_email ?? null,
});

function checkEvent(event) {
  if (!Number.isInteger(event?.at)) throw new Error(`a dunning event has an integer time (got ${JSON.stringify(event?.at)})`);
}

function checkState(state) {
  if (state?.kind === "active") return;
  if (state?.kind !== "payment_required") throw new Error(`unknown dunning state ${JSON.stringify(state?.kind)}`);
  if (!Number.isInteger(state.since) || !Number.isInteger(state.purge_at) || !Array.isArray(state.reminders_sent)) {
    throw new Error("a payment_required state has since, purge_at and reminders_sent");
  }
}

const stay = (state) => ({ state, actions: [] });

function failed(event, p) {
  const state = {
    kind: "payment_required",
    since: event.at,
    purge_at: event.at + p.grace_days * DAY_SECONDS,
    // Recorded only once an email is sent (markSent), so a send that failed is retried by the tick.
    reminders_sent: [],
    final_warning_sent_at: null,
    invoice: invoiceOf(event.invoice),
  };
  return { state, actions: [{ type: "suspend" }, { type: "email", kind: "failed", day: 0 }] };
}

/**
 * At most one action per tick: the purge once due (no warning after it), else the final warning
 * once due and unsent, else the latest reminder due and unsent. After the final warning no
 * reminder is sent; a reminder overtaken by a later one is never sent.
 */
function tick(state, at, p) {
  if (at >= state.purge_at) return { state, actions: [{ type: "purge" }] };
  if (state.final_warning_sent_at !== null && state.final_warning_sent_at !== undefined) return stay(state);
  const finalAt = state.purge_at - p.final_warning_hours * HOUR_SECONDS;
  if (at >= finalAt) return { state, actions: [{ type: "email", kind: "final", day: Math.floor((finalAt - state.since) / DAY_SECONDS) }] };
  const due = p.reminder_days.filter((d) => at >= state.since + d * DAY_SECONDS && !state.reminders_sent.includes(d));
  if (due.length === 0) return stay(state);
  const day = due[due.length - 1];
  return { state, actions: [{ type: "email", kind: day === 0 ? "failed" : "reminder", day }] };
}

/** `{state, actions}` after `event`. Throws on a state, event or policy it cannot read. */
export function transition(state, event, policy) {
  const p = dunningPolicy(policy);
  checkState(state);
  checkEvent(event);
  const owing = state.kind === "payment_required";
  switch (event.type) {
    case "payment_failed":
      // Stripe retries the same invoice and sends a failure for each try: one dunning, one clock.
      return owing ? stay(state) : failed(event, p);
    case "paid":
      return owing ? { state: ACTIVE, actions: [{ type: "restore" }] } : stay(state);
    case "canceled":
      if (event.reason === PAYMENT_FAILED_REASON) return owing ? stay(state) : failed(event, p);
      return { state, actions: [{ type: "voluntary_cancel" }] };
    case "tick":
      return owing ? tick(state, event.at, p) : stay(state);
    default:
      throw new Error(`unknown dunning event ${JSON.stringify(event.type)}`);
  }
}

/**
 * The state once `email` (an email action of `state`) has been sent at `at`: a reminder marks its
 * day and every earlier reminder day, the final warning its time.
 */
export function markSent(state, email, at, policy) {
  const p = dunningPolicy(policy);
  checkState(state);
  if (state.kind !== "payment_required") throw new Error("an email is sent only while payment is required");
  if (email?.type !== "email") throw new Error("markSent records an email action");
  if (email.kind === "final") return { ...state, final_warning_sent_at: at };
  if (!p.reminder_days.includes(email.day)) throw new Error(`day ${email.day} is not a reminder day`);
  const sent = new Set([...state.reminders_sent, ...p.reminder_days.filter((d) => d <= email.day)]);
  return { ...state, reminders_sent: p.reminder_days.filter((d) => sent.has(d)) };
}
