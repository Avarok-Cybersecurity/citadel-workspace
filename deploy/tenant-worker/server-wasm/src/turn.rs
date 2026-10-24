//! The tenant's relay quota as the kernel's `TurnUsageSink`: each member's agent reports the
//! TURN bytes its connections moved, and the object's meter adds them to the period's
//! `turn_bytes` (control/meter.mjs), counted against the same quota as the bytes the server
//! relays itself (control/ice.mjs).

use citadel_sdk::prelude::async_trait;
use citadel_workspace_server_kernel::kernel::telemetry::TurnUsageSink;
use citadel_workspace_types::turn_usage::TurnUsageRefusal;
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    /// The object's TURN intake (control/turn-cap.mjs `TurnIntake`): `record(userId, bytes)`
    /// counts the report and returns null, or returns the refusal (`TurnUsageRefusal`) as JSON.
    pub type TurnUsageHost;

    #[wasm_bindgen(method, catch)]
    fn record(this: &TurnUsageHost, user_id: &str, bytes: f64) -> Result<Option<String>, JsValue>;
}

struct DurableObjectMeter(TurnUsageHost);

// SAFETY: wasm32 without threads has one thread, and each Durable Object gets its own wasm
// instance (see worker.mjs), so this handle is never reached from another thread or object.
unsafe impl Send for DurableObjectMeter {}
unsafe impl Sync for DurableObjectMeter {}

/// The kernel's TURN usage sink over `host`.
pub fn sink(host: TurnUsageHost) -> std::sync::Arc<dyn TurnUsageSink> {
    std::sync::Arc::new(DurableObjectMeter(host))
}

#[async_trait]
impl TurnUsageSink for DurableObjectMeter {
    async fn record_turn_bytes(&self, user_id: &str, bytes: u64) -> Result<(), TurnUsageRefusal> {
        // Exact: a report is at most MAX_TURN_USAGE_REPORT_BYTES per direction, far under 2^53.
        match self.0.record(user_id, bytes as f64) {
            Ok(None) => Ok(()),
            Ok(Some(refusal)) => Err(serde_json::from_str(&refusal).unwrap_or_else(|e| {
                web_sys::console::error_1(&format!("[tenant] unreadable TURN refusal: {e}").into());
                TurnUsageRefusal::HostFailed
            })),
            // The meter threw: nothing was counted, and the agent is told so.
            Err(e) => {
                web_sys::console::error_1(
                    &format!("[tenant] TURN usage not metered: {e:?}").into(),
                );
                Err(TurnUsageRefusal::HostFailed)
            }
        }
    }
}
