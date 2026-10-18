/** The purge at the end of dunning, through the real Worker, D1 and tenant object. */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { purgeTenant } from "../control/purge.mjs";
import { createBody, deliver, get, monitorOf, outbound, post, tenantObject, tenantRow } from "./helpers.mjs";
import { age, dunningRow, invoiceEvent, now, objectState, paidTenant, purgeRow } from "./dunning-fixtures.mjs";


/** A paid tenant in dunning whose grace period ran out a second ago, with a usage row to delete. */
async function overdue(stem) {
  const t = await paidTenant(stem);
  outbound();
  expect((await deliver(invoiceEvent("invoice.payment_failed", t.row, t.subId))).status).toBe(200);
  const { purge_at } = await dunningRow(t.row.tenant_id);
  await age(t.row.tenant_id, purge_at - now() + 1);
  await env.CONTROL_DB.prepare(
    "INSERT INTO tenant_usage (tenant_id, period_start, period_end, bytes_in, bytes_out, frames_in, active_seconds, peak_connections, relay_gb_included, overage_gb, sampled_at) VALUES (?, 1, 2, 0, 0, 0, 0, 0, 0, 0, 0)",
  ).bind(t.row.tenant_id).run();
  return t;
}

const count = async (table, tenantId) => (await env.CONTROL_DB.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE tenant_id = ?`).bind(tenantId).first()).n;
const objectRecord = async (slug) => (await objectState(slug)).stored;
const upgrade = (slug) => tenantObject(slug).fetch(new Request(`http://127.0.0.1/${slug}`, { headers: { upgrade: "websocket" } }));

describe("the purge", () => {
  it("runs from the monitor once grace is over: object erased, rows deleted, slug released, audit kept", async () => {
    const { slug, row } = await overdue("pg");
    expect(await objectRecord(slug)).toMatchObject({ tenant_id: row.tenant_id });
    await monitorOf(slug)();
    expect(await tenantRow(slug)).toBeNull();
    const audit = await purgeRow(row.tenant_id);
    expect(audit).toMatchObject({ slug, steps: JSON.stringify(["object", "usage", "registry"]) });
    expect(audit.finished_at).toBeGreaterThanOrEqual(audit.started_at);
    for (const table of ["tenant_dunning", "tenant_usage", "tenant_alerts"]) expect(await count(table, row.tenant_id)).toBe(0);
    // The object: nothing provisioned, 503 to a socket, and no stored rows of any kind.
    expect(await objectState(slug)).toEqual({ ready: false, entitlements: null, stored: null });
    const r = await upgrade(slug);
    expect(r.status).toBe(503);
    expect(await r.text()).toBe("this workspace has not been provisioned");
    expect((await (await get(`/api/slug/${slug}`)).json())).toEqual({ slug, available: true });
  });

  it("releases the slug for a new workspace, which starts from nothing", async () => {
    const { slug, row } = await overdue("pn");
    await monitorOf(slug)();
    outbound();
    const r = await post("/api/tenants", createBody(slug));
    expect(r.status).toBe(201);
    const fresh = await tenantRow(slug);
    expect(fresh.tenant_id).not.toBe(row.tenant_id);
    expect(await objectRecord(slug)).toMatchObject({ tenant_id: fresh.tenant_id, started: false });
  });

  it("a purge interrupted after the object resumes at usage, and does not touch the object again", async () => {
    const { slug, row } = await overdue("pr");
    await env.CONTROL_DB.prepare("INSERT INTO tenant_purges (tenant_id, slug, started_at, steps) VALUES (?, ?, ?, ?)")
      .bind(row.tenant_id, slug, now() - 60, JSON.stringify(["object"])).run();
    await monitorOf(slug)();
    expect(JSON.parse((await purgeRow(row.tenant_id)).steps)).toEqual(["object", "usage", "registry"]);
    expect(await tenantRow(slug)).toBeNull();
    expect(await count("tenant_usage", row.tenant_id)).toBe(0);
    // The object step was recorded as done, so it was not run: the object still holds its record.
    expect(await objectRecord(slug)).toMatchObject({ tenant_id: row.tenant_id });
  });

  it("a purge that died after usage (no dunning row left) is resumed by the monitor from its audit", async () => {
    const { slug, row } = await overdue("pu");
    await env.CONTROL_DB.prepare("DELETE FROM tenant_dunning WHERE tenant_id = ?").bind(row.tenant_id).run();
    await env.CONTROL_DB.prepare("INSERT INTO tenant_purges (tenant_id, slug, started_at, steps) VALUES (?, ?, ?, ?)")
      .bind(row.tenant_id, slug, now() - 60, JSON.stringify(["object", "usage"])).run();
    await monitorOf(slug)();
    expect(await tenantRow(slug)).toBeNull();
    expect((await purgeRow(row.tenant_id)).finished_at).not.toBeNull();
  });

  it("is idempotent: run again after the slug was reused, it touches nothing of the new workspace", async () => {
    const { slug, row } = await overdue("pi");
    const io = ioFor(env);
    await purgeTenant(io, row, now());
    outbound();
    expect((await post("/api/tenants", createBody(slug))).status).toBe(201);
    const fresh = await tenantRow(slug);
    await purgeTenant(io, row, now());
    expect(await tenantRow(slug)).toMatchObject({ tenant_id: fresh.tenant_id, status: "active" });
    expect(await objectRecord(slug)).toMatchObject({ tenant_id: fresh.tenant_id });
  });

  it("a payment that arrives once the purge has begun opens nothing", async () => {
    const { slug, row, subId } = await overdue("pp");
    await env.CONTROL_DB.prepare("INSERT INTO tenant_purges (tenant_id, slug, started_at, steps) VALUES (?, ?, ?, ?)")
      .bind(row.tenant_id, slug, now() - 60, JSON.stringify(["object"])).run();
    outbound();
    const r = await deliver(invoiceEvent("invoice.paid", row, subId));
    expect(await r.json()).toMatchObject({ applied: false, note: "paid after the purge began" });
    expect((await tenantRow(slug)).status).toBe("suspended");
  });

  it("the object refuses a purge for a tenant it does not serve, and keeps everything", async () => {
    const t = await paidTenant("pw");
    const refused = await tenantObject(t.slug).purge("not-this-tenant").then(() => null, (e) => e);
    expect(String(refused)).toMatch(/serves tenant/);
    expect(await objectRecord(t.slug)).toMatchObject({ tenant_id: t.row.tenant_id });
  });

  it("is not run before purge_at, nor for a workspace that paid", async () => {
    const t = await paidTenant("pe");
    outbound();
    await deliver(invoiceEvent("invoice.payment_failed", t.row, t.subId));
    await monitorOf(t.slug)();
    expect(await tenantRow(t.slug)).not.toBeNull();
    expect(await purgeRow(t.row.tenant_id)).toBeNull();
    const { purge_at } = await dunningRow(t.row.tenant_id);
    await age(t.row.tenant_id, purge_at - now() + 1);
    await deliver(invoiceEvent("invoice.paid", t.row, t.subId));
    await monitorOf(t.slug)();
    expect((await tenantRow(t.slug)).status).toBe("active");
    expect(await purgeRow(t.row.tenant_id)).toBeNull();
  });
});
