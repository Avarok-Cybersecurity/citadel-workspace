/**
 * Relay credentials (control/ice.mjs): what is sent to Cloudflare, when nothing is, the plan
 * gate, the per-member rate limit and the cache. Cloudflare's TURN API is answered at the fetch
 * boundary (helpers.mjs `outbound`), the suite's one mock; the minter and the tenant object that
 * holds it are the real ones.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { turnConfig } from "../control/http.mjs";
import { IceMinter, MINTS_PER_HOUR, turnEndpoint, UNAVAILABLE } from "../control/ice.mjs";
import { entitlements, METERING } from "../control/plans.mjs";
import { freeTenant, outbound, productionEnv, relay, tenantObject } from "./helpers.mjs";

const TTL = 600;
const T0 = Date.UTC(2026, 8, 23, 12, 0, 0);
const turn = { keyId: env.TURN_KEY_ID, token: env.TURN_KEY_API_TOKEN, ttl: TTL };
const plan = (tier, extra = {}) =>
  entitlements({ tier, interval: tier === "free" ? null : "month", seats: tier === "free" ? 0 : 3, storage_blocks: 0, status: "active", period_start: null, period_end: null, ...extra });
const FREE_RELAY_BYTES = plan("free").relay_gb_included * METERING.gb_bytes;

/** A minter on a clock the test moves, for a tenant on `tier` that has relayed `bytesIn`. */
function minter({ tier = "free", bytesIn = 0, cfg = turn } = {}) {
  const clock = { now: T0 };
  const tenant = { limits: plan(tier), bytesIn };
  const m = new IceMinter(cfg, { fetch: (url, init) => fetch(url, init), nowMs: () => clock.now }, () => tenant);
  return { m, clock, tenant };
}

const turnCalls = (calls) => calls.filter((c) => c.url.startsWith("https://rtc.live.cloudflare.com/"));

afterEach(() => vi.restoreAllMocks());

describe("minting", () => {
  it("asks Cloudflare for the configured key, with the token as a bearer and the configured TTL", async () => {
    const { calls } = outbound();
    const { m } = minter();
    const answer = await m.mint("alice");

    const sent = turnCalls(calls);
    expect(sent).toHaveLength(1);
    expect(sent[0].url).toBe(turnEndpoint(env.TURN_KEY_ID));
    expect(sent[0].url).toBe(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`);
    expect(sent[0].method).toBe("POST");
    expect(sent[0].headers.authorization).toBe(`Bearer ${env.TURN_KEY_API_TOKEN}`);
    expect(sent[0].headers["content-type"]).toBe("application/json");
    expect(JSON.parse(sent[0].body)).toEqual({ ttl: TTL });

    expect(answer.expires_at).toBe(T0 / 1000 + TTL);
    expect(answer.ice_servers).toEqual([
      { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"], username: null, credential: null },
      {
        urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"],
        username: "user-1",
        credential: "credential-1",
      },
    ]);
    expect(JSON.stringify(answer)).not.toContain(env.TURN_KEY_API_TOKEN);
  });

  it("an answer Cloudflare refuses, or one with no servers, is unavailable rather than an exception", async () => {
    outbound({ turn: { status: 401, body: { success: false } } });
    expect(await minter().m.mint("alice")).toEqual({ unavailable: UNAVAILABLE.failed });
    vi.restoreAllMocks();
    outbound({ turn: { status: 201, body: { iceServers: [] } } });
    expect(await minter().m.mint("alice")).toEqual({ unavailable: UNAVAILABLE.failed });
  });
});

describe("unset secrets", () => {
  it("without both, turnConfig is null and nothing is minted or sent", async () => {
    const vars = productionEnv({ TURN_KEY_ID: undefined, TURN_KEY_API_TOKEN: undefined });
    expect(turnConfig(vars)).toBeNull();
    expect(turnConfig({ ...vars, TURN_KEY_ID: "only-the-id" })).toBeNull();
    expect(turnConfig({ ...vars, TURN_KEY_API_TOKEN: "only-the-token" })).toBeNull();
    expect(turnConfig(productionEnv())).toEqual({ keyId: env.TURN_KEY_ID, token: env.TURN_KEY_API_TOKEN, ttl: 3600 });

    const { calls } = outbound();
    expect(await minter({ cfg: turnConfig(vars) }).m.mint("alice")).toEqual({ unavailable: UNAVAILABLE.notConfigured });
    expect(turnCalls(calls)).toHaveLength(0);
  });

  it("the lifetime is required and bounded whatever the secrets", () => {
    expect(() => turnConfig(productionEnv({ TURN_CREDENTIAL_TTL_SECONDS: undefined }))).toThrow(/TURN_CREDENTIAL_TTL_SECONDS/);
    expect(() => turnConfig(productionEnv({ TURN_CREDENTIAL_TTL_SECONDS: "59" }))).toThrow(/60 to 86400/);
    expect(() => turnConfig(productionEnv({ TURN_CREDENTIAL_TTL_SECONDS: "1h" }))).toThrow(/60 to 86400/);
  });
});

describe("the plan's relay", () => {
  it("a free tenant is refused once its included relay is used, and nothing is sent", async () => {
    const { calls } = outbound();
    expect((await minter({ bytesIn: FREE_RELAY_BYTES - 1 }).m.mint("alice")).ice_servers).toBeDefined();
    expect(await minter({ bytesIn: FREE_RELAY_BYTES }).m.mint("alice")).toEqual({ unavailable: UNAVAILABLE.relayUsed });
    expect(turnCalls(calls)).toHaveLength(1);
  });

  it("a paid tenant past its included relay still gets servers: that relay is billed", async () => {
    outbound();
    const { m } = minter({ tier: "team", bytesIn: 10 * plan("team").relay_gb_included * METERING.gb_bytes });
    expect((await m.mint("alice")).ice_servers).toBeDefined();
  });
});

describe("per member", () => {
  it(`at most ${MINTS_PER_HOUR} mints an hour per member; another member is not affected; the hour slides`, async () => {
    const { calls } = outbound();
    const ttl = 60;
    const { m, clock } = minter({ cfg: { ...turn, ttl } });
    for (let i = 0; i < MINTS_PER_HOUR; i++) {
      expect((await m.mint("alice")).ice_servers).toBeDefined();
      clock.now += ttl * 1000 * 0.8; // past the cache, so each is a real mint
      if (clock.now - T0 >= 3600 * 1000) throw new Error("the test's mints must fall within one hour");
    }
    expect(await m.mint("alice")).toEqual({ unavailable: UNAVAILABLE.rateLimited });
    expect((await m.mint("bob")).ice_servers).toBeDefined();
    expect(turnCalls(calls)).toHaveLength(MINTS_PER_HOUR + 1);

    clock.now = T0 + 3600 * 1000; // the first mint has left the window
    expect((await m.mint("alice")).ice_servers).toBeDefined();
  });

  it("hands back the same credentials until 80% of their lifetime, then mints new ones", async () => {
    const { calls } = outbound();
    const { m, clock } = minter();
    const first = await m.mint("alice");
    clock.now = T0 + TTL * 1000 * 0.8 - 1;
    expect(await m.mint("alice")).toEqual(first);
    expect(turnCalls(calls)).toHaveLength(1);

    clock.now = T0 + TTL * 1000 * 0.8;
    const second = await m.mint("alice");
    expect(turnCalls(calls)).toHaveLength(2);
    expect(second.ice_servers[1].credential).toBe("credential-2");
    expect(second.expires_at).toBe(Math.floor(clock.now / 1000) + TTL);

    expect((await m.mint("bob")).ice_servers[1].credential).toBe("credential-3");
  });
});

describe("the tenant object", () => {
  it("mints for its members with its own plan and meter", async () => {
    const { slug } = await freeTenant("ice");
    const { calls } = outbound();
    const minted = await runInDurableObject(tenantObject(slug), (instance) => instance.ice.mint("alice"));
    expect(minted.ice_servers[1].urls).toContain("turns:turn.cloudflare.com:443?transport=tcp");
    expect(minted.expires_at - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(Number(productionEnv().TURN_CREDENTIAL_TTL_SECONDS));
    expect(turnCalls(calls)).toHaveLength(1);

    await relay(slug, FREE_RELAY_BYTES);
    expect(await runInDurableObject(tenantObject(slug), (instance) => instance.ice.mint("bob"))).toEqual({ unavailable: UNAVAILABLE.relayUsed });
    expect(turnCalls(calls)).toHaveLength(1);
  });
});
