//! Node chat files: the purge alarm's entry into the kernel's sweep (`chat_attachment_sweep`),
//! which reclaims uploads nobody shared and bytes a store left behind, a bounded number of nodes
//! per pass (control/tenant-links.mjs `chatFilesSweep`).

use crate::support::millis;
use crate::TenantServer;
use citadel_workspace_server_kernel::kernel::chat_attachment_sweep::SWEEP_BATCH;
use js_sys::Promise;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;

#[wasm_bindgen]
impl TenantServer {
    /// Resolves to how many nodes this sweep's round has left after one pass of at most
    /// `SWEEP_BATCH` nodes as of `now_ms`. The object runs another pass soon when it is not zero.
    pub fn sweep_chat_attachments(&self, now_ms: f64) -> Promise {
        let ready = self.ready_kernel();
        future_to_promise(async move {
            let kernel = ready?;
            let remaining = kernel
                .sweep_chat_attachments(millis(now_ms).map_err(JsValue::from)?, SWEEP_BATCH)
                .await
                .map_err(|e| JsError::new(&format!("chat-file sweep failed: {e:?}")))?;
            Ok(remaining.into())
        })
    }
}
