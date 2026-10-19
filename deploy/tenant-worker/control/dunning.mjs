/**
 * Dunning in the webhook (control/webhook.mjs): Stripe's invoice and cancellation events,
 * interpreted through the state machine in billing/dunning.mjs, as one tenant change.
 *
 * The change -- status, the tenant_dunning row opened or closed, the object's entitlements -- is
 * applied as every webhook change is: entitlements first, then the registry and the event in ONE
 * D1 batch (the dunning statements ride in `change.statements`). Emails go out only after that
 * batch, and a mail that fails does not fail the webhook: it is logged, left unrecorded, and the
 * monitor's tick (control/dunning-tick.mjs) sends it on its next run.
 */
import { markSent, transition } from "../../../billing/dunning.mjs";
import { POLICY } from "./dunning-policy.mjs";
import { dunningMail } from "./dunning-mail.mjs";

const text = (v) => (typeof v === "string" && v.length > 0 ? v : null);
const idOf = (v) => text(v) ?? text(v?.id);

/** The subscription an invoice bills: `subscription` (older API versions) or `parent.subscription_details` (newer). */
export const invoiceSubscription = (invoice) => idOf(invoice.subscription) ?? idOf(invoice.parent?.subscription_details?.subscription);
const invoiceMetadata = (invoice) => invoice.subscription_details?.metadata ?? invoice.parent?.subscription_details?.metadata ?? {};
export const invoiceOf = (invoice) => ({
  id: text(invoice?.id), hosted_invoice_url: text(invoice?.hosted_invoice_url), customer_email: text(invoice?.customer_email),
});

/** billing/dunning.mjs's state for a tenant_dunning row (or null). */
export function stateOf(held) {
  if (held === null) return { kind: "active" };
  return {
    kind: "payment_required", since: held.since, purge_at: held.purge_at, reminders_sent: JSON.parse(held.reminders_sent),
    final_warning_sent_at: held.final_warning_sent_at,
    invoice: { id: held.invoice_id, hosted_invoice_url: held.hosted_invoice_url, customer_email: held.customer_email },
  };
}

/** When the event happened, which starts the grace clock: Stripe's `created`, else now. */
export const eventTime = (io, event) => (Number.isInteger(event.created) ? event.created : io.now());

/** `invoice.payment_failed` and `invoice.paid`: `{note}`, `{error}` or the outcome of dunningChange. */
export async function invoiceEvent(io, event, invoice, changeOf) {
  const sub = invoiceSubscription(invoice);
  if (sub === null) return { note: "an invoice of no subscription" };
  const rows = await io.store.bySubscription(sub);
  if (rows.length > 1) return { error: `subscription ${sub} is held by ${rows.length} tenants` };
  const row = rows[0] ?? null;
  if (row === null || row.status === "pending") return { note: "no active tenant for this invoice" };
  const named = invoiceMetadata(invoice).tenant_id;
  if (typeof named === "string" && named !== row.tenant_id) return { note: "an invoice naming another tenant" };
  const at = eventTime(io, event);
  const dunEvent = event.type === "invoice.paid" ? { type: "paid", at } : { type: "payment_failed", at, invoice: invoiceOf(invoice) };
  return dunningChange(io, row, dunEvent, {}, changeOf);
}

/**
 * The outcome of `dunEvent` for `row`, with `fields` the event's other registry changes:
 * `{note}` when dunning has nothing to do, else `changeOf`'s `{change, entitlements, after}` plus
 * `inDunning`, `voluntaryCancel` and `mails` (email actions to send after the batch).
 */
export async function dunningChange(io, row, dunEvent, fields, changeOf) {
  const held = await io.dunning.get(row.tenant_id);
  const before = stateOf(held);
  const { state, actions } = transition(before, dunEvent, POLICY);
  const did = new Set(actions.map((a) => a.type));
  if (did.has("restore") && (await io.dunning.purgeOf(row.tenant_id)) !== null) {
    // Too late: the workspace is being or has been deleted. The operator refunds by hand.
    console.error(`[dunning] ${row.slug} paid after its purge began: refund the invoice by hand`);
    return { note: "paid after the purge began" };
  }
  if (actions.length === 0 && Object.keys(fields).length === 0) return { note: `nothing to do: ${before.kind}` };
  const owing = state.kind === "payment_required";
  const outcome = changeOf(row, { ...fields, status: owing ? "suspended" : "active" });
  const statements = [];
  if (did.has("suspend")) statements.push(io.dunning.open(row, state, io.now()));
  if (did.has("restore")) statements.push(io.dunning.close(row.tenant_id));
  outcome.change.statements = statements;
  return {
    ...outcome, inDunning: owing, voluntaryCancel: did.has("voluntary_cancel"),
    mails: actions.filter((a) => a.type === "email").map((email) => ({ email, state, row })),
  };
}

/**
 * Sends one dunning email, then records it as sent. Throws when it cannot be sent (no transport,
 * no address, the transport refused), with nothing recorded, so the next tick tries again. No
 * address or text is ever put in an error.
 */
export async function deliverDunningMail(io, cfg, { email, state, row }) {
  const what = `the ${email.kind} email (day ${email.day})`;
  const to = state.invoice?.customer_email ?? null;
  if (io.mail === null) throw new Error(`${what} cannot be sent: this deployment has no mail transport`);
  if (to === null) throw new Error(`${what} cannot be sent: the invoice carried no address`);
  const message = dunningMail({ policy: POLICY, email, state, slug: row.slug, publicOrigin: cfg.publicOrigin });
  await io.mail.send({ to, ...message }).catch((e) => {
    throw new Error(`${what} failed: ${e?.message ?? e}`);
  });
  const now = io.now();
  await io.dunning.recordSent(row.tenant_id, state.since, markSent(state, email, now, POLICY), now);
}

/** The webhook's mails, after its batch, which they must not undo: a failure is logged and left to the tick. */
export async function sendAfterBatch(io, cfg, mails) {
  for (const mail of mails ?? []) {
    try {
      await deliverDunningMail(io, cfg, mail);
    } catch (e) {
      console.error(`[dunning] ${mail.row.slug}: ${e?.message ?? e}; the monitor's tick retries it`);
    }
  }
}
