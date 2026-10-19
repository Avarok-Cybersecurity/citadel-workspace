/**
 * Usage alerts (control/alerts.mjs) through the real monitor, registry and tenant objects. The
 * mocks are the fetch boundary only: Stripe (the customer's address) and the MAIL_ENDPOINT sink
 * (helpers.mjs `outbound`), as everywhere in this suite.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { POLICY } from "../control/policy.mjs";
import {
  createBody, customerEmail, deliver, freeTenant, freshSlug, item, mailsIn, monitorOf, outbound, post, relay, subscriptionEvent, tenantRow,
} from "./helpers.mjs";

const [P1, , P3] = POLICY.alerts.usage_percent;
const [C1] = POLICY.alerts.countdown_hours;
const now = () => Math.floor(Date.now() / 1000);

/** An active Team tenant, 3 seats (60 GB relay included), overage billing off: crossings count down. */
async function activeTeam() {
  const slug = freshSlug("alr");
  outbound();
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3, overage_billing: false }))).status).toBe(201);
  const row = await tenantRow(slug);
  const period = { start: now() - 86400, end: now() + 29 * 86400 };
  const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 3)], period });
  expect((await deliver(event)).status).toBe(200);
  return { row: await tenantRow(slug), period };
}

const recorded = async (tenantId) =>
  (await env.CONTROL_DB.prepare("SELECT dimension, threshold FROM tenant_alerts WHERE tenant_id = ? ORDER BY sent_at, threshold").bind(tenantId).all())
    .results.map((r) => `${r.dimension} ${r.threshold}`);
const mailsFor = (calls, slug) => mailsIn(calls).filter((m) => m.subject.includes(slug));

describe("usage alerts", () => {
  it("emails each threshold once per period to the Stripe customer's address", async () => {
    const { row } = await activeTeam();
    const run = monitorOf(row.slug);
    await relay(row.slug, 30e9); // P1 of the 60 GB included
    const { calls } = outbound();
    await run();
    const first = mailsFor(calls, row.slug);
    expect(first.map((m) => m.subject)).toEqual([`Citadel Workspace ${row.slug}: ${P1}% of the included relay used`]);
    expect(first[0].to).toEqual([customerEmail("cus_test_1")]);
    expect(calls.some((c) => c.url === "https://api.stripe.com/v1/customers/cus_test_1" && c.method === "GET")).toBe(true);
    expect(await recorded(row.tenant_id)).toEqual([`relay-overage percent:${P1}`]);

    await run();
    expect(mailsFor(calls, row.slug)).toHaveLength(1);

    await relay(row.slug, 30e9); // the quota, overage billing off: the countdown starts
    await run();
    const crossed = mailsFor(calls, row.slug).slice(1).map((m) => m.subject);
    expect(crossed).toEqual([
      `Citadel Workspace ${row.slug}: ${P3}% of the included relay used`,
      `Citadel Workspace ${row.slug}: relay stops in ${C1} hours`,
    ]);
    expect(mailsFor(calls, row.slug).at(-1).text).toContain(POLICY.overage_billing.terminated_service["relay-overage"]);
    await run();
    expect(mailsFor(calls, row.slug)).toHaveLength(3);
  });

  it("a send the mail service refused is not recorded, and the next run sends it", async () => {
    const { row } = await activeTeam();
    const run = monitorOf(row.slug);
    await relay(row.slug, 30e9);
    const refused = outbound({ mailStatus: 500 });
    await expect(run()).rejects.toThrow(/mail sink answered 500/);
    expect(mailsFor(refused.calls, row.slug)).toHaveLength(1);
    expect(await recorded(row.tenant_id)).toEqual([]);

    const { calls } = outbound();
    await run();
    expect(mailsFor(calls, row.slug).map((m) => m.subject)).toEqual([`Citadel Workspace ${row.slug}: ${P1}% of the included relay used`]);
    expect(await recorded(row.tenant_id)).toEqual([`relay-overage percent:${P1}`]);
  });

  it("with overage billing on, announces each overage step instead of a countdown", async () => {
    const { row } = await activeTeam();
    await env.CONTROL_DB.prepare("UPDATE tenants SET overage_billing = 1 WHERE slug = ?").bind(row.slug).run();
    const step = POLICY.alerts.overage_step_units["relay-overage"];
    await relay(row.slug, (60 + step) * 1e9);
    const { calls } = outbound();
    await monitorOf(row.slug)(); // the drift repair gives the object the registry's choice first
    expect(mailsFor(calls, row.slug).map((m) => m.subject)).toEqual([
      `Citadel Workspace ${row.slug}: ${P3}% of the included relay used`,
      `Citadel Workspace ${row.slug}: relay overage passed ${step} GB`,
    ]);
  });

  it("a workspace with no Stripe customer (Free) is told in-app only: recorded, nothing mailed", async () => {
    const { slug } = await freeTenant("alrf");
    const row = await tenantRow(slug);
    await relay(slug, 1e9);
    const { calls } = outbound();
    await monitorOf(slug)();
    expect(mailsIn(calls)).toEqual([]);
    expect(calls.filter((c) => c.url.startsWith("https://api.stripe.com/v1/customers/"))).toEqual([]);
    expect(await recorded(row.tenant_id)).toEqual([`relay-overage percent:${P1}`]);
  });
});
