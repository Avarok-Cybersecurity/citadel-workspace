/**
 * A tenant an earlier release provisioned -- no `[identity]` in its record, no server key seed --
 * does not start, says so, and is not upgraded by the Cron trigger. Everything is the real
 * Worker, its D1 and its objects.
 */
import { createScheduledController, env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { config } from "../control/http.mjs";
import { SERVER_KEY_SEED_KEY } from "../control/tenant-identity.mjs";
import worker from "../worker.mjs";
import { freeTenant, openSocket } from "./helpers.mjs";
import { wellKnownAt } from "./identity-helpers.mjs";

const CFG = config(env);
const PROVISIONING_KEY = "control:provisioning";

/** A tenant as an earlier release left it: its record stripped of `identity`, its seed deleted. */
async function earlierTenant(stem) {
  const { slug, object } = await freeTenant(stem);
  await runInDurableObject(object, async (instance, state) => {
    const { identity: _identity, ...record } = await state.storage.get(PROVISIONING_KEY);
    await state.storage.put(PROVISIONING_KEY, record);
    await state.storage.delete(SERVER_KEY_SEED_KEY);
    await instance.provisioning.load();
    await instance.identity.load();
  });
  return { slug, object };
}

describe("a tenant from an earlier release", () => {
  it("does not start, names why, and the Cron trigger leaves it as it is", async () => {
    const { slug, object } = await earlierTenant("earlier");
    const host = `${slug}.${CFG.controlHost}`;
    expect((await wellKnownAt(host)).status).toBe(404);
    await expect(openSocket(slug)).rejects.toThrow(/provisioned by an earlier release/);

    await worker.scheduled(createScheduledController({ cron: "*/15 * * * *", scheduledTime: Date.now() }), env).catch(() => {});
    const record = await runInDurableObject(object, (_i, state) => state.storage.get(PROVISIONING_KEY));
    expect(record.identity).toBeUndefined();
    await expect(openSocket(slug)).rejects.toThrow(/provisioned by an earlier release/);
  });

  it("is the case: a tenant provisioned now starts", async () => {
    const { slug } = await freeTenant("current");
    const { ws, refused } = await openSocket(slug);
    expect(refused).toBeUndefined();
    ws.close(1000, "done");
  });
});
