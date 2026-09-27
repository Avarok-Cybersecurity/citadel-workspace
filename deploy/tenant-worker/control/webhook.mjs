/**
 * Stripe's webhook: verified, interpreted into one tenant change, applied, and only then recorded.
 *
 * Order, and why (rMazing recorded the event id BEFORE the write it guarded, so a write that
 * failed was never retried):
 *   1. an event already recorded is acknowledged and nothing else happens;
 *   2. the tenant's object is given its new entitlements -- idempotent, so a retry repeats it;
 *   3. the registry change and the event id are written in ONE D1 batch.
 * A failure at 2 or 3 answers 500 with nothing recorded, and Stripe retries the event.
 */
import { entitlements, planOfItems } from "./plans.mjs";
import { verifyWebhook } from "./stripe.mjs";
import { reconcileUsageSubscription } from "./usage-subscription.mjs";
import { json, readText, refuse } from "./http.mjs";
import { CLAIM_SEAL, sha256Hex, unseal } from "./secrets.mjs";
import { sendClaimEmail } from "./owner-email.mjs";

/** Stripe's events are well under this; a larger body is not one of them. */
const WEBHOOK_BODY_LIMIT = 512 * 1024;
const LIVE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);
// Free meters by calendar month: no Stripe period.
const FREE_PLAN = { tier: "free", interval: null, seats: 0, storage_blocks: 0, period_start: null, period_end: null };

export async function handleWebhook(io, cfg, request) {
  if (!cfg.webhookSecret) return refuse("billing-not-configured", "billing is not available yet", 503);
  const read = await readText(request, WEBHOOK_BODY_LIMIT);
  if (read.error) return read.error;
  const verified = await verifyWebhook(read.text, request.headers.get("stripe-signature"), cfg.webhookSecret, io.now());
  if (verified.error) return refuse(verified.error, "this is not a webhook Stripe signed", 400);
  const event = verified.event;
  if (typeof event?.id !== "string" || typeof event?.type !== "string") return refuse("event-unreadable", "no event id", 400);

  if (await io.store.eventSeen(event.id)) return json({ received: true, repeated: true });

  const outcome = await interpret(io, event);
  if (outcome.error) {
    // Not recorded: an event naming a price this catalogue did not sell needs the operator, and
    // Stripe's retries keep it visible until the catalogue and the subscription agree.
    console.error(`[control] webhook ${event.id} (${event.type}) refused: ${outcome.error}`);
    return refuse("event-refused", outcome.error, 422);
  }
  if (outcome.change) {
    // Before anything is recorded, so a Stripe failure here is retried with the event.
    Object.assign(outcome.change.fields, await reconcileUsageSubscription(io, cfg, outcome.after, { cancelled: outcome.cancelledUsage }));
    await io.tenant(outcome.change.slug).setEntitlements(outcome.entitlements);
  }
  await io.store.applyEvent(event, io.now(), outcome.change);
  const emailed = outcome.claimEmail ? await sendPaidClaimEmail(io, cfg, outcome.claimEmail) : null;
  return json({
    received: true, applied: Boolean(outcome.change), note: outcome.note ?? null, tenant: outcome.change?.slug ?? null,
    ...(emailed === null ? {} : { email_sent: emailed }),
  });
}

/**
 * The claim email of a paid workspace, now active. Never throws: the event is already recorded,
 * so a failure here must not make Stripe retry it, and the success page still shows the code.
 * Unsealed without being collected, so that page can still reveal it once.
 */
async function sendPaidClaimEmail(io, cfg, { row, sessionId }) {
  try {
    if (typeof sessionId !== "string" || !io.mail) return false;
    // Read after the event made the tenant active, which is what sealedClaim looks for.
    const held = await io.store.sealedClaim(row.slug, await sha256Hex(sessionId));
    if (!held) return false;
    const claim = await unseal(CLAIM_SEAL, sessionId, held.claim_sealed, held.tenant_id);
    if (claim === null) return false;
    const sent = await sendClaimEmail(io, cfg, { slug: row.slug, tenantId: row.tenant_id, to: row.owner_email, claim, client: null });
    return sent.sent;
  } catch (e) {
    console.error(`[control] the claim email for ${row.slug} was not sent: ${e?.message ?? e}`);
    return false;
  }
}

/** `{change, entitlements}`, `{note}` for an event that changes nothing, or `{error}`. */
export async function interpret(io, event) {
  const object = event.data?.object ?? {};
  switch (event.type) {
    case "checkout.session.completed":
      return checkoutCompleted(io, object);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return subscriptionChanged(io, event, object);
    default:
      return { note: `ignored ${event.type}` };
  }
}

const tenantOf = async (io, object) => {
  const id = object.metadata?.tenant_id;
  return typeof id === "string" ? io.store.byTenantId(id) : null;
};

async function checkoutCompleted(io, session) {
  const row = await tenantOf(io, session);
  if (!row || row.slug !== session.metadata?.tenant) return { note: "no tenant for this session" };
  const fields = { stripe_customer: session.customer ?? row.stripe_customer, stripe_subscription: session.subscription ?? row.stripe_subscription };
  const paid = session.payment_status === "paid" || session.payment_status === "no_payment_required";
  if (row.status === "pending" && paid) {
    // Its subscription's own event may not have arrived yet: the plan the row was created with
    // stands until that event says otherwise.
    fields.status = "active";
    fields.expires_at = null;
    // The claim email: sent once the event is recorded (handleWebhook), because the claim code is
    // sealed under this Checkout Session's id, which only this event and the success page hold.
    return { ...change(row, fields), claimEmail: { row, sessionId: session.id } };
  }
  return change(row, fields);
}

async function subscriptionChanged(io, event, sub) {
  const row = await tenantOf(io, sub);
  if (!row || row.slug !== sub.metadata?.tenant) return { note: "no tenant for this subscription" };
  if (sub.id && sub.id === row.usage_subscription) {
    // The usage-only subscription: it carries no plan. Deleted (cancelled in the portal, say), it
    // is replaced, so overage cannot go unbilled by cancelling it.
    if (event.type !== "customer.subscription.deleted") return { note: "the usage subscription" };
    return { ...change(row, {}), cancelledUsage: sub.id };
  }
  if (row.stripe_subscription && sub.id && row.stripe_subscription !== sub.id) return { note: "a subscription the tenant no longer holds" };
  const created = Number(event.created ?? 0);
  if (created < row.sub_event_created) return { note: "older than the state already applied" };

  const fields = { stripe_customer: sub.customer ?? row.stripe_customer, stripe_subscription: sub.id ?? row.stripe_subscription, sub_event_created: created };
  const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
  if (ENDED.has(status)) {
    // Downgrade, not deletion: the workspace and its data stay, on the free tier's limits. A
    // tenant that never became active has nothing to downgrade and simply lapses.
    if (row.status !== "pending") Object.assign(fields, FREE_PLAN, { status: "active" });
    return change(row, fields);
  }
  if (status === "paused") return change(row, { ...fields, status: "suspended" });
  if (!LIVE.has(status)) return change(row, fields); // incomplete: nothing is granted yet
  const plan = planOfItems(sub.items?.data ?? []);
  if (plan.error) return { error: plan.error };
  return change(row, { ...fields, ...plan, ...periodOf(sub), status: "active", expires_at: null });
}

/**
 * The subscription's current billing period, in seconds, which the tenant's object meters usage
 * by. Stripe moved it from the subscription onto its items (API 2025-03-31.basil); either is read.
 * Nothing when neither names one, so the period already stored stands.
 */
export function periodOf(sub) {
  const holders = [sub, ...(sub.items?.data ?? [])];
  const holder = holders.find((h) => Number.isInteger(h?.current_period_start) && Number.isInteger(h?.current_period_end));
  if (!holder || holder.current_period_end <= holder.current_period_start) return {};
  return { period_start: holder.current_period_start, period_end: holder.current_period_end };
}

function change(row, fields) {
  const after = { ...row, ...fields };
  return {
    change: { slug: row.slug, tenant_id: row.tenant_id, fields },
    entitlements: entitlements(after),
    after,
  };
}
