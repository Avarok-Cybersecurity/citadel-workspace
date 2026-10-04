/**
 * The admission check a tenant's sign-in and registration go through (control/admission.mjs),
 * through the tenant object's own host object (control/tenant-sign-in.mjs), and the public
 * discovery route (control/discovery.mjs). Siteverify is answered at the fetch boundary
 * (helpers.mjs `outbound`), the suite's one mock: no real challenge is fetched or solved, and the
 * secret is Cloudflare's always-pass testing secret.
 */
import { env, runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { ACTION, REFUSAL } from "../control/admission.mjs";
import { DISCOVERY_MAX_AGE } from "../control/discovery.mjs";
import { freeTenant, freshSlug, get, outbound, tenantObject } from "./helpers.mjs";

const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const PEER = "100.64.0.7:1";
const request = (kind, token, remote_addr = PEER) => JSON.stringify({ username: "alice", kind, token, remote_addr });
const siteverifyCalls = (calls) => calls.filter((c) => c.url === SITEVERIFY);

/** The tenant object's verdict for one admission, with its setting as `required`. */
async function verdictIn(object, required, admission, ip = "203.0.113.9") {
  return runInDurableObject(object, async (instance) => {
    await instance.signIn.settings.set({ require_turnstile_sign_in: required });
    instance.signIn.connected(PEER, ip);
    return instance.signIn.host().admit(admission);
  });
}

describe("the admission check", () => {
  it("admits without asking anyone while the setting is off, token or not", async () => {
    const { object } = await freeTenant("ad");
    const { calls } = outbound();
    expect(await verdictIn(object, false, request("SignIn", null))).toBeNull();
    expect(await verdictIn(object, false, request("Register", "tok"))).toBeNull();
    expect(siteverifyCalls(calls)).toHaveLength(0);
  });

  it("with the setting on, refuses a missing token as required, before asking anyone", async () => {
    const { object } = await freeTenant("ad");
    const { calls } = outbound();
    expect(await verdictIn(object, true, request("SignIn", null))).toBe(REFUSAL.required);
    expect(await verdictIn(object, true, request("Register", ""))).toBe(REFUSAL.required);
    expect(siteverifyCalls(calls)).toHaveLength(0);
  });

  it("asks siteverify with the secret, the token and the client's address, and admits a pass", async () => {
    const { object } = await freeTenant("ad");
    const { calls } = outbound({ turnstile: { success: true, hostname: "example.com", action: ACTION.SignIn } });
    expect(await verdictIn(object, true, request("SignIn", "tok-1"))).toBeNull();
    const [call] = siteverifyCalls(calls);
    expect(call.method).toBe("POST");
    expect(call.form.get("secret")).toBe(env.TURNSTILE_SECRET);
    expect(call.form.get("response")).toBe("tok-1");
    expect(call.form.get("remoteip")).toBe("203.0.113.9");
  });

  it("binds the action to the kind: a sign-in token does not register, nor the reverse", async () => {
    const { object } = await freeTenant("ad");
    outbound({ turnstile: { success: true, hostname: "example.com", action: ACTION.SignIn } });
    expect(await verdictIn(object, true, request("Register", "tok"))).toBe(REFUSAL.failed);
    vi.restoreAllMocks();
    outbound({ turnstile: { success: true, hostname: "example.com", action: ACTION.Register } });
    expect(await verdictIn(object, true, request("Register", "tok"))).toBeNull();
    expect(await verdictIn(object, true, request("SignIn", "tok"))).toBe(REFUSAL.failed);
  });

  it("refuses a failed check, one for another site, and a kind it does not know", async () => {
    const { object } = await freeTenant("ad");
    outbound({ turnstile: { success: false, "error-codes": ["timeout-or-duplicate"] } });
    expect(await verdictIn(object, true, request("SignIn", "spent"))).toBe(REFUSAL.failed);
    vi.restoreAllMocks();
    outbound({ turnstile: { success: true, hostname: "evil.example" } });
    expect(await verdictIn(object, true, request("SignIn", "tok"))).toBe(REFUSAL.failed);
    vi.restoreAllMocks();
    const { calls } = outbound();
    expect(await verdictIn(object, true, request("Delete", "tok"))).toBe(REFUSAL.failed);
    expect(siteverifyCalls(calls)).toHaveLength(0);
  });

  it("fails closed when siteverify cannot be reached or answers nonsense", async () => {
    const { object } = await freeTenant("ad");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("network unreachable"));
    expect(await verdictIn(object, true, request("SignIn", "tok"))).toBe(REFUSAL.failed);
    vi.restoreAllMocks();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await verdictIn(object, true, request("SignIn", "tok"))).toBe(REFUSAL.failed);
  });

  it("fails closed when the setting is on and no Turnstile secret is configured", async () => {
    const { object } = await freeTenant("ad");
    const { calls } = outbound();
    const answer = await runInDurableObject(object, async (instance) => {
      await instance.signIn.settings.set({ require_turnstile_sign_in: true });
      instance.signIn.turnstile = () => null;
      return instance.signIn.host().admit(request("SignIn", "tok"));
    });
    expect(answer).toBe(REFUSAL.failed);
    expect(siteverifyCalls(calls)).toHaveLength(0);
  });

  it("sends no client address it does not have, and forgets one whose connection closed", async () => {
    const { object } = await freeTenant("ad");
    const { calls } = outbound();
    await runInDurableObject(object, async (instance) => {
      await instance.signIn.settings.set({ require_turnstile_sign_in: true });
      instance.signIn.connected(PEER, "203.0.113.9");
      instance.signIn.released(PEER);
      await instance.signIn.host().admit(request("SignIn", "tok"));
    });
    expect(siteverifyCalls(calls)[0].form.has("remoteip")).toBe(false);
  });
});

describe("GET /api/admission/<slug>", () => {
  it("says whether the check is required, with the site key, cacheable briefly, and nothing else", async () => {
    const { slug, object } = await freeTenant("dv");
    const off = await get(`/api/admission/${slug}`);
    expect(off.status).toBe(200);
    expect(off.headers.get("cache-control")).toBe(`public, max-age=${DISCOVERY_MAX_AGE}`);
    expect(await off.json()).toEqual({ turnstile: { required: false, siteKey: env.TURNSTILE_SITE_KEY } });

    await runInDurableObject(object, (instance) => instance.signIn.settings.set({ require_turnstile_sign_in: true }));
    const on = await get(`/api/admission/${slug}`);
    expect(await on.json()).toEqual({ turnstile: { required: true, siteKey: env.TURNSTILE_SITE_KEY } });
  });

  it("for no workspace, gives the site key and claims nothing about any workspace", async () => {
    const r = await get("/api/admission");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ turnstile: { required: false, siteKey: env.TURNSTILE_SITE_KEY } });
  });

  it("answers 404 for a workspace that does not exist or a slug that cannot be one", async () => {
    for (const slug of [freshSlug("none"), "UPPER", "-x", "a".repeat(80)]) {
      const r = await get(`/api/admission/${slug}`);
      expect(r.status).toBe(404);
      expect((await r.json()).error).toBe("not-found");
    }
  });

  it("reads the setting the object holds: the same entry the admission check reads", async () => {
    const { slug } = await freeTenant("dv");
    await runInDurableObject(tenantObject(slug), (instance) => instance.signIn.settings.set({ require_turnstile_sign_in: true }));
    const stored = await runInDurableObject(tenantObject(slug), (instance) => instance.ctx.storage.get("control:sign-in-settings"));
    expect(stored).toEqual({ require_turnstile_sign_in: true });
    expect((await (await get(`/api/admission/${slug}`)).json()).turnstile.required).toBe(true);
  });
});
