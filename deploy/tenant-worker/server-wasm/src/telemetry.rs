//! The host's entry points into the kernel's Telemetry Service: the object's purge alarm and the
//! support read the control plane forwards once it has verified the request (support.rs).
//!
//! Both need the node's storage, which the kernel reaches only once the node has started and set
//! its remote; before that its backend is an empty in-memory map. So each refuses until
//! `telemetry_ready()`, which the object waits for (control/tenant-telemetry.mjs).

use crate::support::{millis, TelemetryQuery};
use crate::TenantServer;
use citadel_sdk::prelude::StackedRatchet;
use citadel_workspace_server_kernel::kernel::async_kernel::AsyncWorkspaceServerKernel;
use citadel_workspace_types::WorkspaceProtocolResponse;
use js_sys::{Object, Promise, Reflect};
use std::cell::RefCell;
use std::rc::Rc;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

pub type Kernel = AsyncWorkspaceServerKernel<StackedRatchet>;

/// Where `run_server_on` leaves a clone of the kernel it built.
pub type KernelSlot = Rc<RefCell<Option<Kernel>>>;

fn error(message: impl std::fmt::Display) -> JsValue {
    JsError::new(&message.to_string()).into()
}

#[wasm_bindgen]
impl TenantServer {
    /// Whether the kernel is built and its node has started, so its storage is the object's.
    pub fn telemetry_ready(&self) -> bool {
        self.kernel()
            .map(|kernel| kernel.node_remote.read().is_some())
            .unwrap_or(false)
    }

    /// Resolves to the number of telemetry segments past retention or over a user's cap that
    /// were removed as of `now_ms`.
    pub fn purge_expired_telemetry(&self, now_ms: f64) -> Promise {
        let ready = self.ready_kernel();
        future_to_promise(async move {
            let kernel = ready?;
            let removed = kernel
                .purge_expired_telemetry(millis(now_ms).map_err(JsValue::from)?)
                .await
                .map_err(|e| error(format!("telemetry purge failed: {e:?}")))?;
            Ok(removed.into())
        })
    }

    /// Serves a verified support request's `query_json` (a `TelemetryQuery`) as of `now_ms`.
    /// Resolves to `{ served, body }`: `body` is the kernel's response as JSON, and `served` is
    /// false when the kernel refused it (no grant, an expired one, or a bad query).
    pub fn support_list_telemetry(&self, query_json: String, now_ms: f64) -> Promise {
        let ready = self.ready_kernel();
        future_to_promise(async move {
            let kernel = ready?;
            let query: TelemetryQuery = serde_json::from_str(&query_json)
                .map_err(|e| error(format!("malformed telemetry query: {e}")))?;
            let response = kernel
                .support_list_telemetry(
                    &query.filter,
                    &query.page,
                    millis(now_ms).map_err(JsValue::from)?,
                )
                .await
                .map_err(|e| error(format!("support read failed: {e:?}")))?;
            let served = !matches!(response, WorkspaceProtocolResponse::Error(_));
            let body = serde_json::to_string(&response).map_err(error)?;
            let out = Object::new();
            Reflect::set(&out, &"served".into(), &served.into())?;
            Reflect::set(&out, &"body".into(), &body.into())?;
            Ok(out.into())
        })
    }

    pub(crate) fn kernel(&self) -> Option<Kernel> {
        self.kernel.borrow().clone()
    }

    pub(crate) fn ready_kernel(&self) -> Result<Kernel, JsValue> {
        if !self.telemetry_ready() {
            return Err(error(
                "the node has not started: its storage is not reachable yet",
            ));
        }
        self.kernel().ok_or_else(|| error("no kernel"))
    }
}
