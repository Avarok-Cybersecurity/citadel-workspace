/** Paid tenants and Stripe's invoice events, for the dunning and purge suites. */
import { env, runInDurableObject } from "cloudflare:test";
import { expect, vi } from "vitest";
import { createBody, deliver, freshSlug, item, outbound, post, subscriptionEvent, tenantObject, tenantRow, until } from "./helpers.mjs";

export const now = () => Math.floor(Date.now() / 1000);
export const evt = () => `evt_${crypto.randomUUID()}`;

/**
 * An active monthly Team tenant whose subscription is its own (bySubscription finds one row: the
 * rest of the suite shares sub_test_1).
 */
export async function paidTenant(stem, interval = "month") {
  const slug = freshSlug(stem);
  outbound();
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval, seats: 3 }))).status).toBe(201);
  const pending = await tenantRow(slug);
  const subId = `sub_dun_${crypto.randomUUID().replaceAll("-", "")}`;
  const created = subscriptionEvent("customer.subscription.created", pending, { id: evt(), created: now(), items: [item(`citadel-team-${interval}`, 3)], subId });
  expect((await deliver(created)).status).toBe(200);
  vi.restoreAllMocks();
  const row = await tenantRow(slug);
  expect(row).toMatchObject({ status: "active", tier: "team", stripe_subscription: subId });
  return { slug, subId, row };
}

/**
 * An invoice event for `subId`. `shape` "legacy" carries `subscription` at the top (older API
 * versions); "parent" carries it in `parent.subscription_details` with the metadata (newer).
 */
export function invoiceEvent(type, row, subId, { created = now(), shape = "legacy", email = `billing+${row.slug}@example.com`, invoiceId = "in_test_1" } = {}) {
  const invoice = { id: invoiceId, object: "invoice", customer: "cus_test_1", customer_email: email, hosted_invoice_url: `https://invoice.stripe.com/i/${invoiceId}` };
  if (shape === "legacy") invoice.subscription = subId;
  else invoice.parent = { type: "subscription_details", subscription_details: { subscription: subId, metadata: { tenant: row.slug, tenant_id: row.tenant_id } } };
  return { id: evt(), type, created, data: { object: invoice } };
}

/**
 * What the tenant's object holds from the control plane: whether it serves, and its entitlements.
 * Read inside the object, since the Worker refuses a suspended tenant's host before reaching it.
 * After a purge the object resets itself (control/suspension.mjs); this waits for the fresh one.
 */
export const objectState = (slug) =>
  until(`${slug}'s object`, async () => {
    try {
      return await runInDurableObject(tenantObject(slug), (instance, state) =>
        state.storage.get("control:provisioning").then((stored) => ({
          ready: instance.provisioning.ready(), entitlements: instance.provisioning.summary().entitlements, stored: stored ?? null,
        })));
    } catch (e) {
      if (String(e?.message).includes("purged")) return null;
      throw e;
    }
  });

export const dunningRow = (tenantId) => env.CONTROL_DB.prepare("SELECT * FROM tenant_dunning WHERE tenant_id = ?").bind(tenantId).first();
export const purgeRow = (tenantId) => env.CONTROL_DB.prepare("SELECT * FROM tenant_purges WHERE tenant_id = ?").bind(tenantId).first();

/** Moves the tenant's dunning clock `seconds` into the past, as if that much time had gone by. */
export const age = (tenantId, seconds) =>
  env.CONTROL_DB.prepare("UPDATE tenant_dunning SET since = since - ?, purge_at = purge_at - ? WHERE tenant_id = ?").bind(seconds, seconds, tenantId).run();
