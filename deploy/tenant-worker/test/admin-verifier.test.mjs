/**
 * The admin verifier the coupon routes call (control/support-verifier.mjs `verifyAdminRequest`)
 * through the real server-wasm build. The requests are fixtures signed with a test key at one
 * fixed instant (test/fixtures/admin-requests.json, from citadel-support-signature's
 * admin_fixtures example). The payload reader is held to the Rust shape field for field, and one
 * issue goes through the real route end to end; the routes' other cases are tested where they live.
 */
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { verifyAdminRequest } from "../control/support-verifier.mjs";
import { ACTION_FIELDS, PAYLOAD_FIELDS, readAdminPayload } from "../control/coupon-admin-payload.mjs";
import { couponAdminRoute, serveCouponAdmin } from "../control/coupon-admin.mjs";
import { codeHash } from "../control/coupon-rules.mjs";
import { ioFor } from "../control/dispatch.mjs";
import { config } from "../control/http.mjs";
import { ORIGIN } from "./helpers.mjs";
import fixtures from "./fixtures/admin-requests.json";
import support from "./fixtures/support-requests.json";

const { now_ms: NOW, audience: AUDIENCE, public_key: KEY, requests } = fixtures;
const verify = (name, at = NOW, audience = AUDIENCE) => verifyAdminRequest(KEY, requests[name], audience, at);

function refused(verdict, reason) {
  expect(verdict.ok).toBe(false);
  expect(verdict).not.toHaveProperty("payload");
  expect(verdict.reason).toMatch(reason);
}

describe("a signed admin request", () => {
  it("verifies and hands back the payload as signed", () => {
    const verdict = verify("issue_grant");
    expect(verdict.ok).toBe(true);
    expect(verdict.payload).toEqual(JSON.parse(JSON.parse(requests.issue_grant).payload));
    expect(verdict.payload.action).toMatchObject({ kind: "issue_coupon", code: "PARTNER-ACME", template: null, grant_id: "design-partner", max_redemptions: 1 });
    expect(Object.keys(verdict).sort()).toEqual(["ok", "payload"]);
  });
  it("carries a revoke's stated choice and a unit action", () => {
    expect(verify("revoke_with_grants").payload.action).toEqual({ kind: "revoke_coupon", code: "PARTNER-ACME", also_revoke_grants: true });
    expect(verify("list_coupons").payload.action).toEqual({ kind: "list_coupons" });
  });
});

describe("refused, saying why", () => {
  it("a support request signed by the same key", () => {
    expect(support.public_key).toBe(KEY);
    refused(verify("support_signed"), /does not verify against the admin key/);
    for (const name of ["list_grants", "fetch_alpha"]) {
      refused(verifyAdminRequest(KEY, support.requests[name], AUDIENCE, NOW), /does not verify/);
    }
  });
  it("another key's signature, or a changed payload", () => {
    refused(verify("wrong_key"), /does not verify/);
    refused(verify("tampered"), /does not verify/);
  });
  it("another control plane's request", () => {
    refused(verify("issue_grant", NOW, "localhost"), /another control plane/);
  });
  it("an expired one, while it was valid until then", () => {
    refused(verify("expired"), /expired/);
    expect(verify("list_coupons", NOW + 119_999).ok).toBe(true);
    refused(verify("list_coupons", NOW + 120_000), /expired/);
  });
  it("a revoke that does not say whether grants go too", () => {
    refused(verify("revoke_unstated"), /also_revoke_grants/);
  });
  it("a body that is not a signed request", () => {
    refused(verifyAdminRequest(KEY, "{}", AUDIENCE, NOW), /not a signed admin request/);
  });
});

describe("the Rust payload and the Worker's reader agree", () => {
  const verifiable = ["issue_grant", "issue_template", "revoke_with_grants", "list_coupons", "list_redemptions"];
  it("field for field, for every action kind", () => {
    const kinds = new Set();
    for (const name of verifiable) {
      const { payload } = verify(name);
      expect([name, Object.keys(payload).sort()]).toEqual([name, [...PAYLOAD_FIELDS].sort()]);
      expect([name, Object.keys(payload.action).sort()]).toEqual([name, [...ACTION_FIELDS[payload.action.kind]].sort()]);
      expect([name, readAdminPayload(payload, AUDIENCE, NOW)]).toEqual([name, { nonce: payload.nonce, expires_at_ms: payload.expires_at_ms, action: payload.action }]);
      kinds.add(payload.action.kind);
    }
    expect([...kinds].sort()).toEqual(Object.keys(ACTION_FIELDS).sort());
  });
});

describe("end to end through the real verifier", () => {
  const ask = (route, body) => {
    const io = { ...ioFor(env), now: () => Math.floor(NOW / 1000), nowMs: () => NOW };
    const cfg = { ...config(env), adminPublicKey: KEY, controlHost: AUDIENCE };
    return serveCouponAdmin(io, cfg, new Request(`${ORIGIN}/api/admin/coupons/${route}`, { method: "POST", body }), couponAdminRoute("POST", ["admin", "coupons", route]));
  };
  it("a Rust-signed issue is stored once, and only that request", async () => {
    const issued = await ask("issue", requests.issue_grant);
    expect([issued.status, await issued.json()]).toEqual([201, { issued: true, code_hash: await codeHash("PARTNER-ACME"), kind: "comp" }]);
    const row = await env.CONTROL_DB.prepare("SELECT template, grant_id, max_redemptions FROM coupons WHERE code_hash = ?").bind(await codeHash("PARTNER-ACME")).first();
    expect(row).toEqual({ template: null, grant_id: "design-partner", max_redemptions: 1 });
    expect((await ask("issue", requests.issue_grant)).status).toBe(409);
    expect((await ask("issue", requests.wrong_key)).status).toBe(401);
    expect((await ask("issue", requests.support_signed)).status).toBe(401);
    expect((await ask("list", requests.list_coupons)).status).toBe(200);
  });
});
