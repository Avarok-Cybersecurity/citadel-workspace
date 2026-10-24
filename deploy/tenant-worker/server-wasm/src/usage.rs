//! What apps cost the tenant, as the kernel's `UsageMeter`: each use is counted into the object's
//! billing period (control/apps-usage.mjs `AppsUsageIntake`, control/meter.mjs). Server egress
//! is relay the plan bills; an iHTTP frame the node relayed is already in the bytes its sockets
//! carried, so it is kept apart and never billed twice (billing/tiers.json
//! `metering.relay_quota_fields`). The object is the tenant: the session is not passed on.

use citadel_workspace_server_kernel::kernel::apps::usage_meter::{
    Usage, UsageMeter, UsageMeterHandle,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The object's intake (control/apps-usage.mjs): `add(kind, bytes)` counts `bytes` of
    /// `kind` into the current period, and throws for a kind or count it does not know.
    pub type UsageHost;

    #[wasm_bindgen(method, catch)]
    fn add(this: &UsageHost, kind: &str, bytes: f64) -> Result<(), JsValue>;
}

/// The name the intake knows `usage` by.
fn kind(usage: Usage) -> &'static str {
    match usage {
        Usage::EgressIn => "EgressIn",
        Usage::RelayIhttp => "RelayIhttp",
    }
}

struct DurableObjectUsageMeter(UsageHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectUsageMeter {}
unsafe impl Sync for DurableObjectUsageMeter {}

/// The kernel's usage meter over `host`.
pub fn meter(host: UsageHost) -> UsageMeterHandle {
    std::sync::Arc::new(DurableObjectUsageMeter(host))
}

impl UsageMeter for DurableObjectUsageMeter {
    fn add(&self, _cid: Option<u64>, usage: Usage, bytes: u64) {
        // Exact below 2^53: one relayed frame or one egress answer, each bounded far under it.
        if let Err(e) = self.0.add(kind(usage), bytes as f64) {
            web_sys::console::error_1(
                &format!("[tenant] {usage:?} usage of {bytes} bytes not metered: {e:?}").into(),
            );
        }
    }
}
