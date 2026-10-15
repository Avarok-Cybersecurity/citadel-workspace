//! Avarok support's side of the Telemetry Service (plan section 3).
//!
//! `verify_support_request` is the control-plane Worker's check of a signed support request
//! (`citadel-support-signature`): it runs in the Worker, on an instance of this module of its own
//! (control/support-verifier.mjs), before anything is stored or forwarded. A fetch's query then
//! reaches the tenant's object as `TelemetryQuery` JSON, which `telemetry.rs` hands the kernel.
//!
//! `SupportGrantHost` is the object's capability the kernel tells about grant changes; the object
//! mirrors them into D1 so the control plane can list granted tenants without waking every object
//! (control/support-grants.mjs).

use crate::host_promise::HostPromise;
use citadel_sdk::prelude::async_trait;
use citadel_support_signature::{verify, SignedSupportRequest, SupportAction};
use citadel_workspace_server_kernel::kernel::telemetry::SupportGrantObserver;
use citadel_workspace_types::telemetry::{SupportAccess, TelemetryFilter, TelemetryPage};
use js_sys::{Object, Reflect};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// The query a verified fetch carries from the Worker to the tenant's object.
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryQuery {
    pub filter: TelemetryFilter,
    pub page: TelemetryPage,
}

/// A JS number of Unix milliseconds as the kernel's `u64`, refusing anything else.
pub fn millis(value: f64) -> Result<u64, JsError> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > 2f64.powi(53) {
        return Err(JsError::new(&format!(
            "{value} is not a time in Unix milliseconds"
        )));
    }
    Ok(value as u64)
}

fn set(target: &Object, name: &str, value: JsValue) -> Result<(), JsError> {
    Reflect::set(target, &name.into(), &value)
        .map(|_| ())
        .map_err(|_| JsError::new("cannot build the verified request"))
}

/// `body` (the request's JSON text) verified against `public_key` for `audience` at `now_ms`.
/// Resolves to `{ ok: true, nonce, expires_at_ms, action: "list_grants" }` or
/// `{ ok: true, nonce, expires_at_ms, action: "fetch_telemetry", tenant, query }` (`query` is
/// `TelemetryQuery` JSON), or `{ ok: false, refusal }` saying why it was not accepted. Throws only
/// when the arguments themselves are wrong.
#[wasm_bindgen]
pub fn verify_support_request(
    public_key: &str,
    body: &str,
    audience: &str,
    now_ms: f64,
) -> Result<Object, JsError> {
    let now_ms = millis(now_ms)?;
    let out = Object::new();
    let verified = serde_json::from_str::<SignedSupportRequest>(body)
        .map_err(|e| format!("the body is not a signed support request: {e}"))
        .and_then(|signed| {
            verify(public_key, &signed, audience, now_ms).map_err(|refusal| refusal.to_string())
        });
    let request = match verified {
        Ok(request) => request,
        Err(refusal) => {
            set(&out, "ok", false.into())?;
            set(&out, "refusal", refusal.into())?;
            return Ok(out);
        }
    };
    set(&out, "ok", true.into())?;
    set(&out, "nonce", request.nonce.into())?;
    set(&out, "expires_at_ms", (request.expires_at_ms as f64).into())?;
    match request.action {
        SupportAction::ListGrants => set(&out, "action", "list_grants".into())?,
        SupportAction::FetchTelemetry {
            tenant,
            filter,
            page,
        } => {
            let query = serde_json::to_string(&TelemetryQuery { filter, page })
                .map_err(|e| JsError::new(&e.to_string()))?;
            set(&out, "action", "fetch_telemetry".into())?;
            set(&out, "tenant", tenant.into())?;
            set(&out, "query", query.into())?;
        }
    }
    Ok(out)
}

#[wasm_bindgen]
extern "C" {
    /// The object's grant mirror: `changed(enabled, untilMs)` returns a Promise that settles once
    /// the mirror is written (worker.mjs, control/support-grants.mjs).
    pub type SupportGrantHost;

    #[wasm_bindgen(method, catch)]
    fn changed(
        this: &SupportGrantHost,
        enabled: bool,
        until_ms: Option<f64>,
    ) -> Result<js_sys::Promise, JsValue>;
}

struct DurableObjectGrants(SupportGrantHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectGrants {}
unsafe impl Sync for DurableObjectGrants {}

/// The kernel's grant observer over `host`.
pub fn observer(host: SupportGrantHost) -> std::sync::Arc<dyn SupportGrantObserver> {
    std::sync::Arc::new(DurableObjectGrants(host))
}

#[async_trait]
impl SupportGrantObserver for DurableObjectGrants {
    async fn support_access_changed(&self, access: SupportAccess) {
        let until = access.until_ms.map(|ms| ms as f64);
        let outcome = match HostPromise::from_call(self.0.changed(access.enabled, until)) {
            Ok(promise) => promise.await.map(|_| ()).map_err(|e| format!("{e:?}")),
            Err(e) => Err(e),
        };
        // The kernel's record is already saved and stays the authority each read checks; a
        // mirror that missed this change lists the tenant wrongly until the next one.
        if let Err(e) = outcome {
            web_sys::console::error_1(
                &format!("[tenant] support grant mirror not updated: {e}").into(),
            );
        }
    }
}
