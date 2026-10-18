/**
 * Document appends: counted on the tenant object (control/tenant-documents.mjs), sampled by the
 * monitor and their overage reported in whole thousands (control/overage-report.mjs), against the
 * real registry and real objects. Stripe is the one mock (helpers.mjs outbound()).
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { UsageTable } from "../control/usage-table.mjs";
import { createBody, deliver, freshSlug, item, monitorOf, outbound, post, subscriptionEvent, tenantObject, tenantRow } from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);
const INCLUDED = 750000; // 3 Team seats x tiers.json document_appends_per_seat

/** An active monthly Team tenant (3 seats) with a Stripe period holding now. */
async function activeTeam(overage_billing) {
  const slug = freshSlug("ap");
  outbound();
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3, overage_billing }))).status).toBe(201);
  const row = await tenantRow(slug);
  const period = { start: now() - 86400, end: now() + 29 * 86400 };
  const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 3)], period });
  expect((await deliver(event)).status).toBe(200);
  return { row: await tenantRow(slug), period, object: tenantObject(slug) };
}

const meterEvents = (calls, tenantId) =>
  calls.filter((c) => c.url === "https://api.stripe.com/v1/billing/meter_events" && c.form.get("identifier").includes(tenantId));
const usageRow = (tenantId, start) => env.CONTROL_DB.prepare("SELECT * FROM tenant_usage WHERE tenant_id = ? AND period_start = ?").bind(tenantId, start).first();

describe("the object counts appends", () => {
  it("per period, reported by usage() with the plan's included appends", async () => {
    const { period, object } = await activeTeam(true);
    await object.recordAppends(5);
    await object.recordAppends(2);
    const { periods } = await object.usage();
    expect(periods[0]).toMatchObject({ period_start: period.start, appends: 7, document_appends_included: INCLUDED });
  });
  it("through the host the Docs kernel is given: appended(n) counts, writable() asks the object", async () => {
    const { object } = await activeTeam(true);
    await runInDurableObject(object, (instance) => {
      const host = instance.documentsHost();
      host.appended(4);
      expect(host.writable()).toBe(true);
      instance.documentsWritable = () => false; // the object's answer is the host's
      expect(host.writable()).toBe(false);
      for (const bad of [0, -1, 1.5, "3", undefined]) expect(() => host.appended(bad)).toThrow(TypeError);
    });
    expect((await object.usage()).periods[0].appends).toBe(4);
  });
  it("adds the appends column to an object whose usage table predates it", async () => {
    const { object } = await activeTeam(true);
    await runInDurableObject(object, (instance) => {
      const sql = instance.ctx.storage.sql;
      sql.exec("DROP TABLE quota_usage");
      sql.exec("CREATE TABLE quota_usage (period_start INTEGER PRIMARY KEY, period_end INTEGER NOT NULL, bytes_in INTEGER NOT NULL, " +
        "bytes_out INTEGER NOT NULL, frames_in INTEGER NOT NULL, active_seconds INTEGER NOT NULL, peak_connections INTEGER NOT NULL, updated_at INTEGER NOT NULL)");
      sql.exec("INSERT INTO quota_usage VALUES (1, 2, 3, 4, 5, 6, 7, 8)");
      new UsageTable(sql);
      expect([...sql.exec("SELECT appends FROM quota_usage WHERE period_start = 1")]).toEqual([{ appends: 0 }]);
    });
  });
});

describe("the monitor reports append overage", () => {
  it("in whole thousands beyond the included, once; a replayed run sends no duplicate", async () => {
    const { row, period, object } = await activeTeam(true);
    const run = monitorOf(row.slug);
    await object.recordAppends(INCLUDED + 60_500);
    const { calls } = outbound();
    await run();
    await run();
    const [first, ...more] = meterEvents(calls, row.tenant_id);
    expect(more).toEqual([]);
    expect(Object.fromEntries(first.form)).toEqual({
      event_name: "citadel_document_appends",
      "payload[stripe_customer_id]": "cus_test_1",
      "payload[value]": "60",
      identifier: `document-appends-${row.tenant_id}-${period.start}-0-60`,
    });
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({
      appends: INCLUDED + 60_500, appends_included: INCLUDED, appends_overage: 60, appends_overage_reported: 60, appends_overage_pending: null,
      overage_gb: 0, overage_gb_reported: 0,
    });
    await object.recordAppends(5_000);
    await run();
    expect(meterEvents(calls, row.tenant_id).map((e) => [e.form.get("payload[value]"), e.form.get("identifier")]).at(-1))
      .toEqual(["5", `document-appends-${row.tenant_id}-${period.start}-60-65`]);
  });

  it("a report Stripe refused is re-sent identically by the next run", async () => {
    const { row, period, object } = await activeTeam(true);
    const run = monitorOf(row.slug);
    await object.recordAppends(INCLUDED + 50_000);
    const { calls } = outbound({ meterEvents: { failures: 1 } });
    await expect(run()).rejects.toThrow(/1 tenant\(s\) failed/);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ appends_overage_reported: 0, appends_overage_pending: 50 });
    await run();
    expect(meterEvents(calls, row.tenant_id).map((e) => e.form.get("identifier"))).toEqual([
      `document-appends-${row.tenant_id}-${period.start}-0-50`, `document-appends-${row.tenant_id}-${period.start}-0-50`,
    ]);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ appends_overage_reported: 50, appends_overage_pending: null });
  });

  it("sends nothing below pricing-model.json's forgiven minimum", async () => {
    const { row, period, object } = await activeTeam(true);
    await object.recordAppends(INCLUDED + 49_999);
    const { calls } = outbound();
    await monitorOf(row.slug)();
    expect(meterEvents(calls, row.tenant_id)).toEqual([]);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ appends_overage: 49, appends_overage_reported: 0, appends_overage_pending: null });
  });

  it("sends nothing for a tenant whose owner chose no overage billing, though it records the overage", async () => {
    const { row, period, object } = await activeTeam(false);
    await object.recordAppends(INCLUDED + 80_000);
    const { calls } = outbound();
    await monitorOf(row.slug)();
    expect(meterEvents(calls, row.tenant_id)).toEqual([]);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ appends_overage: 80, appends_overage_reported: 0, appends_overage_pending: null });
  });

  it("sends nothing while overage billing is off, even with a usage subscription still on the row", async () => {
    // A row the switch has not finished with: off, but its usage subscription id still recorded.
    const { row, period, object } = await activeTeam(false);
    await env.CONTROL_DB.prepare("UPDATE tenants SET usage_subscription = 'sub_stale' WHERE slug = ?").bind(row.slug).run();
    await object.recordAppends(INCLUDED + 80_000);
    const { calls } = outbound();
    await monitorOf(row.slug)();
    expect(meterEvents(calls, row.tenant_id)).toEqual([]);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ appends_overage: 80, appends_overage_reported: 0 });
  });
});
