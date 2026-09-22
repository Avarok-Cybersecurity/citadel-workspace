/**
 * The usage monitor (control/monitor.mjs) against the real registry and real tenant objects. The
 * one mock is Stripe at the fetch boundary (helpers.mjs `outbound`), as everywhere in this suite.
 * Usage is put into an object's own meter, the counter its sockets feed: relaying 150 GB through
 * a test socket is not a unit test.
 */
import { createScheduledController, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker from "../worker.mjs";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { runMonitor } from "../control/monitor.mjs";
import {
  createBody, deliver, freeTenant, freshSlug, item, objectStats, outbound, post, subscriptionEvent, tenantObject, tenantRow,
} from "./helpers.mjs";

const now = () => Math.floor(Date.now() / 1000);

/** An active Team tenant (3 seats: 150 GB of relay included) with a Stripe period holding now. */
async function activeTeam() {
  const slug = freshSlug("mon");
  outbound();
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3 }))).status).toBe(201);
  const row = await tenantRow(slug);
  const period = { start: now() - 86400, end: now() + 29 * 86400 };
  const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 3)], period });
  expect((await deliver(event)).status).toBe(200);
  return { row: await tenantRow(slug), period };
}

/** `bytes` more inbound on the object's meter, through a connection opened and closed for it. */
const relay = (slug, bytes) =>
  runInDurableObject(tenantObject(slug), (instance) => {
    const id = `injected-${crypto.randomUUID()}`;
    instance.meter.connect(id, Date.now());
    instance.meter.inbound(id, bytes);
    instance.meter.disconnect(id, Date.now());
  });

/** The monitor over these tenants only: the suite's D1 holds every other test's tenants too. */
function monitorOf(...slugs) {
  const io = ioFor(env);
  const only = { ...io, store: Object.assign(Object.create(io.store), { active: async () => (await io.store.active()).filter((r) => slugs.includes(r.slug)) }) };
  return () => runMonitor(only, config(env));
}

const meterEvents = (calls, tenantId) =>
  calls.filter((c) => c.url === "https://api.stripe.com/v1/billing/meter_events" && c.form.get("identifier").includes(tenantId));
const usageRow = (tenantId, start) => env.CONTROL_DB.prepare("SELECT * FROM tenant_usage WHERE tenant_id = ? AND period_start = ?").bind(tenantId, start).first();

describe("the webhook stores the billing period", () => {
  it("from the items (current API) or the subscription (older), and the object meters by it", async () => {
    const { row, period } = await activeTeam();
    expect(row).toMatchObject({ period_start: period.start, period_end: period.end });
    const stats = await objectStats(row.slug);
    expect(stats.entitlements).toMatchObject({ period_start: period.start, period_end: period.end });
    expect(stats.usage).toMatchObject({ period_start: period.start, period_end: period.end });

    const renewed = { start: period.end, end: period.end + 30 * 86400 };
    const event = subscriptionEvent("customer.subscription.updated", row, {
      id: `evt_${crypto.randomUUID()}`, created: now() + 1, items: [item("citadel-team-month", 3)], period: renewed, periodOnSubscription: true,
    });
    expect((await deliver(event)).status).toBe(200);
    expect(await tenantRow(row.slug)).toMatchObject({ period_start: renewed.start, period_end: renewed.end });
  });
});

describe("the monitor", () => {
  it("reports whole GB over the included relay once, and only what is new on later runs", async () => {
    const { row, period } = await activeTeam();
    const run = monitorOf(row.slug);
    await relay(row.slug, 152.5e9);
    const { calls } = outbound();
    await run();
    const [first, ...more] = meterEvents(calls, row.tenant_id);
    expect(more).toEqual([]);
    expect(Object.fromEntries(first.form)).toEqual({
      event_name: "citadel_relay_gb",
      "payload[stripe_customer_id]": "cus_test_1",
      "payload[value]": "2",
      identifier: `relay-${row.tenant_id}-${period.start}-0-2`,
    });
    expect(first.headers["idempotency-key"]).toBe(first.form.get("identifier"));
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({
      bytes_in: 152.5e9, relay_gb_included: 150, overage_gb: 2, overage_gb_reported: 2, overage_gb_pending: null, period_end: period.end,
    });

    await run();
    expect(meterEvents(calls, row.tenant_id)).toHaveLength(1);

    await relay(row.slug, 1e9);
    await run();
    const events = meterEvents(calls, row.tenant_id);
    expect(events).toHaveLength(2);
    expect([events[1].form.get("payload[value]"), events[1].form.get("identifier")]).toEqual(["1", `relay-${row.tenant_id}-${period.start}-2-3`]);
  });

  it("a report Stripe refused is not recorded, and the next run sends the identical one", async () => {
    const { row, period } = await activeTeam();
    const run = monitorOf(row.slug);
    await relay(row.slug, 151e9);
    const { calls } = outbound({ meterEvents: { failures: 1 } });
    await expect(run()).rejects.toThrow(/1 tenant\(s\) failed/);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ overage_gb_reported: 0, overage_gb_pending: 1 });

    await relay(row.slug, 1e9); // more usage meanwhile: the report in flight is finished first, unchanged
    await run();
    const events = meterEvents(calls, row.tenant_id);
    expect(events.map((e) => [e.form.get("identifier"), e.form.get("payload[value]")])).toEqual([
      [`relay-${row.tenant_id}-${period.start}-0-1`, "1"],
      [`relay-${row.tenant_id}-${period.start}-0-1`, "1"],
    ]);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ overage_gb: 2, overage_gb_reported: 1, overage_gb_pending: null });
    await run();
    expect(meterEvents(calls, row.tenant_id).at(-1).form.get("identifier")).toBe(`relay-${row.tenant_id}-${period.start}-1-2`);
  });

  it("records a free tenant's overage without billing it", async () => {
    const { slug } = await freeTenant("monf");
    const row = await tenantRow(slug);
    await relay(slug, 7e9);
    const { calls } = outbound();
    await monitorOf(slug)();
    expect(meterEvents(calls, row.tenant_id)).toEqual([]);
    const sampled = await env.CONTROL_DB.prepare("SELECT * FROM tenant_usage WHERE tenant_id = ?").bind(row.tenant_id).all();
    expect(sampled.results.map((r) => [r.bytes_in, r.relay_gb_included, r.overage_gb, r.overage_gb_reported])).toEqual([[7e9, 5, 2, 0]]);
  });

  it("gives an object whose entitlements drifted what the registry says", async () => {
    const { row } = await activeTeam();
    const object = tenantObject(row.slug);
    const { entitlements } = await objectStats(row.slug);
    await object.setEntitlements({ ...entitlements, connections_max: 1, seats: 1 });
    outbound();
    await monitorOf(row.slug)();
    expect((await objectStats(row.slug)).entitlements).toEqual(entitlements);
  });

  it("is what the Worker's Cron trigger runs", async () => {
    const { row, period } = await activeTeam();
    await relay(row.slug, 1e9);
    outbound();
    await worker.scheduled(createScheduledController({ cron: "*/15 * * * *", scheduledTime: Date.now() }), env);
    expect(await usageRow(row.tenant_id, period.start)).toMatchObject({ bytes_in: 1e9, overage_gb: 0 });
  });
});
