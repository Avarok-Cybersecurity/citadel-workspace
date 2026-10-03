//! Sign-in, as the Durable Object provides it: post-quantum sign-in's settings, and the
//! workspace's sign-in settings, which the object keeps (control/tenant-sign-in.mjs documents the
//! host object's methods).
//!
//! The admission hook is the SDK's to call (`ServerMiscSettings::admission`); the object's
//! `admit(json)` is its body. Seam: once the SDK exposes `AdmissionPolicy`, an impl here forwards
//! `AdmissionContext { username, kind, token, remote_addr }` to `SignInHost::admit` as that JSON,
//! maps `"admission_required"` / `"admission_failed"` to the SDK's two refusals and anything
//! else that is not null (a rejected Promise, a malformed answer) to `AdmissionFailed`, and
//! `HostedSignIn` carries it in.

use crate::host_promise::HostPromise;
use citadel_sdk::prelude::async_trait;
use citadel_workspace_server_kernel::kernel::sign_in::{
    KsfParams, OprfSeed, PqAuthServerSettings, SignInSettingsStore, SignInSettingsUnavailable,
};
use citadel_workspace_types::sign_in::SignInSettings;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The object the Durable Object hands in; see the module docs.
    pub type SignInHost;

    #[wasm_bindgen(method, catch, js_name = loadSettings)]
    fn load_settings(this: &SignInHost) -> Result<js_sys::Promise, JsValue>;

    #[wasm_bindgen(method, catch, js_name = storeSettings)]
    fn store_settings(this: &SignInHost, settings_json: &str) -> Result<js_sys::Promise, JsValue>;
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

/// The kernel's sign-in settings store over `host`.
pub fn settings_store(host: SignInHost) -> std::sync::Arc<dyn SignInSettingsStore> {
    std::sync::Arc::new(DurableObjectSignIn(host))
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
