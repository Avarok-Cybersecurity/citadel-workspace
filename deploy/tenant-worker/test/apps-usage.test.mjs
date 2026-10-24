/**
 * What apps cost the tenant (control/apps-usage.mjs, control/meter.mjs): server egress counts
 * against the relay quota, a relayed iHTTP frame is recorded apart and never billed a second
 * time, and the quota's fields are tiers.json's alone.
 */
import { describe, expect, it } from "vitest";
import { Meter, RELAY_QUOTA_FIELDS, relayBytes } from "../control/meter.mjs";
import { APP_USAGE_KINDS, AppsUsageIntake } from "../control/apps-usage.mjs";
import tiers from "../../../billing/tiers.json";
import usageRs from "../server-wasm/src/usage.rs?raw";

const T0 = Date.UTC(2026, 9, 24, 12, 0, 0);
const fresh = () => new Meter({ start: T0 / 1000 - 3600, end: T0 / 1000 + 3600, fallback: false }, null, T0);

describe("app usage in the meter", () => {
  it("server egress is relay: it raises the quota's bytes by what it brought in", () => {
    const m = fresh();
    const before = relayBytes(m.snapshot(T0));
    m.appEgress(5);
    expect(m.snapshot(T0)).toMatchObject({ app_egress_bytes: 5, app_relay_ihttp_bytes: 0 });
    expect(relayBytes(m.snapshot(T0))).toBe(before + 5);
  });

  it("a relayed iHTTP frame is recorded, and the quota is unchanged: its bytes are already bytes_in", () => {
    const m = fresh();
    const before = relayBytes(m.snapshot(T0));
    m.appRelay(7);
    expect(m.snapshot(T0)).toMatchObject({ app_relay_ihttp_bytes: 7, app_egress_bytes: 0 });
    expect(relayBytes(m.snapshot(T0))).toBe(before);
  });

  it("resumes both from the persisted period", () => {
    const m = new Meter({ start: 0, end: 1e12, fallback: false }, { app_egress_bytes: 3, app_relay_ihttp_bytes: 4 }, T0);
    m.appEgress(1);
    m.appRelay(1);
    expect(m.snapshot(T0)).toMatchObject({ app_egress_bytes: 4, app_relay_ihttp_bytes: 5 });
  });
});

describe("the intake the node calls", () => {
  it("counts each kind into the object's current meter", () => {
    let m = fresh();
    const intake = new AppsUsageIntake(() => m);
    intake.add("EgressIn", 11);
    intake.add("RelayIhttp", 13);
    expect(m.snapshot(T0)).toMatchObject({ app_egress_bytes: 11, app_relay_ihttp_bytes: 13 });
    m = fresh(); // the period rolled: the next use goes to the new meter
    intake.add("EgressIn", 2);
    expect(m.snapshot(T0)).toMatchObject({ app_egress_bytes: 2 });
  });

  it("refuses a kind it does not know and a count that is not whole bytes, counting nothing", () => {
    const m = fresh();
    const intake = new AppsUsageIntake(() => m);
    expect(() => intake.add("TurnBytes", 1)).toThrow(/no app usage kind/);
    expect(() => intake.add("toString", 1)).toThrow(/no app usage kind/);
    for (const bad of [-1, 1.5, Number.NaN, 2 ** 53, "7", undefined]) expect(() => intake.add("EgressIn", bad)).toThrow(/byte count/);
    expect(m.snapshot(T0)).toMatchObject({ app_egress_bytes: 0, app_relay_ihttp_bytes: 0 });
  });

  it("knows exactly the kinds the wasm meter sends (server-wasm usage.rs)", () => {
    const sent = [...usageRs.matchAll(/Usage::\w+ => "(\w+)"/g)].map((m) => m[1]);
    expect(sent.sort()).toEqual(Object.keys(APP_USAGE_KINDS).sort());
  });
});

describe("the relay quota's fields", () => {
  it("are tiers.json's, and leave out what is already counted", () => {
    expect(RELAY_QUOTA_FIELDS).toEqual(tiers.metering.relay_quota_fields);
    expect(RELAY_QUOTA_FIELDS).toContain("app_egress_bytes");
    expect(RELAY_QUOTA_FIELDS).not.toContain("app_relay_ihttp_bytes");
  });

  it("are required of every period summed", () => {
    expect(() => relayBytes({ bytes_in: 1, turn_bytes: 0 })).toThrow(/app_egress_bytes/);
  });
});
