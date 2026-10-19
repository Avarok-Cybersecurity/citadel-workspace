/** Dunning through the real Worker: Stripe's invoice events, the closed workspace, the reminders, payment. */
import policy from "../../../billing/policy.json";
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { deliver, eventRecorded, get, item, monitorOf, objectStats, openSocket, outbound, subscriptionEvent, tenantRow } from "./helpers.mjs";
import { age, dunningRow, evt, invoiceEvent, now, objectState, paidTenant } from "./dunning-fixtures.mjs";

const { grace_days, reminder_days, final_warning_hours } = policy.dunning;
const DAY = 86400;

async function failed(stem, opts = {}) {
  const t = await paidTenant(stem);
  const sink = outbound(opts.sink);
  const event = invoiceEvent("invoice.payment_failed", t.row, t.subId, opts);
  const r = await deliver(event);
  return { ...t, r, event, sink };
}

describe("a failed payment", () => {
  it("closes the workspace at once: suspended, a dunning row on the grace clock, the object not ready, one email", async () => {
    const created = now() - 120;
    const { slug, row, r, event, sink } = await failed("df", { created });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ applied: true, tenant: slug });
    expect(await eventRecorded(event.id)).toBe(true);
    expect((await tenantRow(slug)).status).toBe("suspended");
    expect(await dunningRow(row.tenant_id)).toMatchObject({
      slug, since: created, purge_at: created + grace_days * DAY, invoice_id: "in_test_1", reminders_sent: "[0]",
      hosted_invoice_url: "https://invoice.stripe.com/i/in_test_1", customer_email: `billing+${slug}@example.com`, final_warning_sent_at: null,
    });
    expect(sink.mails).toHaveLength(1);
    expect(sink.mails[0].to).toEqual([`billing+${slug}@example.com`]);
    expect(sink.mails[0].subject).toMatch(/^Payment failed/);
    expect(sink.mails[0].text).toContain("https://invoice.stripe.com/i/in_test_1");
    expect(await objectState(slug)).toMatchObject({ ready: false, entitlements: { status: "suspended" } });
  });

  it("is answered payment-required by the status route, discovery and the tenant host", async () => {
    const { slug, row } = await failed("da");
    const { since, purge_at } = await dunningRow(row.tenant_id);
    const billing = { state: "payment_required", since, purge_at };
    expect((await (await get(`/api/tenants/${slug}/status`)).json())).toMatchObject({ status: "suspended", billing });
    const discovery = await get(`/api/admission/${slug}`);
    expect(discovery.status).toBe(403);
    expect(await discovery.json()).toMatchObject({ error: "payment-required", billing });
    const { refused } = await openSocket(slug);
    expect(refused.status).toBe(403);
    const body = await refused.json();
    expect(body).toMatchObject({ error: "payment-required", billing });
    expect(body.detail).toContain(new Date(purge_at * 1000).toISOString().slice(0, 10));
  });

  it("closes every open socket with 4002 payment-required", async () => {
    const t = await paidTenant("ds");
    const { ws, closed } = await openSocket(t.slug);
    expect(ws).toBeDefined();
    outbound();
    expect((await deliver(invoiceEvent("invoice.payment_failed", t.row, t.subId))).status).toBe(200);
    expect(await closed).toEqual({ code: 4002, reason: "payment-required" });
  });

  it("a second failure while owing opens nothing new and sends nothing", async () => {
    const { slug, row, subId } = await failed("d2");
    const before = await dunningRow(row.tenant_id);
    const { mails } = outbound();
    const again = await deliver(invoiceEvent("invoice.payment_failed", row, subId, { created: now() + 3600, invoiceId: "in_test_2" }));
    expect(await again.json()).toMatchObject({ applied: false });
    expect(mails).toHaveLength(0);
    expect(await dunningRow(row.tenant_id)).toEqual(before);
    expect((await tenantRow(slug)).status).toBe("suspended");
  });

  it("a mail that fails does not fail the webhook; the monitor's next run sends it", async () => {
    const { slug, row, r, sink } = await failed("dm", { sink: { mailStatus: 500 } });
    expect(r.status).toBe(200);
    expect(sink.mails).toHaveLength(0);
    expect((await dunningRow(row.tenant_id)).reminders_sent).toBe("[]");
    // The tick's own attempt fails too: the run says so, naming the tenant, and records nothing.
    outbound({ mailStatus: 503 });
    await expect(monitorOf(slug)()).rejects.toThrow(new RegExp(`${slug}: the failed email \\(day 0\\)`));
    expect((await dunningRow(row.tenant_id)).reminders_sent).toBe("[]");
    const { mails } = outbound();
    await monitorOf(slug)();
    expect(mails.map((m) => m.subject)).toEqual([expect.stringMatching(/^Payment failed/)]);
    expect((await dunningRow(row.tenant_id)).reminders_sent).toBe("[0]");
  });

  it("a yearly plan's usage-only invoice failing closes it too, and its usage subscription is kept for the payment", async () => {
    const t = await paidTenant("dy", "year");
    // Its own id: every yearly tenant in the suite is handed sub_usage_1 by the Stripe stand-in.
    const usage = `sub_use_${crypto.randomUUID().replaceAll("-", "")}`;
    await env.CONTROL_DB.prepare("UPDATE tenants SET usage_subscription = ? WHERE slug = ?").bind(usage, t.slug).run();
    const { calls } = outbound();
    expect((await deliver(invoiceEvent("invoice.payment_failed", t.row, usage, { shape: "parent" }))).status).toBe(200);
    expect(await tenantRow(t.slug)).toMatchObject({ status: "suspended", usage_subscription: usage });
    await deliver(invoiceEvent("invoice.paid", t.row, usage));
    expect(await tenantRow(t.slug)).toMatchObject({ status: "active", usage_subscription: usage });
    expect(calls.filter((c) => c.url.startsWith("https://api.stripe.com/v1/subscriptions"))).toEqual([]);
  });

  it("an invoice of a subscription no tenant holds is recorded and changes nothing", async () => {
    outbound();
    const event = invoiceEvent("invoice.payment_failed", { slug: "x", tenant_id: "y" }, "sub_nobody");
    expect(await (await deliver(event)).json()).toMatchObject({ applied: false, note: "no active tenant for this invoice" });
    expect(await eventRecorded(event.id)).toBe(true);
  });
});

describe("the subscription while payment is required", () => {
  it("past_due keeps the workspace closed; unpaid from active starts dunning and keeps the plan", async () => {
    const { slug, row, subId } = await failed("dp");
    const items = [item("citadel-team-month", 3)];
    outbound();
    await deliver(subscriptionEvent("customer.subscription.updated", row, { id: evt(), created: now() + 5, status: "past_due", items, subId }));
    expect((await tenantRow(slug)).status).toBe("suspended");
    expect((await objectState(slug)).entitlements.status).toBe("suspended");

    const other = await paidTenant("du");
    outbound();
    await deliver(subscriptionEvent("customer.subscription.updated", other.row, { id: evt(), created: now() + 5, status: "unpaid", items, subId: other.subId }));
    expect(await tenantRow(other.slug)).toMatchObject({ status: "suspended", tier: "team", seats: 3 });
    expect(await dunningRow(other.row.tenant_id)).not.toBeNull();
  });

  it("Stripe's cancellation for non-payment keeps the clock on Free; paying then opens it on Free", async () => {
    const { slug, row, subId } = await failed("dc");
    const before = await dunningRow(row.tenant_id);
    outbound();
    const cancel = subscriptionEvent("customer.subscription.deleted", row, { id: evt(), created: now() + 5, status: "canceled", items: [], subId });
    cancel.data.object.cancellation_details = { reason: "payment_failed" };
    expect((await deliver(cancel)).status).toBe(200);
    expect(await tenantRow(slug)).toMatchObject({ status: "suspended", tier: "free", seats: 0 });
    expect(await dunningRow(row.tenant_id)).toEqual(before);
    await deliver(invoiceEvent("invoice.paid", row, subId, { shape: "parent" }));
    expect(await tenantRow(slug)).toMatchObject({ status: "active", tier: "free" });
    expect(await dunningRow(row.tenant_id)).toBeNull();
  });

  it("Stripe's cancellation for non-payment with no failure seen yet starts the clock, on Free", async () => {
    const t = await paidTenant("dk");
    outbound();
    const cancel = subscriptionEvent("customer.subscription.deleted", t.row, { id: evt(), created: now(), status: "canceled", items: [], subId: t.subId });
    cancel.data.object.cancellation_details = { reason: "payment_failed" };
    await deliver(cancel);
    expect(await tenantRow(t.slug)).toMatchObject({ status: "suspended", tier: "free" });
    expect(await dunningRow(t.row.tenant_id)).toMatchObject({ customer_email: null, reminders_sent: "[]" });
  });

  it("a cancellation asked for while paid up is the voluntary path: Free, open", async () => {
    const t = await paidTenant("dv");
    outbound();
    const cancel = subscriptionEvent("customer.subscription.deleted", t.row, { id: evt(), created: now() + 5, status: "canceled", items: [], subId: t.subId });
    cancel.data.object.cancellation_details = { reason: "cancellation_requested" };
    await deliver(cancel);
    expect(await tenantRow(t.slug)).toMatchObject({ status: "active", tier: "free" });
    expect(await dunningRow(t.row.tenant_id)).toBeNull();
  });
});

describe("payment", () => {
  it("invoice.paid (newer API shape) opens the workspace again: active, no dunning row, the host serves", async () => {
    const { slug, row, subId } = await failed("dr");
    const { mails } = outbound();
    const r = await deliver(invoiceEvent("invoice.paid", row, subId, { shape: "parent" }));
    expect(await r.json()).toMatchObject({ applied: true });
    expect(mails).toHaveLength(0);
    expect((await tenantRow(slug)).status).toBe("active");
    expect(await dunningRow(row.tenant_id)).toBeNull();
    expect((await objectStats(slug)).entitlements.status).toBe("active");
    expect((await (await get(`/api/tenants/${slug}/status`)).json()).billing).toEqual({ state: "active", alert: "none", overage_billing: true });
    const { ws } = await openSocket(slug);
    expect(ws).toBeDefined();
    ws.close(1000, "done");
  });

  it("an invoice paid while nothing is owed changes nothing", async () => {
    const t = await paidTenant("dn");
    outbound();
    expect(await (await deliver(invoiceEvent("invoice.paid", t.row, t.subId))).json()).toMatchObject({ applied: false });
    expect((await tenantRow(t.slug)).status).toBe("active");
  });

  it("an invoice naming another tenant in its metadata is not applied", async () => {
    const t = await paidTenant("dx");
    outbound();
    const event = invoiceEvent("invoice.payment_failed", { ...t.row, tenant_id: "someone-else" }, t.subId, { shape: "parent" });
    expect(await (await deliver(event)).json()).toMatchObject({ applied: false, note: "an invoice naming another tenant" });
    expect((await tenantRow(t.slug)).status).toBe("active");
  });
});

describe("the monitor's tick", () => {
  it("sends each reminder on its day, once however often it runs, then the final warning", async () => {
    const { slug, row } = await failed("dt");
    for (const d of reminder_days.filter((d) => d > 0)) {
      const { since } = await dunningRow(row.tenant_id);
      await age(row.tenant_id, since + d * DAY - now());
      const { mails } = outbound();
      await monitorOf(slug)();
      await monitorOf(slug)();
      expect(mails.map((m) => m.subject)).toEqual([expect.stringMatching(/^Reminder/)]);
      expect(mails[0].text).toContain(`failed ${d} days ago`);
    }
    expect((await dunningRow(row.tenant_id)).reminders_sent).toBe(JSON.stringify(reminder_days));
    const { purge_at } = await dunningRow(row.tenant_id);
    await age(row.tenant_id, purge_at - final_warning_hours * 3600 - now());
    const { mails } = outbound();
    await monitorOf(slug)();
    await monitorOf(slug)();
    expect(mails.map((m) => m.subject)).toEqual([`Final warning: the Citadel workspace "${slug}" is deleted in ${final_warning_hours} hours`]);
    expect((await dunningRow(row.tenant_id)).final_warning_sent_at).not.toBeNull();
    expect((await tenantRow(slug)).status).toBe("suspended");
  });
});
