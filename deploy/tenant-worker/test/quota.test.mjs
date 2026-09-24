/**
 * Metering and limits in the real tenant object, over real sockets through the Worker: the
 * connection cap, the frame cap, the flush alarm and the period rollover. Limits are set small
 * through the object's own `setEntitlements` RPC, the way the control plane sets them.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { freeTenant, objectStats, openSocket, unfinishedFrame, until } from "./helpers.mjs";

async function limit(slug, object, overrides) {
  const { entitlements } = await objectStats(slug);
  await object.setEntitlements({ ...entitlements, ...overrides });
}

const rows = (object) => runInDurableObject(object, (_i, state) => [...state.storage.sql.exec("SELECT * FROM quota_usage ORDER BY period_start")]);
const openCount = async (slug) => (await objectStats(slug)).connections.length;

describe("connection cap", () => {
  it("refuses the socket past the cap with 503 connection-limit, and a released one frees its place", async () => {
    const { slug, object } = await freeTenant("cap");
    await limit(slug, object, { connections_max: 2 });
    const a = await openSocket(slug);
    const b = await openSocket(slug);
    expect(a.ws && b.ws).toBeTruthy();
    const c = await openSocket(slug);
    expect(c.refused.status).toBe(503);
    expect(c.refused.headers.get("retry-after")).toBe("30");
    expect(await c.refused.json()).toMatchObject({ error: "connection-limit" });
    expect((await objectStats(slug)).accepted).toBe(2);

    a.ws.close(1000, "done");
    await until("the closed socket to be released", async () => (await openCount(slug)) === 1);
    const d = await openSocket(slug);
    expect(d.ws).toBeTruthy();
    expect(await openCount(slug)).toBe(2);
    b.ws.close(1000, "done");
    d.ws.close(1000, "done");
  });

  it("an object provisioned before limits existed enforces what its plan grants, with no monitor run", async () => {
    // Old-shape entitlements (before connections_max, relay, frame cap and period), for 1 Team seat.
    const { slug, object } = await freeTenant("old");
    const old = { status: "active", tier: "team", interval: "month", seats: 1, storage_blocks: 0, members_max: 1, storage_gb: 10, workspaces_max: 1, priority_support: false };
    await object.setEntitlements(old);
    const open = [];
    for (let i = 0; i < 3; i++) open.push(await openSocket(slug)); // 3 per Team seat
    expect(open.every((s) => s.ws)).toBe(true);
    const fourth = await openSocket(slug);
    expect(fourth.refused.status).toBe(503);
    expect(await fourth.refused.json()).toMatchObject({ error: "connection-limit", detail: "this workspace allows 3 connections at once" });
    for (const s of open) s.ws.close(1000, "done");
  });
});

describe("frame cap", () => {
  it("a message over the cap closes the socket with 1009; one at the cap is counted", async () => {
    const { slug, object } = await freeTenant("frm");
    await limit(slug, object, { max_frame_bytes: 1024 });
    const s = await openSocket(slug);
    s.ws.send(unfinishedFrame(1024));
    await until("1024 bytes in", async () => (await objectStats(slug)).usage.bytes_in === 1024);
    s.ws.send(new Uint8Array(1025));
    expect((await s.closed).code).toBe(1009);
    await until("the socket to be released", async () => (await openCount(slug)) === 0);
    expect((await objectStats(slug)).usage.bytes_in).toBe(1024);
  });
});

describe("flush and rollover", () => {
  it("the alarm writes the period's absolute totals: twice is the same row", async () => {
    const { slug, object } = await freeTenant("fl");
    const s = await openSocket(slug);
    s.ws.send(unfinishedFrame(700));
    await until("700 bytes in", async () => (await objectStats(slug)).usage.bytes_in === 700);
    expect(await rows(object)).toEqual([]); // not written per frame

    expect(await runDurableObjectAlarm(object)).toBe(true);
    const first = await rows(object);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ bytes_in: 700, frames_in: 1, peak_connections: 1 });

    expect(await runDurableObjectAlarm(object)).toBe(true); // re-armed while the socket is open
    const second = await rows(object);
    expect(second).toHaveLength(1);
    expect(second[0]).toMatchObject({ bytes_in: 700, frames_in: 1 });

    s.ws.close(1000, "done");
    await until("the socket to be released", async () => (await openCount(slug)) === 0);
    expect(await runDurableObjectAlarm(object)).toBe(true);
    // No socket open: the alarm is not re-armed.
    expect(await runDurableObjectAlarm(object)).toBe(false);
  });

  it("a billing period that ends closes its row and opens the next, once", async () => {
    const { slug, object } = await freeTenant("ro");
    const now = Math.floor(Date.now() / 1000);
    const ending = { period_start: now - 100, period_end: now + 2 };
    await limit(slug, object, ending);
    const s = await openSocket(slug);
    s.ws.send(unfinishedFrame(300));
    await until("300 bytes in", async () => (await objectStats(slug)).usage.bytes_in === 300);
    await until("the period to end", async () => Date.now() / 1000 > ending.period_end + 0.2, 4000);

    expect(await runDurableObjectAlarm(object)).toBe(true);
    const next = { period_start: ending.period_end, period_end: ending.period_end + 102 };
    const byStart = (all) => Object.fromEntries(all.map((r) => [r.period_start, r]));
    const after = byStart(await rows(object));
    expect(after[ending.period_start]).toMatchObject({ period_end: ending.period_end, bytes_in: 300 });
    expect(after[next.period_start]).toMatchObject({ period_end: next.period_end, bytes_in: 0, peak_connections: 1 });

    s.ws.send(unfinishedFrame(10));
    await until("10 more bytes", async () => (await objectStats(slug)).usage.bytes_in === 10);
    expect(await runDurableObjectAlarm(object)).toBe(true);
    const again = byStart(await rows(object));
    expect(again[ending.period_start].bytes_in).toBe(300);
    expect(again[next.period_start].bytes_in).toBe(10);
    s.ws.close(1000, "done");
  });
});
