//! The control-plane Worker's check of a signed admin request (`citadel-support-signature`'s
//! admin format: coupon issue, revoke and listing). Like `verify_support_request` it runs on an
//! instance of this module of its own (control/support-verifier.mjs), before anything is stored.

use crate::support::millis;
use citadel_support_signature::{verify_admin, SignedAdminRequest};
use js_sys::{Object, Reflect, JSON};
use wasm_bindgen::prelude::*;

fn set(target: &Object, name: &str, value: JsValue) -> Result<(), JsError> {
    Reflect::set(target, &name.into(), &value)
        .map(|_| ())
        .map_err(|_| JsError::new("cannot build the verified admin request"))
}

/// The verified payload's JSON text, or why `body` was not accepted.
fn verdict(public_key: &str, body: &str, audience: &str, now_ms: u64) -> Result<String, String> {
    let signed = serde_json::from_str::<SignedAdminRequest>(body)
        .map_err(|e| format!("the body is not a signed admin request: {e}"))?;
    let request = verify_admin(public_key, &signed, audience, now_ms)
        .map_err(|refusal| refusal.describe("admin"))?;
    serde_json::to_string(&request).map_err(|e| e.to_string())
}

/// `body` (the request's JSON text) verified against `public_key` for `audience` at `now_ms`.
/// Returns `{ ok: true, payload }`, `payload` being the `AdminRequest` (`audience`, `nonce`,
/// `expires_at_ms`, `action`) as the signer wrote it, or `{ ok: false, reason }`. The nonce is
/// the caller's to claim. Throws only when the arguments themselves are wrong.
#[wasm_bindgen]
pub fn verify_admin_request(
    public_key: &str,
    body: &str,
    audience: &str,
    now_ms: f64,
) -> Result<Object, JsError> {
    let now_ms = millis(now_ms)?;
    let out = Object::new();
    match verdict(public_key, body, audience, now_ms) {
        Ok(payload) => {
            let payload =
                JSON::parse(&payload).map_err(|_| JsError::new("the payload is not JSON"))?;
            set(&out, "ok", true.into())?;
            set(&out, "payload", payload)?;
        }
        Err(reason) => {
            set(&out, "ok", false.into())?;
            set(&out, "reason", reason.into())?;
        }
    }
    Ok(out)
}
