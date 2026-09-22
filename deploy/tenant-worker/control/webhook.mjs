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
import { json, readText, refuse } from "./http.mjs";

/** Stripe's events are well under this; a larger body is not one of them. */
const WEBHOOK_BODY_LIMIT = 512 * 1024;
const LIVE = new Set(["active", "trialing", "past_due"]);
const ENDED = new Set(["canceled", "unpaid", "incomplete_expired"]);
const FREE_PLAN = { tier: "free", interval: null, seats: 0, storage_blocks: 0 };

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
    await io.tenant(outcome.change.slug).setEntitlements(outcome.entitlements);
  }
  await io.store.applyEvent(event, io.now(), outcome.change);
  return json({ received: true, applied: Boolean(outcome.change), note: outcome.note ?? null, tenant: outcome.change?.slug ?? null });
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
  }
  return change(row, fields);
}

async function subscriptionChanged(io, event, sub) {
  const row = await tenantOf(io, sub);
  if (!row || row.slug !== sub.metadata?.tenant) return { note: "no tenant for this subscription" };
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
  return change(row, { ...fields, ...plan, status: "active", expires_at: null });
}

function change(row, fields) {
  const after = { ...row, ...fields };
  return {
    change: { slug: row.slug, tenant_id: row.tenant_id, fields },
    entitlements: entitlements(after),
  };
}
