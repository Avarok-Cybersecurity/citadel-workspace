/**
 * The tenant object's telemetry purge (control/tenant-telemetry.mjs): one alarm shared with the
 * usage flush, which, when the purge is due, starts the node if it is not running and asks the
 * real kernel (`purge_expired_telemetry`) to drop what is past retention. What the kernel drops is
 * its own tests' business (telemetry_needs_consent_and_is_bounded.rs); here, that the alarm asks
 * it, records the outcome, and schedules the next one.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nextAlarm, TELEMETRY_PURGE_INTERVAL_MS } from "../control/tenant-telemetry.mjs";
import { freeTenant, objectStats } from "./helpers.mjs";

const alarmOf = (object) => runInDurableObject(object, (_i, state) => state.storage.getAlarm());

/** Makes the next purge due `ms` from now, as if the object had last purged that long ago. */
const dueIn = (object, ms) =>
  runInDurableObject(object, async (instance, state) => {
    await state.storage.put("telemetry_purge", { due_ms: Date.now() + ms, last: null });
    await instance.telemetry.load();
  });

describe("the alarm's time", () => {
  it("is the earlier of the next flush and the next purge", () => {
    expect(nextAlarm(1000, 60, 5000)).toBe(1060);
    expect(nextAlarm(1000, 60, 1010)).toBe(1010);
    expect(nextAlarm(1000, null, 5000)).toBe(5000);
    expect(nextAlarm(1000, 60, null)).toBe(1060);
    expect(nextAlarm(1000, null, null)).toBeNull();
  });
});

describe("the purge alarm", () => {
  it("is armed a day out once a tenant is provisioned", async () => {
    const { slug, object } = await freeTenant("tp");
    const { telemetry_purge, running } = await objectStats(slug);
    expect(running).toBe(false);
    expect(telemetry_purge).toMatchObject({ last: null });
    expect(telemetry_purge.due_ms - Date.now()).toBeGreaterThan(TELEMETRY_PURGE_INTERVAL_MS - 60_000);
    expect(await alarmOf(object)).toBe(telemetry_purge.due_ms);
  });

  it("purges when due: starts the node, asks the kernel, and re-arms a day later", async () => {
    const { slug, object } = await freeTenant("tp");
    await dueIn(object, -1);
    const before = Date.now();
    expect(await runDurableObjectAlarm(object)).toBe(true);
    const stats = await objectStats(slug);
    expect(stats.running).toBe(true);
    expect(stats.telemetry_purge.last).toMatchObject({ removed: 0 });
    expect(stats.telemetry_purge.last.at_ms).toBeGreaterThanOrEqual(before);
    expect(stats.telemetry_purge.due_ms).toBe(stats.telemetry_purge.last.at_ms + TELEMETRY_PURGE_INTERVAL_MS);
    expect(await alarmOf(object)).toBe(stats.telemetry_purge.due_ms);
  });

  it("does nothing before it is due, and leaves the node stopped", async () => {
    const { slug, object } = await freeTenant("tp");
    await dueIn(object, 60 * 60 * 1000);
    expect(await runDurableObjectAlarm(object)).toBe(true);
    const stats = await objectStats(slug);
    expect(stats.running).toBe(false);
    expect(stats.telemetry_purge.last).toBeNull();
  });
});
