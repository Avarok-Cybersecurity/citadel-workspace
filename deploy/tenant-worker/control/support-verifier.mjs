/**
 * The ML-DSA-65 check of a signed support request (server-wasm `support.rs`, the
 * citadel-support-signature crate), for the control-plane Worker. Rust, not a JS crypto library:
 * the same code the signing tool's format is defined in.
 *
 * A wasm instance of its own, made on first use: the function is pure, so one instance per
 * isolate serves every request, and it is never one of the tenants' (worker.mjs).
 */
import { instantiate } from "../server-wasm/pkg/instance.mjs";
import wasm from "../server-wasm/pkg/citadel_tenant_server_wasm_bg.wasm";

let instance = null;

/**
 * `{ ok: true, nonce, expires_at_ms, action, tenant?, query? }` or `{ ok: false, refusal }` for
 * `body`, the request's text.
 */
export function verifySupportRequest(publicKey, body, audience, nowMs) {
  instance ??= instantiate(wasm);
  return instance.verify_support_request(publicKey, body, audience, nowMs);
}
