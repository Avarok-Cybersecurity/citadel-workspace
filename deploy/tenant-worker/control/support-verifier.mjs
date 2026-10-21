/**
 * The ML-DSA-65 checks of signed requests (server-wasm `support.rs` and `admin.rs`, the
 * citadel-support-signature crate), for the control-plane Worker. Rust, not a JS crypto library:
 * the same code the signing tools' formats are defined in.
 *
 * A wasm instance of its own, made on first use: the functions are pure, so one instance per
 * isolate serves every request, and it is never one of the tenants' (worker.mjs).
 */
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";

let instance = null;

const verifier = () => (instance ??= instantiate(wasm));

/**
 * `{ ok: true, nonce, expires_at_ms, action, tenant?, query? }` or `{ ok: false, refusal }` for
 * `body`, the request's text.
 */
export function verifySupportRequest(publicKey, body, audience, nowMs) {
  return verifier().verify_support_request(publicKey, body, audience, nowMs);
}

/**
 * A signed admin request (tools/coupon-admin): `{ ok: true, payload }`, `payload` being the
 * verified `{ audience, nonce, expires_at_ms, action }`, or `{ ok: false, reason }`. Signed under
 * the admin domain only: a support request, even under the same key, is refused.
 */
export function verifyAdminRequest(publicKeyHex, body, audience, nowMs) {
  return verifier().verify_admin_request(publicKeyHex, body, audience, nowMs);
}

/**
 * The same check of a signed coupon-admin request, under the admin signing domain:
 * `{ ok: true, payload }` or `{ ok: false, reason }` (control/coupon-admin.mjs reads the payload).
 */
export function verifyAdminRequest(publicKey, body, audience, nowMs) {
  instance ??= instantiate(wasm);
  if (typeof instance.verify_admin_request !== "function") throw new Error("this server-wasm build has no verify_admin_request");
  return instance.verify_admin_request(publicKey, body, audience, nowMs);
}
