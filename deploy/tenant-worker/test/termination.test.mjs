/**
 * Overage-off terminations (control/termination.mjs, control/tenant-billing.mjs): the pure rule,
 * then the real tenant object reached through runInDurableObject, its relay minter and its
 * documents gate. Usage is put into the object's own meter (helpers.mjs `relay`); the clock the
 * object judges terminations by is its injected `billing.io.nowMs`, moved by the test. The only
 * mock is the fetch boundary (Stripe, TURN), as everywhere in this suite.
 */
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { UNAVAILABLE } from "../control/ice.mjs";
import { POLICY, TERMINATION_TTL_MS, WARN_PERCENT } from "../control/policy.mjs";
import { alertLevelOf, terminationOf } from "../control/termination.mjs";
import { createBody, deliver, freeTenant, freshSlug, item, objectStats, outbound, post, relay, subscriptionEvent, tenantObject, tenantRow } from "./helpers.mjs";

const TTL_HOURS = POLICY.overage_billing.termination_ttl_hours;
const TTL_MS = TERMINATION_TTL_MS;
const T0 = Date.UTC(2026, 9, 18, 12);
const now = () => Math.floor(Date.now() / 1000);
const judge = (over) => terminationOf({ used: 0, included: 100, overage_billing: false, crossed_at: null, now_ms: T0, ttl_hours: TTL_HOURS, ...over });

describe("terminationOf", () => {
  it("ok below the warn share, warn from it, and the TTL from the crossing with overage off", () => {
    expect(judge({ used: WARN_PERCENT - 0.01 })).toEqual({ state: "ok" });
    expect(judge({ used: WARN_PERCENT })).toEqual({ state: "warn" });
    expect(judge({ used: 100, crossed_at: T0 })).toEqual({ state: "terminating", terminate_at: T0 + TTL_MS });
    expect(judge({ used: 100, crossed_at: T0, now_ms: T0 + TTL_MS - 1 }).state).toBe("terminating");
    expect(judge({ used: 100, crossed_at: T0, now_ms: T0 + TTL_MS })).toEqual({ state: "terminated", terminate_at: T0 + TTL_MS });
  });

  it("with overage on, past the quota is over, never a termination", () => {
    expect(judge({ used: 500, overage_billing: true, crossed_at: T0 - 10 * TTL_MS })).toEqual({ state: "over" });
  });

  it("refuses to guess: no crossing time, no TTL, no overage choice", () => {
    expect(() => judge({ used: 100 })).toThrow(/crossed_at/);
    expect(() => judge({ ttl_hours: undefined })).toThrow(/ttl_hours/);
    expect(() => judge({ overage_billing: 0 })).toThrow(/overage_billing/);
  });

  it("the public level is the worst state, with no numbers", () => {
    const of = (...states) => alertLevelOf({ dimensions: states.map((state, i) => ({ id: `d${i}`, state, used: 7 })) });
    expect(of("ok", "ok")).toBe("none");
    expect(of("ok", "warn", "over")).toBe("over");
    expect(of("terminated", "warn")).toBe("terminated");
    expect(of("terminating", "over")).toBe("terminating");
    expect(() => of("bogus")).toThrow(/no known state/);
  });
});

/** An active Team tenant, 3 seats (60 GB relay included), overage billing as the row says (off). */
async function activeTeam() {
  const slug = freshSlug("term");
  outbound();
  expect((await post("/api/tenants", createBody(slug, { tier: "team", interval: "month", seats: 3 }))).status).toBe(201);
  const row = await tenantRow(slug);
  const period = { start: now() - 86400, end: now() + 29 * 86400 };
  const event = subscriptionEvent("customer.subscription.created", row, { id: `evt_${crypto.randomUUID()}`, created: now(), items: [item("citadel-team-month", 3)], period });
  expect((await deliver(event)).status).toBe(200);
  return { slug, object: tenantObject(slug) };
}

/** Puts the object's billing clock on `clock.now`; returns the dimension `id` as the object reports it. */
const onClock = (object, clock) => runInDurableObject(object, (i) => { i.billing.io.nowMs = () => clock.now; });
const dimension = async (object, id) => (await object.meters()).dimensions.find((d) => d.id === id);
const mint = (object) => runInDurableObject(object, (i) => i.ice.mint("alice"));
const setPlan = async (slug, object, overrides) => object.setEntitlements({ ...(await objectStats(slug)).entitlements, ...overrides });

describe("the tenant object, overage billing off", () => {
  it("crossing the relay quota counts down the TTL, then refuses relay until the period resets", async () => {
    const { slug, object } = await activeTeam();
    const clock = { now: T0 };
    await onClock(object, clock);
    await relay(slug, 60e9 - 1);
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "warn", terminate_at: null, included: 60, unit: "GB" });

    await relay(slug, 1);
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "terminating", terminate_at: T0 + TTL_MS });
    outbound();
    expect((await mint(object)).ice_servers).toBeDefined(); // a paid plan's relay runs until the TTL

    clock.now = T0 + TTL_MS - 1;
    expect((await dimension(object, "relay-overage")).state).toBe("terminating");
    clock.now = T0 + TTL_MS;
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "terminated", terminate_at: T0 + TTL_MS });
    expect(await mint(object)).toEqual({ unavailable: UNAVAILABLE.relayTerminated });
    // The monitor's usage read reports the same, and the crossing is the object's own, stored once.
    expect((await object.usage()).dimensions.find((d) => d.id === "relay-overage").state).toBe("terminated");
    const stored = await runInDurableObject(object, (_i, state) => state.storage.get("billing:crossed"));
    expect(stored.crossed).toEqual({ "relay-overage": T0 });

    // A new billing period: the crossing is forgotten and relay is back.
    await setPlan(slug, object, { period_start: now() - 10, period_end: now() + 30 * 86400 });
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "ok", used: 0, terminate_at: null });
    expect((await mint(object)).ice_servers).toBeDefined();

    // Crossed again in the new period: counted from this crossing, not the last period's.
    clock.now = T0 + 5 * TTL_MS;
    await relay(slug, 60e9);
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "terminating", terminate_at: T0 + 6 * TTL_MS });
  });

  it("with overage billing on, past the quota is over and relay is allowed", async () => {
    const { slug, object } = await activeTeam();
    const clock = { now: T0 };
    await onClock(object, clock);
    await setPlan(slug, object, { overage_billing: true });
    await relay(slug, 90e9);
    clock.now = T0 + 10 * TTL_MS;
    expect(await dimension(object, "relay-overage")).toMatchObject({ state: "over", terminate_at: null });
    outbound();
    expect((await mint(object)).ice_servers).toBeDefined();
  });

  it("document appends past the quota become read-only after the TTL", async () => {
    const { slug, object } = await activeTeam();
    const clock = { now: T0 };
    await onClock(object, clock);
    const { included } = await dimension(object, "document-appends");
    expect(included).toBe(3 * 250000);
    await runInDurableObject(object, (i) => i.meter.appended(included));
    expect(await dimension(object, "document-appends")).toMatchObject({ state: "terminating", terminate_at: T0 + TTL_MS });
    expect(await object.documentsWritable()).toBe(true);
    clock.now = T0 + TTL_MS;
    expect(await object.documentsWritable()).toBe(false);
    outbound();
    expect((await mint(object)).ice_servers).toBeDefined(); // relay is its own dimension
  });

  it("storage is reported against the plan's bytes and never terminated", async () => {
    const { object } = await activeTeam();
    const storage = await dimension(object, "storage");
    expect(storage.unit).toBe("bytes");
    expect(storage.used).toBeGreaterThan(0);
    expect(storage.included).toBe(3 * 2 * 1e9);
    expect(storage.terminate_at).toBeNull();
  });

  it("a free tenant keeps its old rule: refused at the quota at once, before any TTL", async () => {
    const { slug, object } = await freeTenant("termf");
    const clock = { now: T0 };
    await onClock(object, clock);
    await relay(slug, 2e9);
    expect((await dimension(object, "relay-overage")).state).toBe("terminating");
    outbound();
    expect(await mint(object)).toEqual({ unavailable: UNAVAILABLE.relayUsed });
  });
});
