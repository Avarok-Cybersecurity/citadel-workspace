/**
 * The ML-DSA-65 checks of signed requests (server-wasm `support.rs` and `admin.rs`, the
 * citadel-support-signature crate), for the control-plane Worker. Rust, not a JS crypto library:
 * the same code the signing tools' formats are defined in. The control plane's own wasm instance
 * (control-wasm.mjs), never one of the tenants'.
 */
import { controlWasm as verifier } from "./control-wasm.mjs";

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
