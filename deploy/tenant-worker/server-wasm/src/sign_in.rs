//! Sign-in, as the Durable Object provides it: post-quantum sign-in's settings, the workspace's
//! sign-in settings, and the admission check every fresh sign-in and registration passes. The
//! object keeps the settings and runs the check (control/tenant-sign-in.mjs documents the host
//! object's methods); this side forwards the SDK's questions to it.
//!
//! The check fails CLOSED here too: a host that cannot be asked, or answers anything this side
//! cannot read, refuses the sign-in.

use crate::host_promise::{parse, HostPromise};
use citadel_sdk::prelude::async_trait;
use citadel_workspace_server_kernel::kernel::sign_in::{
    AdmissionContext, AdmissionKind, AdmissionPolicy, AdmissionRefusal, KsfParams, OprfSeed,
    PqAuthServerSettings, SignInSettingsStore, SignInSettingsUnavailable,
};
use citadel_workspace_types::sign_in::SignInSettings;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use std::time::Duration;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The object the Durable Object hands in; see the module docs.
    pub type SignInHost;

    #[wasm_bindgen(method, catch, js_name = loadSettings)]
    fn load_settings(this: &SignInHost) -> Result<js_sys::Promise, JsValue>;

    #[wasm_bindgen(method, catch, js_name = storeSettings)]
    fn store_settings(this: &SignInHost, settings_json: &str) -> Result<js_sys::Promise, JsValue>;

    #[wasm_bindgen(method, catch)]
    fn admit(this: &SignInHost, request_json: &str) -> Result<js_sys::Promise, JsValue>;
}

/// Post-quantum sign-in for this tenant: its OPRF seed and the Argon2id cost clients stretch a
/// password factor with. The seed is copied in once and never leaves; nothing here prints it.
#[wasm_bindgen]
pub struct PqSignIn(PqAuthServerSettings);

#[wasm_bindgen]
impl PqSignIn {
    #[wasm_bindgen(constructor)]
    pub fn new(
        oprf_seed: &[u8],
        mem_kib: u32,
        iterations: u32,
        lanes: u32,
    ) -> Result<PqSignIn, JsError> {
        let seed: [u8; 32] = oprf_seed
            .try_into()
            .map_err(|_| JsError::new("the OPRF seed is not 32 bytes"))?;
        let ksf = KsfParams {
            mem_kib,
            iterations,
            lanes,
        };
        PqAuthServerSettings::new(OprfSeed::from_bytes(seed), ksf)
            .map(Self)
            .map_err(|e| JsError::new(&format!("post-quantum sign-in settings: {e}")))
    }
}

impl PqSignIn {
    pub fn into_settings(self) -> PqAuthServerSettings {
        self.0
    }
}

struct DurableObjectSignIn(SignInHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectSignIn {}
unsafe impl Sync for DurableObjectSignIn {}

/// The kernel's sign-in settings store and the node's admission check, both over `host`.
pub fn host_capabilities(
    host: SignInHost,
) -> (Arc<dyn SignInSettingsStore>, Arc<dyn AdmissionPolicy>) {
    let host = Arc::new(DurableObjectSignIn(host));
    (host.clone(), host)
}

/// What the object is asked: the SDK's `AdmissionContext`, the token as its string.
#[derive(Serialize)]
struct AdmissionRequest<'a> {
    username: &'a str,
    kind: &'static str,
    token: Option<&'a str>,
    remote_addr: Option<String>,
}

/// What the object answers: `null` admits.
#[derive(Deserialize)]
#[serde(tag = "refuse", rename_all = "snake_case")]
enum HostRefusal {
    AdmissionRequired,
    AdmissionFailed { reason: String },
}

/// Said to the client when the check could not be completed; the object logs the detail.
const CHECK_UNAVAILABLE: &str = "the check could not be completed";

/// How long after a session ends its client's reconnect is still not asked the check: the
/// agent retries a dropped session for 600 s (`SERVER_RECONNECT.give_up_after` in
/// citadel-internal-service), and its last attempt may take 30 s more to reach the check
/// (`attempt_timeout`) after up to 30 s of backoff. 900 s covers that with five minutes
/// spare for the gap between the server ending the session and the agent seeing the drop.
/// It exempts only from the check; the reconnect still proves the password, and each
/// ended session's token is honoured once, for its own account.
const RESUME_GRACE: Duration = Duration::from_secs(900);

fn kind_name(kind: AdmissionKind) -> &'static str {
    match kind {
        AdmissionKind::SignIn => "SignIn",
        AdmissionKind::Register => "Register",
    }
}

fn check_failed(detail: String) -> AdmissionRefusal {
    web_sys::console::error_1(&format!("[tenant] admission host failed: {detail}").into());
    AdmissionRefusal::Failed(CHECK_UNAVAILABLE.to_string())
}

#[async_trait]
impl AdmissionPolicy for DurableObjectSignIn {
    async fn admit(&self, ctx: AdmissionContext) -> Result<(), AdmissionRefusal> {
        let request = AdmissionRequest {
            username: &ctx.username,
            kind: kind_name(ctx.kind),
            token: ctx.token.as_ref().map(|token| token.as_str()),
            remote_addr: ctx.remote_addr.map(|ip| ip.to_string()),
        };
        let json = serde_json::to_string(&request).map_err(|e| check_failed(e.to_string()))?;
        let promise = HostPromise::from_call(self.0.admit(&json)).map_err(check_failed)?;
        let answer = promise.await.map_err(|e| check_failed(format!("{e:?}")))?;
        if answer.is_null() {
            return Ok(());
        }
        match parse::<HostRefusal>(&answer).map_err(check_failed)? {
            HostRefusal::AdmissionRequired => Err(AdmissionRefusal::Required),
            HostRefusal::AdmissionFailed { reason } => Err(AdmissionRefusal::Failed(reason)),
        }
    }

    fn resume_grace(&self) -> Duration {
        RESUME_GRACE
    }
}

fn host_failed(detail: String) -> SignInSettingsUnavailable {
    web_sys::console::error_1(&format!("[tenant] sign-in settings host failed: {detail}").into());
    SignInSettingsUnavailable("the workspace's sign-in settings could not be reached".to_string())
}

#[async_trait]
impl SignInSettingsStore for DurableObjectSignIn {
    async fn load(&self) -> Result<SignInSettings, SignInSettingsUnavailable> {
        let promise = HostPromise::from_call(self.0.load_settings()).map_err(host_failed)?;
        let value = promise.await.map_err(|e| host_failed(format!("{e:?}")))?;
        let json = value
            .as_string()
            .ok_or_else(|| host_failed("the settings are not a JSON string".to_string()))?;
        serde_json::from_str(&json).map_err(|e| host_failed(format!("malformed settings: {e}")))
    }

    async fn store(&self, settings: SignInSettings) -> Result<(), SignInSettingsUnavailable> {
        let json = serde_json::to_string(&settings).map_err(|e| host_failed(e.to_string()))?;
        let promise = HostPromise::from_call(self.0.store_settings(&json)).map_err(host_failed)?;
        promise.await.map_err(|e| host_failed(format!("{e:?}")))?;
        Ok(())
    }
}
