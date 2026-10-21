/**
 * The admin verifier the coupon routes call (control/support-verifier.mjs `verifyAdminRequest`)
 * through the real server-wasm build. The requests are fixtures signed with a test key at one
 * fixed instant (test/fixtures/admin-requests.json, from citadel-support-signature's
 * admin_fixtures example); the routes themselves are tested where they live.
 */
import { describe, expect, it } from "vitest";
import { verifyAdminRequest } from "../control/support-verifier.mjs";
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
    expect(verdict.payload.action.issue_coupon).toMatchObject({ code: "PARTNER-ACME", shape: { grant: "design-partner" }, max_redemptions: 1 });
    expect(Object.keys(verdict).sort()).toEqual(["ok", "payload"]);
  });
  it("carries a revoke's stated choice and a unit action", () => {
    expect(verify("revoke_with_grants").payload.action).toEqual({ revoke_coupon: { code: "PARTNER-ACME", also_revoke_grants: true } });
    expect(verify("list_coupons").payload.action).toBe("list_coupons");
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
