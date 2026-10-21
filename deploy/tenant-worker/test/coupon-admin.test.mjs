/**
 * The signed coupon-admin routes (control/coupon-admin.mjs) against the real D1, registry and
 * tenant objects. The verifier is faked at its port (test/coupon-helpers.mjs, and why); the order
 * it is called in -- verify, claim the nonce, act -- and everything after it is the real Worker.
 */
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { couponAdminRoute, serveCouponAdmin } from "../control/coupon-admin.mjs";
import { codeHash } from "../control/coupon-rules.mjs";
import { freshSlug, objectStats, ORIGIN, outbound, post, productionEnv, tenantRow } from "./helpers.mjs";
import { ADMIN_KEY, fakeAdminVerifier, freshCode, freshIp, paidBody, preview, previewBody } from "./coupon-helpers.mjs";

const DAY_MS = 86400 * 1000;
const nonce = () => crypto.randomUUID().replaceAll("-", "");
const signed = (action, extra = {}) => JSON.stringify({ payload: { nonce: nonce(), expires_at_ms: Date.now() + 60000, action, ...extra }, signature: `admin:${ADMIN_KEY}` });

function ask(route, body, cfgOverrides = {}) {
  const io = { ...ioFor(env), verifyAdmin: fakeAdminVerifier };
  const cfg = { ...config(env), adminPublicKey: ADMIN_KEY, ...cfgOverrides };
  return serveCouponAdmin(io, cfg, new Request(`${ORIGIN}/api/admin/coupons/${route}`, { method: "POST", body }), couponAdminRoute("POST", ["admin", "coupons", route]));
}

const issueAction = (extra = {}) => ({
  kind: "issue_coupon", code: freshCode("A"), template: "pct-10-once", grant_id: null, available_on: ["team", "business"], intervals: ["month", "year"],
  max_redemptions: 5, redeem_by_ms: Date.now() + 7 * DAY_MS, note: "partner launch", ...extra,
});
const couponRow = async (code) => env.CONTROL_DB.prepare("SELECT * FROM coupons WHERE code_hash = ?").bind(await codeHash(code)).first();
const nonceCount = async () => (await env.CONTROL_DB.prepare("SELECT COUNT(*) AS n FROM support_nonces").first()).n;

describe("unconfigured, unsigned, replayed", () => {
  it("answers 503 without CITADEL_ADMIN_MLDSA_PUBLIC_KEY, as production does until it is set", async () => {
    expect(config(productionEnv()).adminPublicKey).toBeNull();
    const r = await SELF.fetch(`${ORIGIN}/api/admin/coupons/issue`, { method: "POST", body: signed(issueAction()) });
    expect(r.status).toBe(503);
    expect((await ask("issue", signed(issueAction()), { adminPublicKey: null })).status).toBe(503);
  });

  it("refuses a request that does not verify (no signature, a support signature, another key) and stores nothing", async () => {
    const action = issueAction();
    const payload = { nonce: nonce(), expires_at_ms: Date.now() + 60000, action };
    const before = await nonceCount();
    for (const body of [JSON.stringify({ payload }), JSON.stringify({ payload, signature: `support:${ADMIN_KEY}` }), JSON.stringify({ payload, signature: "admin:other" }), "{"]) {
      const r = await ask("issue", body);
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("unauthorized");
    }
    expect(await couponRow(action.code)).toBeNull();
    expect(await nonceCount()).toBe(before);
  });

  it("serves a request once, and only at its own route", async () => {
    const replayed = async (route, body) => {
      const r = await ask(route, body);
      return [r.status, (await r.json()).error];
    };
    const body = signed(issueAction());
    expect((await ask("issue", body)).status).toBe(201);
    expect(await replayed("issue", body)).toEqual([409, "replayed"]);
    // A read is served once too, though serving it twice would change nothing.
    const list = signed({ kind: "list_coupons" });
    expect((await ask("list", list)).status).toBe(200);
    expect(await replayed("list", list)).toEqual([409, "replayed"]);
    expect((await (await ask("revoke", signed(issueAction()))).json()).error).toBe("wrong-route");
  });
});

describe("issue", () => {
  it("issues a dynamic code that previews and redeems like a static one", async () => {
    const action = issueAction({ template: "usd-10-once" });
    const r = await ask("issue", signed(action));
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ issued: true, code_hash: await codeHash(action.code), kind: "discount" });
    expect(await couponRow(action.code)).toMatchObject({ template: "usd-10-once", grant_id: null, max_redemptions: 5, note: "partner launch", revoked_at_ms: null });
    expect(await (await preview(previewBody(action.code), freshIp())).json()).toEqual({ applies: true, kind: "discount", amount_off_cents: 1000, duration: "once" });
  });

  it("refuses a code a static one already is, or one already issued", async () => {
    expect((await (await ask("issue", signed(issueAction({ code: "LAUNCH10" })))).json()).error).toBe("coupon-exists");
    expect(await couponRow("LAUNCH10")).toBeNull();
    const action = issueAction();
    expect((await ask("issue", signed(action))).status).toBe(201);
    expect((await ask("issue", signed(action))).status).toBe(409);
  });

  it("checks every field strictly, as the catalogue checks a static code", async () => {
    const { max_redemptions: _m, ...noMax } = issueAction();
    const cases = [
      [noMax, /lacks max_redemptions/],
      [issueAction({ template: null, grant_id: "design-partner", available_on: ["business"], intervals: ["month"], redeem_by_ms: null }), /needs redeem_by_ms/],
      [issueAction({ grant_id: "design-partner" }), /exactly one of template and grant_id/],
      [issueAction({ code: "lowercase1" }), /upper-case code/],
      [issueAction({ available_on: ["free"] }), /available_on names free/],
      [issueAction({ template: "pct-20-3mo" }), /intervals names year/],
      [issueAction({ redeem_by_ms: Date.now() - 1 }), /future instant/],
      [issueAction({ max_redemptions: 0 }), /max_redemptions/],
      [issueAction({ note: 7 }), /note/],
      [{ ...issueAction(), stack: true }, /unknown fields: stack/],
    ];
    for (const [action, why] of cases) {
      const r = await ask("issue", signed(action));
      expect(r.status).toBe(400);
      expect((await r.json()).detail).toMatch(why);
      if (typeof action.code === "string" && action.code !== "lowercase1") expect(await couponRow(action.code)).toBeNull();
    }
    expect((await ask("issue", signed(issueAction(), { expires_at_ms: Date.now() - 1 }))).status).toBe(400);
    expect((await ask("issue", signed(issueAction(), { audience: "elsewhere.example" }))).status).toBe(400);
  });
});

/** A comp tenant on a freshly issued unlimited code. */
async function compThroughAdmin() {
  const action = issueAction({ template: null, grant_id: "design-partner", available_on: ["business"], intervals: ["month"], max_redemptions: 2 });
  expect((await ask("issue", signed(action))).status).toBe(201);
  const slug = freshSlug("adm");
  outbound();
  expect((await post("/api/tenants", paidBody(slug, { tier: "business", coupon_code: action.code }))).status).toBe(201);
  return { code: action.code, slug };
}

describe("revoke", () => {
  it("with also_revoke_grants ends every grant through it: Free, data kept, the object told now", async () => {
    const { code, slug } = await compThroughAdmin();
    const before = await objectStats(slug);
    expect(before.entitlements.unlimited).toBe(true);
    const r = await ask("revoke", signed({ kind: "revoke_coupon", code, also_revoke_grants: true }));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ revoked: true, grants_ended: [slug], objects_updated: [slug] });
    expect(await tenantRow(slug)).toMatchObject({ status: "active", tier: "free", seats: 0, grant_id: null, grant_unlimited: 0 });
    const after = await objectStats(slug);
    expect(after.entitlements).toMatchObject({ tier: "free", unlimited: false, members_max: 5, storage_gb: 1 });
    expect(after.master_password_sha256_prefix).toBe(before.master_password_sha256_prefix);
    outbound();
    expect((await post("/api/tenants", paidBody(freshSlug("adm"), { tier: "business", coupon_code: code }))).status).toBe(400);
    expect((await ask("revoke", signed({ kind: "revoke_coupon", code, also_revoke_grants: true }))).status).toBe(404);
  });

  it("without it leaves existing grants and stops new redemptions; the field is required", async () => {
    const { code, slug } = await compThroughAdmin();
    expect((await ask("revoke", signed({ kind: "revoke_coupon", code }))).status).toBe(400);
    expect((await couponRow(code)).revoked_at_ms).toBeNull();
    expect((await ask("revoke", signed({ kind: "revoke_coupon", code, also_revoke_grants: false }))).status).toBe(200);
    expect(await tenantRow(slug)).toMatchObject({ grant_id: "design-partner", grant_unlimited: 1 });
    expect((await preview(previewBody(code, { tier: "business" }), freshIp())).status).toBe(400);
    expect((await ask("revoke", signed({ kind: "revoke_coupon", code: "LAUNCH10", also_revoke_grants: false }))).status).toBe(400);
  });
});

describe("list and redemptions", () => {
  it("show each code's holders and its audit trail", async () => {
    const { code, slug } = await compThroughAdmin();
    const listed = await (await ask("list", signed({ kind: "list_coupons" }))).json();
    const mine = listed.coupons.find((c) => c.grant_holders.includes(slug));
    expect(mine).toMatchObject({ kind: "comp", grant_id: "design-partner", unlimited: true, max_redemptions: 2, held: 1, grant_holders: [slug] });
    expect(listed.statics.map((s) => s.code)).toEqual(["LAUNCH10"]);
    const trail = await (await ask("redemptions", signed({ kind: "list_redemptions", code }))).json();
    expect(trail.redemptions).toMatchObject([{ slug, state: "redeemed" }]);
    expect(trail.events.map((e) => e.action)).toEqual(["issue", "reserve", "redeem"]);
  });
});
