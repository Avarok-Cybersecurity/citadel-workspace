/**
 * Secure links on the tenant object (control/tenant-links.mjs): the kernel's link limits, read from
 * the tenant's entitlements with no default, and the hourly purge on the object's one alarm, which
 * asks the real kernel (`purge_expired_links`). What the kernel removes is its own tests' business
 * (store_tests.rs); here, that the alarm asks it, records the outcome, and schedules the next.
 */
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { nextAlarm } from "../control/tenant-telemetry.mjs";
import { LINKS_PURGE_INTERVAL_MS, linkQuota } from "../control/tenant-links.mjs";
import { freeTenant, objectStats } from "./helpers.mjs";

const alarmOf = (object) => runInDurableObject(object, (_i, state) => state.storage.getAlarm());

describe("the alarm's time", () => {
  it("is the earliest of the next flush, the telemetry purge and the links purge", () => {
    expect(nextAlarm(1000, 60, 5000, 1030)).toBe(1030);
    expect(nextAlarm(1000, 60, 5000, 9000)).toBe(1060);
    expect(nextAlarm(1000, null, 5000, 2000)).toBe(2000);
    expect(nextAlarm(1000, null, null, 2000)).toBe(2000);
    expect(nextAlarm(1000, null, null, null)).toBeNull();
  });
});

describe("the link limits", () => {
  it("are the entitlements' two counts", () => {
    expect(linkQuota({ secure_links_per_member: 5, secure_links_pool: 0 })).toEqual({ per_member: 5, pool: 0 });
    expect(linkQuota({ secure_links_per_member: 50, secure_links_pool: 150 })).toEqual({ per_member: 50, pool: 150 });
  });

  it("have no default: a missing or malformed count is an error", () => {
    for (const bad of [{}, { secure_links_per_member: 5 }, { secure_links_pool: 50 }, { secure_links_per_member: -1, secure_links_pool: 0 }, { secure_links_per_member: 5, secure_links_pool: "50" }, { secure_links_per_member: 1.5, secure_links_pool: 0 }]) {
      expect(() => linkQuota(bad), JSON.stringify(bad)).toThrow(/secure_links_/);
    }
  });
});

describe("the links purge", () => {
  it("is armed an hour out once a tenant is provisioned, and is the alarm", async () => {
    const { slug, object } = await freeTenant("lp");
    const { links_purge, telemetry_purge } = await objectStats(slug);
    expect(links_purge).toMatchObject({ last: null });
    expect(links_purge.due_ms - Date.now()).toBeGreaterThan(LINKS_PURGE_INTERVAL_MS - 60_000);
    expect(links_purge.due_ms).toBeLessThan(telemetry_purge.due_ms);
    expect(await alarmOf(object)).toBe(links_purge.due_ms);
  });

  it("purges when due: asks the kernel, records what remains, and re-arms an hour later", async () => {
    const { slug, object } = await freeTenant("lp");
    await runInDurableObject(object, async (instance, state) => {
      await state.storage.put("links_purge", { due_ms: Date.now() - 1, last: null });
      await instance.links.load();
    });
    const before = Date.now();
    expect(await runDurableObjectAlarm(object)).toBe(true);
    const stats = await objectStats(slug);
    expect(stats.running).toBe(true);
    expect(stats.links_purge.last).toMatchObject({ remaining: 0 });
    expect(stats.links_purge.last.at_ms).toBeGreaterThanOrEqual(before);
    expect(stats.links_purge.due_ms).toBe(stats.links_purge.last.at_ms + LINKS_PURGE_INTERVAL_MS);
    expect(await alarmOf(object)).toBe(stats.links_purge.due_ms);
  });
});
